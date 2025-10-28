# app/routes/audio_routes.py
from flask import Blueprint, request, jsonify
import uuid
from ..config import executor, download_sessions, download_cancel_flags
from ..utils import emit_status, smooth_emit_progress
from ..platforms.youtube import extract_youtube_audio
from ..platforms.instagram import extract_instagram_audio
from ..platforms.pinterest import extract_pinterest_audio

audio_bp = Blueprint("audio", __name__)

@audio_bp.route("/api/download-audio", methods=["POST"])
def download_audio_only():
    try:
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        platform = (data.get("platform") or "").lower()

        if not url:
            return jsonify({"error": "Missing URL"}), 400
        if platform not in ["youtube", "instagram", "pinterest"]:
            return jsonify({"error": "Audio extraction not supported for this platform"}), 400

        download_id = str(uuid.uuid4())
        download_sessions[download_id] = {
            "status":"queued", "progress":0, "message":"Extracting audio...", "platform":platform
        }
        emit_status(download_id)
        download_cancel_flags.pop(download_id, None)

        executor.submit(process_audio_download, download_id, url, platform)

        return jsonify({"download_id": download_id}), 202
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def process_audio_download(download_id, url, platform):
    try:
        smooth_emit_progress(download_id, 5, "Preparing audio extraction...")
        if platform == "youtube":
            extract_youtube_audio(download_id, url)
        elif platform == "instagram":
            extract_instagram_audio(download_id, url)
        elif platform == "pinterest":
            extract_pinterest_audio(download_id, url)
        else:
            raise Exception("Unsupported platform for audio extraction")
    except Exception as e:
        download_sessions[download_id] = {"status":"error","message":str(e)}
        emit_status(download_id)
