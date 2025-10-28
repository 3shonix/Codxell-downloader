# app/utils.py
import os
import re
import time
import uuid
import shutil
import logging
import subprocess
from datetime import datetime
from urllib.parse import unquote
from flask import Response, send_file, request
from flask import jsonify
from .config import DOWNLOADS_DIR, download_sessions, download_cancel_flags, QUALITY_MAP
from app import socketio

logger = logging.getLogger(__name__)

# ------------ Helpers ------------
def get_download_path(platform):
    path = os.path.join(DOWNLOADS_DIR, platform)
    os.makedirs(path, exist_ok=True)
    return path

def sanitize_filename(filename):
    import unicodedata
    nfkd_form = unicodedata.normalize("NFKD", filename)
    cleaned = "".join([c for c in nfkd_form if not unicodedata.combining(c)])
    cleaned = re.sub(r"[\n\r\t]+", " ", cleaned)
    cleaned = re.sub(r"[^\w\s\-\.,\(\)\[\]]+", "", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r'[<>:"/\\|?*]', "_", cleaned)
    return (cleaned[:120] or "file").strip()

def find_ffmpeg():
    possible_paths = [
        "ffmpeg", "ffmpeg.exe",
        "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg",
        os.path.join(os.getcwd(), "ffmpeg.exe"),
        os.path.join(os.getcwd(), "ffmpeg", "ffmpeg.exe"),
    ]
    for p in possible_paths:
        if shutil.which(p):
            return p
        if os.path.isfile(p):
            return p
    return None

def emit_status(download_id):
    session = download_sessions.get(download_id)
    if session:
        socketio.emit("download_update", {"download_id": download_id, "session": session}, room=download_id)

def smooth_emit_progress(download_id, target_progress, message=None, step=2, delay=0.05):
    """Gradually moves progress to target and emits via socket to reduce spikes."""
    if download_id not in download_sessions:
        return
    current = int(download_sessions[download_id].get("progress", 0))
    target = int(target_progress)
    if target <= current:
        return
    for p in range(current, target + 1, step):
        if download_cancel_flags.get(download_id):
            return
        download_sessions[download_id]["progress"] = min(p, 100)
        if message:
            download_sessions[download_id]["message"] = message
        emit_status(download_id)
        time.sleep(delay)

def resize_with_ffmpeg(input_path, output_path, quality):
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        raise Exception("FFmpeg not found")

    if quality not in QUALITY_MAP:
        raise Exception("Quality not supported")

    target = QUALITY_MAP[quality]
    width, height = target['width'], target['height']

    # probe to check if video (simplified)
    try:
        probe_cmd = [ffmpeg_path, "-i", input_path, "-hide_banner"]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
        is_video = 'Video:' in probe_result.stderr
    except Exception:
        is_video = True

    if is_video:
        cmd = [
            ffmpeg_path, "-i", input_path,
            "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "copy", "-y", output_path
        ]
    else:
        cmd = [
            ffmpeg_path, "-i", input_path,
            "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            "-q:v", "2", "-y", output_path
        ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise Exception(f"Resize failed: {result.stderr}")
    return True

# ------------ Socket handlers registration ------------
def register_socket_handlers(app):
    from flask_socketio import emit, join_room

    @socketio.on("connect")
    def on_connect():
        emit("connection_response", {"message": "Connected"})

    @socketio.on("join")
    def on_join_room(data):
        room = data.get("download_id")
        if room:
            join_room(room)
            emit_status(room)

    @socketio.on("cancel_download")
    def on_cancel(data):
        did = data.get("download_id")
        download_cancel_flags[did] = True
        if did in download_sessions:
            download_sessions[did]["status"] = "cancelling"
            download_sessions[did]["message"] = "Cancelling..."
            emit_status(did)

# ------------ Range serving helpers ------------
def serve_file_with_ranges(platform, filename):
    """Serve file with Range header support similar to original implementation."""
    try:
        filename = unquote(filename)
        filepath = os.path.join(get_download_path(platform), filename)

        if not os.path.exists(filepath):
            return jsonify({"error": "File not found"}), 404

        file_size = os.path.getsize(filepath)
        range_header = request.headers.get("Range", None)

        if range_header:
            byte_start, byte_end = 0, file_size - 1
            match = re.search(r"bytes=(\d+)-(\d*)", range_header)
            if match:
                byte_start = int(match.group(1))
                byte_end = int(match.group(2)) if match.group(2) else byte_end

            length = byte_end - byte_start + 1
            with open(filepath, "rb") as f:
                f.seek(byte_start)
                data = f.read(length)

            response = Response(
                data, 206, mimetype="application/octet-stream", direct_passthrough=True
            )
            response.headers.add("Content-Range", f"bytes {byte_start}-{byte_end}/{file_size}")
            response.headers.add("Accept-Ranges", "bytes")
            response.headers.add("Content-Length", str(length))
            response.headers.add("Content-Disposition", f'attachment; filename="{filename}"')
            return response

        return send_file(filepath, as_attachment=True, download_name=filename, mimetype="application/octet-stream")
    except Exception as e:
        logger.exception("Error serving file")
        return jsonify({"error": str(e)}), 500
# ------------------------------------------------------------------
# Download stream helper (used by all platforms)
# ------------------------------------------------------------------
import requests

def download_stream_fast(url, filepath, download_id=None, start_progress=0, end_progress=100, max_retries=3):
    """
    Stream-downloads media file with retry and socket progress emission.
    Used by all platform modules.
    """
    from .config import download_sessions, download_cancel_flags
    from app import socketio
    import time

    CHUNK_SIZE = 1024 * 1024  # 1MB chunks
    attempt = 0
    last_emit = 0
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.google.com/"}

    while attempt < max_retries:
        try:
            with requests.get(url, headers=headers, stream=True, timeout=30) as r:
                r.raise_for_status()
                total_size = int(r.headers.get("content-length", 0))
                downloaded = 0
                last_percent = 0

                with open(filepath, "wb") as f:
                    for chunk in r.iter_content(chunk_size=CHUNK_SIZE):
                        if download_cancel_flags.get(download_id):
                            raise Exception("Download cancelled by user.")
                        if not chunk:
                            continue
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            percent = int((downloaded / total_size) * (end_progress - start_progress)) + start_progress
                            if percent >= last_percent + 1:
                                download_sessions[download_id]["progress"] = min(percent, end_progress)
                                download_sessions[download_id]["message"] = f"Downloading... {percent}%"
                                socketio.emit("download_update", {
                                    "download_id": download_id,
                                    "session": download_sessions[download_id]
                                }, room=download_id)
                                last_percent = percent
                                last_emit = time.time()
            # success
            download_sessions[download_id]["progress"] = end_progress
            socketio.emit("download_update", {
                "download_id": download_id,
                "session": download_sessions[download_id]
            }, room=download_id)
            return
        except Exception as e:
            attempt += 1
            if attempt >= max_retries:
                raise Exception(f"Failed to download {url}: {e}")
            time.sleep(1.5 * attempt)  # exponential backoff
