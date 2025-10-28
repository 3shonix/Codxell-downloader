# app/routes/download_routes.py
from flask import Blueprint, request, jsonify, send_file
import uuid
from ..config import executor, download_sessions, download_cancel_flags
from ..utils import emit_status, smooth_emit_progress, get_download_path
from ..platforms.youtube import download_youtube
from ..platforms.instagram import download_instagram
from ..platforms.pinterest import download_pinterest
import zipfile
from io import BytesIO
from datetime import datetime

download_bp = Blueprint("download", __name__)

@download_bp.route("/api/download", methods=["POST"])
def start_download():
    try:
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        platform = (data.get("platform") or "").lower()
        quality = (data.get("quality") or "1080p").lower()

        if not url:
            return jsonify({"error": "Missing URL"}), 400

        if not platform:
            if "youtu" in url:
                platform = "youtube"
            elif "instagram" in url:
                platform = "instagram"
            elif "pinterest" in url:
                platform = "pinterest"
            else:
                return jsonify({"error": "Unsupported platform"}), 400

        download_id = str(uuid.uuid4())
        download_sessions[download_id] = {
            "status": "queued",
            "progress": 0,
            "message": "Initializing download...",
            "platform": platform,
            "quality": quality,
            "created_at": datetime.now().isoformat()
        }
        emit_status(download_id)
        download_cancel_flags.pop(download_id, None)

        # submit background task
        executor.submit(process_download, download_id, url, platform, quality)

        return jsonify({"download_id": download_id}), 202
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def process_download(download_id, url, platform, quality):
    try:
        smooth_emit_progress(download_id, 5, f"Preparing download at {quality}...")
        if platform == "youtube":
            download_youtube(download_id, url, quality)
        elif platform == "instagram":
            download_instagram(download_id, url, quality)
        elif platform == "pinterest":
            download_pinterest(download_id, url, quality)
        else:
            raise Exception("Unsupported platform")
    except Exception as e:
        download_sessions[download_id] = {"status":"error","message": str(e)}
        emit_status(download_id)

@download_bp.route("/api/download-zip")
def download_zip():
    # endpoint for on-demand zip creation by query params (platform + files[])
    platform = request.args.get("platform")
    files = request.args.getlist("files[]")
    if not platform or not files:
        return jsonify({"error":"Missing parameters"}), 400
    zip_buffer = BytesIO()
    try:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zip_file:
            for file in files:
                filepath = os.path.join(get_download_path(platform), file)
                if os.path.exists(filepath):
                    zip_file.write(filepath, file)
        zip_buffer.seek(0)
        return send_file(zip_buffer, mimetype="application/zip", as_attachment=True, download_name=f"{platform}_downloads.zip")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@download_bp.route("/api/download-with-metadata", methods=["POST"])
def download_with_metadata():
    # This endpoint is heavy — creates an in-memory ZIP containing metadata and media.
    # We kept the original idea but simplified code to avoid duplication: platform-specific logic below
    from .preview_routes import extract_video_url  # reuse helper
    import json
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    platform = (data.get("platform") or "").lower()
    if not url or not platform:
        return jsonify({"error":"Missing URL or platform"}), 400

    try:
        # Use platform modules to collect metadata & media URLs
        media_urls = []
        metadata = {"platform": platform, "post_url": url}
        # For brevity we re-run preview logic (could be refactored to shared function)
        if platform == "youtube":
            from pytubefix import YouTube
            yt = YouTube(url)
            metadata.update({
                "title": yt.title,
                "description": yt.description or "No description available",
                "author": yt.author,
                "duration": f"{yt.length // 60}:{yt.length % 60:02d}",
                "thumbnail_url": yt.thumbnail_url
            })
            progressive = yt.streams.filter(progressive=True, file_extension="mp4").order_by("resolution").desc().first()
            if progressive:
                media_urls.append({"url": progressive.url, "filename": sanitize_filename(yt.title)+".mp4"})
            else:
                best_video = yt.streams.filter(file_extension="mp4", only_video=True).order_by("resolution").desc().first()
                best_audio = yt.streams.filter(only_audio=True).order_by("abr").desc().first()
                if best_video:
                    media_urls.append({"url": best_video.url, "filename": sanitize_filename(yt.title)+"_video.mp4"})
                if best_audio:
                    media_urls.append({"url": best_audio.url, "filename": sanitize_filename(yt.title)+"_audio.mp4"})
        elif platform == "instagram":
            # use instagram platform module to build metadata
            from ..platforms.instagram import gather_instagram_metadata
            metadata, media_urls = gather_instagram_metadata(url)
        elif platform == "pinterest":
            from ..platforms.pinterest import gather_pinterest_metadata
            metadata, media_urls = gather_pinterest_metadata(url)
        else:
            return jsonify({"error":"Unsupported platform"}), 400

        # Build zip stream
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
            metadata["downloaded_at"] = datetime.now().isoformat()
            zf.writestr("metadata.json", json.dumps(metadata, indent=2, ensure_ascii=False))
            zf.writestr("README.txt", f"{platform.upper()} download\nURL: {url}\nTitle: {metadata.get('title','N/A')}\n")
            # Download media content into zip
            import requests
            for mi in media_urls:
                try:
                    r = requests.get(mi["url"], headers={"User-Agent":"Mozilla/5.0"}, timeout=60, stream=True)
                    r.raise_for_status()
                    content = r.content
                    zf.writestr(mi.get("filename", f"file_{uuid.uuid4().hex}"), content)
                except Exception as e:
                    zf.writestr(f"ERROR_{mi.get('filename','unknown')}.txt", f"Failed to fetch {mi.get('url')}\nError: {e}")
        zip_buffer.seek(0)
        safe_title = sanitize_filename(metadata.get("title", platform))[:50]
        zip_filename = f"{platform}_{safe_title}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        return send_file(zip_buffer, mimetype="application/zip", as_attachment=True, download_name=zip_filename)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
