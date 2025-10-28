# app/routes/base_routes.py
import os
from flask import Blueprint, jsonify, request, Response
from ..config import DOWNLOADS_DIR
from ..utils import get_download_path, serve_file_with_ranges

base_bp = Blueprint("base", __name__)

@base_bp.route("/api/health")
def health():
    from ..utils import find_ffmpeg
    ffmpeg_available = find_ffmpeg() is not None
    return jsonify({
        "status": "ok",
        "timestamp": __import__("datetime").datetime.now().isoformat(),
        "ffmpeg_available": ffmpeg_available,
    })

@base_bp.route("/downloads/<platform>/<path:filename>")
def serve_platform_file(platform, filename):
    # uses shared util which handles range headers
    return serve_file_with_ranges(platform, filename)

@base_bp.route("/api/proxy-image")
def proxy_image():
    import requests
    image_url = request.args.get("url")
    if not image_url:
        return jsonify({"error": "No URL provided"}), 400
    try:
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.instagram.com/",
            "Accept": "image/*",
        }
        r = requests.get(image_url, headers=headers, timeout=15, stream=True)
        r.raise_for_status()
        def generate():
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
        return Response(generate(), content_type=r.headers.get("Content-Type", "image/jpeg"), headers={
            "Cache-Control": "public, max-age=31536000",
            "Access-Control-Allow-Origin": "*",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@base_bp.route("/api/proxy-video")
def proxy_video():
    import requests
    video_url = request.args.get("url")
    if not video_url:
        return jsonify({"error": "No URL provided"}), 400
    try:
        proxy_headers = {
            "User-Agent": request.headers.get("User-Agent", "Mozilla/5.0"),
            "Referer": "https://www.google.com/",
        }
        range_header = request.headers.get("Range")
        if range_header:
            proxy_headers["Range"] = range_header
        r = requests.get(video_url, headers=proxy_headers, timeout=20, stream=True, allow_redirects=True)
        r.raise_for_status()
        def generate():
            for chunk in r.iter_content(chunk_size=1024*64):
                if chunk:
                    yield chunk
        client_response = Response(generate(), status=r.status_code, content_type=r.headers.get("Content-Type", "video/mp4"))
        for header in ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"]:
            if header in r.headers:
                client_response.headers[header] = r.headers[header]
        client_response.headers["Cache-Control"] = "public, max-age=86400"
        client_response.headers["Access-Control-Allow-Origin"] = "*"
        return client_response
    except Exception as e:
        return jsonify({"error": str(e)}), 500
