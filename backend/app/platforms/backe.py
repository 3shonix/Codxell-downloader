NEW


from urllib.parse import quote_plus, unquote_plus
from flask import Flask, request, jsonify, Response, stream_with_context, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import os, re, uuid, logging, threading, requests, subprocess, time, shutil
from datetime import datetime
from pytubefix import YouTube
import instaloader
from concurrent.futures import ThreadPoolExecutor
import io

# Lock for thread-safe socket emissions
socket_lock = threading.Lock()

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DOWNLOADS_DIR = os.path.join(os.getcwd(), "downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

download_sessions = {}
download_cancel_flags = {}

# Thread pool for parallel downloads
executor = ThreadPoolExecutor(max_workers=4)


QUALITY_MAP = {
    'none': {'width': None, 'height': None, 'label': 'Original'},
    '1080p': {'width': 1920, 'height': 1080, 'label': 'Full HD'},
    '720p': {'width': 1280, 'height': 720, 'label': 'HD'},
    '480p': {'width': 854, 'height': 480, 'label': 'SD'},
    '360p': {'width': 640, 'height': 360, 'label': 'Low'},
    '240p': {'width': 426, 'height': 240, 'label': 'Very Low'},
    '144p': {'width': 256, 'height': 144, 'label': 'Minimum'},
}


def get_download_path(platform):
    path = os.path.join(DOWNLOADS_DIR, platform)
    os.makedirs(path, exist_ok=True)
    return path


def find_ffmpeg():
    """Find FFmpeg executable in system"""
    # Try common locations
    possible_paths = [
        "ffmpeg",  # System PATH
        "ffmpeg.exe",  # Windows
        "/usr/bin/ffmpeg",  # Linux
        "/usr/local/bin/ffmpeg",  # macOS
        os.path.join(os.getcwd(), "ffmpeg.exe"),  # Local directory
        os.path.join(os.getcwd(), "ffmpeg", "ffmpeg.exe"),  # ffmpeg folder
    ]

    for path in possible_paths:
        if shutil.which(path):
            return path
        if os.path.isfile(path):
            return path

    return None


def sanitize_filename(filename):
    import unicodedata

    nfkd_form = unicodedata.normalize("NFKD", filename)
    cleaned = "".join([c for c in nfkd_form if not unicodedata.combining(c)])
    cleaned = re.sub(r"[\n\r\t]+", " ", cleaned)
    cleaned = re.sub(r"[^\w\s\-\.,\(\)\[\]]+", "", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r'[<>:"/\\|?*]', "_", cleaned)
    return cleaned[:120] or "video"


def extract_shortcode(url):
    match = re.search(r"/(?:p|reel|reels)/([A-Za-z0-9_-]+)", url)
    return match.group(1) if match else None


def extract_video_url(html):
    patterns = [
        r'"video_url":"(https:[^"]+mp4[^"]*)"',
        r'"contentUrl":"(https:[^"]+mp4[^"]*)"',
        r'"url":"(https:[^"]+\.mp4[^"]*)"',
    ]
    for pattern in patterns:
        m = re.search(pattern, html)
        if m:
            return m.group(1).replace("\\u0026", "&").replace("\\", "")
    return None


def merge_video_audio_fast(video_path, audio_path, output_path):
    """Optimized FFmpeg merge with faster preset"""
    ffmpeg_path = find_ffmpeg()

    if not ffmpeg_path:
        raise Exception(
            "FFmpeg not found! Please install FFmpeg:\n"
            "Windows: Download from https://ffmpeg.org/download.html\n"
            "Linux: sudo apt install ffmpeg\n"
            "macOS: brew install ffmpeg"
        )

    try:
        cmd = [
            ffmpeg_path,
            "-i",
            video_path,
            "-i",
            audio_path,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-preset",
            "ultrafast",
            "-threads",
            "0",
            "-y",
            output_path,
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            logger.error(f"FFmpeg stderr: {result.stderr}")
            raise Exception(f"FFmpeg error: {result.stderr}")

        logger.info(f"FFmpeg merge successful: {output_path}")

    except FileNotFoundError:
        raise Exception(
            "FFmpeg executable not found! Install FFmpeg and ensure it's in your PATH"
        )
    except Exception as e:
        raise Exception(f"FFmpeg merge failed: {e}")


def emit_status(download_id, rate_limit=0.1):
    """Thread-safe socket emission with error handling and rate limiting"""
    try:
        session = download_sessions.get(download_id)
        if session:
            current_time = time.time()
            last_emit = session.get("_last_emit_time", 0)
            
            # Rate limit emissions to prevent socket overload
            if current_time - last_emit < rate_limit:
                return
                
            session["_last_emit_time"] = current_time
            
            with socket_lock:
                socketio.emit(
                    "download_update",
                    {"download_id": download_id, "session": session},
                    room=download_id,
                    skip_sid=None,
                    ignore_queue=False,
                )
    except Exception as e:
        logger.warning(f"Failed to emit status for {download_id}: {e}")


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


def smooth_emit_progress(
    download_id, target_progress, message=None, step=2, delay=0.05
):
    """Faster progress updates"""
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


@app.route("/api/health")
def health():
    ffmpeg_available = find_ffmpeg() is not None
    return jsonify(
        {
            "status": "ok",
            "timestamp": datetime.now().isoformat(),
            "ffmpeg_available": ffmpeg_available,
        }
    )


@app.route("/api/download", methods=["POST"])
def start_download():
    try:
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        platform = data.get("platform", "").lower()
        quality = data.get("quality", "1080p").lower()

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
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "current_speed": 0,
            "eta_seconds": None,
            "download_start_time": None,
            "last_update_time": None,
            "last_bytes_downloaded": 0,
        }
        emit_status(download_id)
        download_cancel_flags.pop(download_id, None)

        executor.submit(process_download, download_id, url, platform, quality)

        return jsonify({"download_id": download_id}), 202

    except Exception as e:
        logger.error(e)
        return jsonify({"error": str(e)}), 500

def resize_with_ffmpeg(input_path, output_path, quality):
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        raise Exception("FFmpeg not found")

    if quality not in QUALITY_MAP:
        quality = '1080p'

    target = QUALITY_MAP[quality]
    width, height = target.get('width'), target.get('height')

    # None = keep original
    if width is None or height is None:
        shutil.copyfile(input_path, output_path)
        return True

    # Check if video or image
    is_video = is_video_file(ffmpeg_path, input_path)

    if is_video:
        # Video quality scale
        # Higher quality = lower CRF number (18=high, 28=low)
        crf_map = {
            "2160p": "18",
            "1440p": "20",
            "1080p": "22",
            "720p": "25",
            "480p": "28",
            "360p": "30"
        }
        crf = crf_map.get(quality, "23")

        cmd = [
            ffmpeg_path, "-y", "-i", input_path,
            "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            "-c:v", "libx264", "-preset", "medium", "-crf", crf,
            "-c:a", "aac", "-b:a", "128k", output_path
        ]

    else:
        # Image compression mapping
        # Smaller quality = larger qscale (more compression)
        q_map = {
            "2160p": "2",
            "1440p": "4",
            "1080p": "6",
            "720p": "8",
            "480p": "10",
            "360p": "12"
        }
        q = q_map.get(quality, "6")

        # Ensure output format matches extension
        ext = os.path.splitext(output_path)[1].lower()
        if ext in [".png"]:
            codec = "png"
        elif ext in [".webp"]:
            codec = "libwebp"
        else:
            codec = "mjpeg"  # default for .jpg/.jpeg

        cmd = [
            ffmpeg_path, "-y", "-i", input_path,
            "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            "-q:v", q, "-c:v", codec, output_path
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception(f"Resize failed: {result.stderr}")

    return True

@app.route("/api/preview", methods=["POST"])
def preview():
    try:
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        if not url:
            return jsonify({"error": "URL required"}), 400

        if "youtu" in url:
            platform = "youtube"
        elif "instagram.com" in url:
            platform = "instagram"
        elif "pinterest.com" in url:
            platform = "pinterest"
        else:
            return jsonify({"error": "Unsupported URL"}), 400

        # Define all available qualities (universal for all platforms)
        all_qualities = ['none', '1080p', '720p', '480p', '360p', '240p', '144p']

        # YOUTUBE
        if platform == "youtube":
            yt = YouTube(url)
            video_streams = yt.streams.filter(file_extension="mp4", only_video=True)
            progressive = yt.streams.filter(progressive=True, file_extension="mp4")
            
            progressive_stream = (
                yt.streams.filter(progressive=True, file_extension="mp4")
                .order_by("resolution")
                .desc()
                .first()
            )

            if progressive_stream:
                best_video = progressive_stream
                best_audio = None
            else:
                best_video = (
                    yt.streams.filter(file_extension="mp4", only_video=True)
                    .order_by("resolution")
                    .desc()
                    .first()
                )
                best_audio = (
                    yt.streams.filter(only_audio=True).order_by("abr").desc().first()
                )

            return jsonify(
                {
                    "platform": "youtube",
                    "title": yt.title,
                    "thumbnail": yt.thumbnail_url,
                    "video_url": (
                        progressive_stream.url if progressive_stream else best_video.url
                    ),
                    "audio_url": (
                        None
                        if progressive_stream
                        else (best_audio.url if best_audio else None)
                    ),
                    "available_qualities": all_qualities,
                    "duration": yt.length,
                    "author": yt.author,
                    "ux_tip": "🎥 All quality options available with FFmpeg conversion",
                }
            )

        # INSTAGRAM
        if platform == "instagram":
            shortcode = extract_shortcode(url)
            if not shortcode:
                return jsonify({"error": "Invalid Instagram link"}), 400

            media_items = []
            title = "Instagram Post"
            author = None

            try:
                L = instaloader.Instaloader(
                    download_pictures=False,
                    download_videos=False,
                    quiet=True,
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                post = instaloader.Post.from_shortcode(L.context, shortcode)

                if hasattr(post, "caption") and post.caption:
                    caption = str(post.caption).strip()
                    title = caption[:100] + ("..." if len(caption) > 100 else "")

                if hasattr(post, "owner_username"):
                    author = post.owner_username

                nodes = []
                try:
                    if hasattr(post, "get_sidecar_nodes"):
                        sidecar = post.get_sidecar_nodes
                        if callable(sidecar):
                            nodes = list(sidecar())
                        else:
                            nodes = list(sidecar)
                except:
                    pass

                if nodes:
                    for node in nodes:
                        is_video = getattr(node, "is_video", False)
                        if is_video:
                            video_url = getattr(node, "video_url", None)
                            thumbnail = getattr(node, "display_url", None)
                            if video_url:
                                media_items.append(
                                    {
                                        "type": "video",
                                        "url": str(video_url).replace("\\u0026", "&"),
                                        "thumbnail": (
                                            str(thumbnail) if thumbnail else None
                                        ),
                                    }
                                )
                        else:
                            img_url = getattr(node, "display_url", None)
                            if img_url:
                                media_items.append(
                                    {
                                        "type": "image",
                                        "url": str(img_url).replace("\\u0026", "&"),
                                    }
                                )
                else:
                    if getattr(post, "is_video", False):
                        media_items.append(
                            {
                                "type": "video",
                                "url": str(post.video_url).replace("\\u0026", "&"),
                                "thumbnail": str(post.url),
                            }
                        )
                    else:
                        media_items.append(
                            {
                                "type": "image",
                                "url": str(post.url).replace("\\u0026", "&"),
                            }
                        )

            except Exception as e:
                logger.warning(f"Instaloader failed: {e}")

            if not media_items:
                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "en-US,en;q=0.9",
                    }

                    embed_url = (
                        f"https://www.instagram.com/p/{shortcode}/embed/captioned/"
                    )
                    response = requests.get(embed_url, headers=headers, timeout=15)

                    if response.status_code == 200:
                        html = response.text

                        if title == "Instagram Post":
                            caption_patterns = [
                                r'"caption":"([^"]{1,200})',
                                r'"edge_media_to_caption".*?"text":"([^"]{1,200})',
                                r'<meta property="og:description" content="([^"]{1,200})',
                            ]
                            for pattern in caption_patterns:
                                match = re.search(pattern, html)
                                if match:
                                    caption = match.group(1).strip()
                                    if caption and caption not in [
                                        "Instagram",
                                        "Instagram Post",
                                    ]:
                                        caption = caption.replace("\\n", " ").replace(
                                            "\\", ""
                                        )
                                        title = caption[:100] + (
                                            "..." if len(caption) > 100 else ""
                                        )
                                        break

                        if not author:
                            username_patterns = [
                                r'"username":"([^"]+)"',
                                r'"owner":\{"username":"([^"]+)"',
                            ]
                            for pattern in username_patterns:
                                match = re.search(pattern, html)
                                if match:
                                    author = match.group(1)
                                    break

                        video_patterns = [
                            r'"video_url":"(https://[^"]+)"',
                            r'"video_url":\s*"(https://[^"]+)"',
                        ]
                        for pattern in video_patterns:
                            match = re.search(pattern, html)
                            if match:
                                video_url = (
                                    match.group(1)
                                    .replace("\\u0026", "&")
                                    .replace("\\/", "/")
                                )
                                media_items.append(
                                    {
                                        "type": "video",
                                        "url": video_url,
                                        "thumbnail": None,
                                    }
                                )
                                break

                        if not media_items:
                            img_patterns = [
                                r'"display_url":"(https://[^"]+)"',
                                r'"thumbnail_src":"(https://[^"]+)"',
                            ]
                            for pattern in img_patterns:
                                matches = re.findall(pattern, html)
                                for img_url in matches[:5]:
                                    clean_url = img_url.replace("\\u0026", "&").replace(
                                        "\\/", "/"
                                    )
                                    if clean_url not in [m["url"] for m in media_items]:
                                        media_items.append(
                                            {
                                                "type": "image",
                                                "url": clean_url,
                                            }
                                        )

                except Exception as e:
                    logger.error(f"Web scraping failed: {e}")

            if not media_items:
                return (
                    jsonify(
                        {
                            "error": "No media found. The post might be private or unavailable."
                        }
                    ),
                    404,
                )

            return jsonify(
                {
                    "platform": "instagram",
                    "title": title,
                    "author": f"@{author}" if author else None,
                    "media": media_items,
                    "thumbnail": media_items[0].get("thumbnail")
                    or media_items[0]["url"],
                    "available_qualities": all_qualities,
                    "ux_tip": f"📱 Instagram Post • All qualities available with conversion",
                }
            )

        # PINTEREST
        if platform == "pinterest":
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://www.pinterest.com/",
                }

                r = requests.get(url, headers=headers, timeout=15)
                r.raise_for_status()
                html = r.text

                media_items = []
                video_url = extract_video_url(html)

                if video_url:
                    thumbnail_match = re.search(r'"thumbnailUrl":"([^"]+)"', html)
                    thumbnail = (
                        thumbnail_match.group(1).replace("\\u0026", "&")
                        if thumbnail_match
                        else ""
                    )

                    media_items.append(
                        {
                            "type": "video",
                            "url": video_url.replace("\\u0026", "&"),
                            "thumbnail": thumbnail,
                        }
                    )
                else:
                    main_image_patterns = [
                        r'"images":\{"orig":\{"url":"([^"]+)"',
                        r'"url":"(https://i\.pinimg\.com/originals/[^"]+)"',
                    ]

                    for pattern in main_image_patterns:
                        match = re.search(pattern, html)
                        if match:
                            img_url = (
                                match.group(1)
                                .replace("\\u0026", "&")
                                .replace("\\/", "/")
                            )
                            media_items.append({"type": "image", "url": img_url})
                            break

                title_patterns = [
                    r'"title":"([^"]{1,200})',
                    r'"description":"([^"]{1,200})',
                ]
                title = "Pinterest Post"
                for pattern in title_patterns:
                    match = re.search(pattern, html)
                    if match:
                        title = match.group(1).strip()
                        if title and title != "Pinterest":
                            break

                if not media_items:
                    raise Exception("No media found")

                return jsonify(
                    {
                        "platform": "pinterest",
                        "title": title,
                        "media": media_items,
                        "thumbnail": media_items[0].get("thumbnail")
                        or media_items[0]["url"],
                        "available_qualities": all_qualities,
                        "ux_tip": f"📌 Pinterest • All qualities available with conversion",
                    }
                )

            except Exception as e:
                logger.exception("Pinterest preview failed")
                return jsonify({"error": f"Pinterest preview failed: {str(e)}"}), 500

    except Exception as ex:
        logger.exception("Preview error")
        return jsonify({"error": f"Preview failed: {str(ex)}"}), 500

@app.route("/downloads/<platform>/<path:filename>")
def serve_platform_file(platform, filename):
    """Serve files with range request support"""
    try:
        from urllib.parse import unquote

        filename = unquote(filename)
        filepath = os.path.join(get_download_path(platform), filename)

        if not os.path.exists(filepath):
            logger.error(f"File not found: {filepath}")
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
            response.headers.add(
                "Content-Range", f"bytes {byte_start}-{byte_end}/{file_size}"
            )
            response.headers.add("Accept-Ranges", "bytes")
            response.headers.add("Content-Length", str(length))
            response.headers.add(
                "Content-Disposition", f'attachment; filename="{filename}"'
            )
            return response

        return send_file(
            filepath,
            as_attachment=True,
            download_name=filename,
            mimetype="application/octet-stream",
        )
    except Exception as e:
        logger.exception(f"Error serving file")
        return jsonify({"error": str(e)}), 500


@app.route("/api/proxy-image")
def proxy_image():
    """Proxy images with streaming"""
    image_url = request.args.get("url")
    if not image_url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.instagram.com/",
            "Accept": "image/*",
        }

        response = requests.get(image_url, headers=headers, timeout=15, stream=True)
        response.raise_for_status()

        def generate():
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk

        return Response(
            generate(),
            content_type=response.headers.get("Content-Type", "image/jpeg"),
            headers={
                "Cache-Control": "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
            },
        )
    except Exception as e:
        logger.error(f"Image proxy error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/proxy-video")
def proxy_video():
    """Proxy video streams with Range request support"""
    video_url = request.args.get("url")
    if not video_url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        proxy_headers = {
            "User-Agent": request.headers.get("User-Agent", "Mozilla/5.0"),
            "Referer": "https://www.google.com/",
        }

        range_header = request.headers.get("Range", None)
        if range_header:
            proxy_headers["Range"] = range_header

        response = requests.get(
            video_url,
            headers=proxy_headers,
            timeout=20,
            stream=True,
            allow_redirects=True,
        )
        response.raise_for_status()

        def generate():
            for chunk in response.iter_content(chunk_size=1024 * 64):
                if chunk:
                    yield chunk

        client_response = Response(
            stream_with_context(generate()),
            status=response.status_code,
            content_type=response.headers.get("Content-Type", "video/mp4"),
        )

        allowed_headers = [
            "Content-Type",
            "Content-Length",
            "Content-Range",
            "Accept-Ranges",
        ]
        for header in allowed_headers:
            if header in response.headers:
                client_response.headers[header] = response.headers[header]

        client_response.headers["Cache-Control"] = "public, max-age=86400"
        client_response.headers["Access-Control-Allow-Origin"] = "*"

        return client_response

    except Exception as e:
        logger.error(f"Video proxy error: {e}")
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
        logger.error(e)
        download_sessions[download_id] = {"status": "error", "message": str(e)}
        emit_status(download_id)


def download_stream_fast(
    url, filepath, download_id, start_progress=30, end_progress=90, max_retries=5
):
    """Optimized streaming download with retry logic"""
    for attempt in range(max_retries):
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "*/*",
                "Connection": "keep-alive",
            }

            downloaded = 0
            start_byte = 0
            if os.path.exists(filepath) and attempt > 0:
                downloaded = os.path.getsize(filepath)
                start_byte = downloaded
                headers["Range"] = f"bytes={downloaded}-"
                mode = "ab"
                logger.info(f"Resuming download from byte {downloaded}")
            else:
                mode = "wb"
                # Initialize session with download start time
                if download_sessions.get(download_id):
                    download_sessions[download_id]["download_start_time"] = time.time()
                    download_sessions[download_id]["last_update_time"] = time.time()
                    download_sessions[download_id]["last_bytes_downloaded"] = downloaded
                    emit_status(download_id)

            response = requests.get(
                url, headers=headers, stream=True, timeout=30, allow_redirects=True
            )
            response.raise_for_status()

            total_size = int(response.headers.get("content-length", 0))
            if "content-range" in response.headers:
                range_header = response.headers["content-range"]
                total_size = int(range_header.split("/")[-1])

            # Update total_size in session
            if download_sessions.get(download_id):
                download_sessions[download_id]["total_bytes"] = total_size
                download_sessions[download_id]["downloaded_bytes"] = downloaded
                emit_status(download_id)

            chunk_size = 1024 * 64
            stable_chunks = 0

            with open(filepath, mode) as f:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if download_cancel_flags.get(download_id):
                        f.close()
                        try:
                            os.remove(filepath)
                        except:
                            pass
                        raise Exception("Download cancelled")

                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)

                        stable_chunks += 1
                        if stable_chunks > 10 and chunk_size < 1024 * 256:
                            chunk_size = min(chunk_size * 2, 1024 * 256)

                        # Update real-time metrics every 10 chunks to reduce socket emissions
                        current_time = time.time()
                        if stable_chunks % 10 == 0 and download_sessions.get(download_id):
                            # Calculate metrics
                            session = download_sessions[download_id]
                            last_time = session.get("last_update_time", current_time)
                            last_bytes = session.get("last_bytes_downloaded", start_byte)
                            
                            time_delta = current_time - last_time
                            bytes_delta = downloaded - last_bytes
                            
                            if time_delta > 0:
                                # Calculate instant speed
                                instant_speed = bytes_delta / time_delta
                                
                                # Smooth out speed with exponential moving average
                                old_speed = session.get("current_speed", 0)
                                alpha = 0.7  # Smoothing factor
                                current_speed = alpha * instant_speed + (1 - alpha) * old_speed
                            else:
                                current_speed = session.get("current_speed", 0)
                            
                            # Update session with new metrics
                            session["current_speed"] = current_speed
                            session["downloaded_bytes"] = downloaded
                            session["last_update_time"] = current_time
                            session["last_bytes_downloaded"] = downloaded
                            
                            # Calculate real ETA
                            remaining_bytes = total_size - downloaded if total_size > 0 else 0
                            if current_speed > 0 and remaining_bytes > 0:
                                eta_seconds = remaining_bytes / current_speed
                                session["eta_seconds"] = eta_seconds
                            else:
                                session["eta_seconds"] = None
                            
                            if total_size > 0:
                                progress = start_progress + int(
                                    (downloaded / total_size)
                                    * (end_progress - start_progress)
                                )
                                session["progress"] = min(progress, 100)
                                session["message"] = f"Downloading... {progress}%"
                                
                            emit_status(download_id)

            logger.info(f"Download completed: {filepath}")
            return True

        except (
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ConnectionError,
            ConnectionResetError,
        ) as e:
            logger.warning(
                f"Download interrupted (attempt {attempt + 1}/{max_retries}): {e}"
            )

            if attempt < max_retries - 1:
                wait_time = min(2**attempt, 10)
                logger.info(f"Retrying in {wait_time} seconds...")

                if download_sessions.get(download_id):
                    download_sessions[download_id][
                        "message"
                    ] = f"Connection lost, retrying in {wait_time}s..."
                    emit_status(download_id)

                time.sleep(wait_time)
                continue
            else:
                logger.error(f"Download failed after {max_retries} attempts")
                raise Exception(
                    f"Download failed: Connection unstable after {max_retries} retries"
                )

        except Exception as e:
            logger.error(f"Download stream error: {e}")
            if os.path.exists(filepath) and attempt == max_retries - 1:
                try:
                    os.remove(filepath)
                except:
                    pass
            raise

    return False

def is_video_file(ffmpeg_path, input_path):
    try:
        probe_cmd = [ffmpeg_path, "-v", "error", "-select_streams", "v:0", "-show_entries",
                     "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", input_path]
        result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=5)
        return "video" in result.stdout.lower()
    except:
        return False


def download_youtube(download_id, url, quality='1080p'):
    try:
        if download_cancel_flags.get(download_id):
            return

        yt = YouTube(url)
        smooth_emit_progress(download_id, 10, f"Fetching streams for {yt.title}...")

        # Try progressive first
        stream = yt.streams.filter(
            progressive=True, file_extension="mp4", res=quality
        ).first()

        if not stream:
            video_stream = yt.streams.filter(
                file_extension="mp4", res=quality, only_video=True
            ).first()
            if not video_stream:
                video_stream = (
                    yt.streams.filter(file_extension="mp4", only_video=True)
                    .order_by("resolution")
                    .desc()
                    .first()
                )
            audio_stream = (
                yt.streams.filter(only_audio=True).order_by("abr").desc().first()
            )
        else:
            video_stream, audio_stream = stream, None

        if not video_stream:
            raise Exception("No suitable video stream available")

        path = get_download_path("youtube")
        filename = sanitize_filename(yt.title) + ".mp4"
        filepath = os.path.join(path, filename)

        # Prepare audio-only filename
        audio_filename = sanitize_filename(yt.title) + "_audio.mp3"
        audio_filepath = os.path.join(path, audio_filename)

        smooth_emit_progress(download_id, 15, "Starting download...")

        if audio_stream:
            tmp_video = filepath + ".video.tmp"
            tmp_audio = filepath + ".audio.tmp"

            try:
                download_sessions[download_id]["message"] = "Downloading video stream..."
                emit_status(download_id)
                download_stream_fast(video_stream.url, tmp_video, download_id, 15, 40)

                download_sessions[download_id]["message"] = "Downloading audio stream..."
                emit_status(download_id)
                download_stream_fast(audio_stream.url, tmp_audio, download_id, 40, 65)

                smooth_emit_progress(download_id, 70, "Merging audio and video...")
                merge_video_audio_fast(tmp_video, tmp_audio, filepath)

                # ✅ NEW: Apply quality conversion if needed
                if quality and quality in QUALITY_MAP and quality != 'none':
                    ext = os.path.splitext(filepath)[1]  # Get file extension
                    converted_file = filepath.replace(ext, f"_{quality}{ext}")
                    try:
                        resize_with_ffmpeg(filepath, converted_file, quality)
                        os.remove(filepath)
                        filepath = converted_file
                        filename = os.path.basename(converted_file)
                    except Exception as e:
                        logger.warning(f"Quality conversion failed for {filename}, keeping original: {e}")


                # Convert audio to MP3
                smooth_emit_progress(download_id, 80, "Creating audio-only MP3...")
                ffmpeg_path = find_ffmpeg()
                if ffmpeg_path:
                    try:
                        cmd = [
                            ffmpeg_path, "-i", tmp_audio,
                            "-vn", "-acodec", "libmp3lame",
                            "-q:a", "2", "-y", audio_filepath,
                        ]
                        subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                    except Exception as e:
                        logger.warning(f"Audio MP3 conversion failed: {e}")

            finally:
                for tmp_file in [tmp_video, tmp_audio]:
                    if os.path.exists(tmp_file):
                        try:
                            os.remove(tmp_file)
                        except Exception as e:
                            logger.warning(f"Failed to remove temp file {tmp_file}: {e}")
        else:
            download_stream_fast(stream.url, filepath, download_id, 15, 85)
            
            # ✅ NEW: Apply quality conversion for progressive streams
            if quality and quality in QUALITY_MAP:
                smooth_emit_progress(download_id, 90, f"Converting to {quality}...")
                converted_file = filepath.replace(".mp4", f"_{quality}.mp4")
                try:
                    resize_with_ffmpeg(filepath, converted_file, quality)
                    os.remove(filepath)
                    filepath = converted_file
                    filename = os.path.basename(converted_file)
                except Exception as e:
                    logger.warning(f"Quality conversion failed, keeping original: {e}")

        # Prepare response with both video and audio links
        response_data = {
            "status": "completed",
            "progress": 100,
            "message": "Download completed! ✅",
            "filename": filename,
            "download_url": f"/downloads/youtube/{filename}",
        }

        # Add audio link if available
        if os.path.exists(audio_filepath):
            response_data["audio_link"] = {
                "url": f"/downloads/youtube/{audio_filename}",
                "filename": audio_filename,
            }

        download_sessions[download_id].update(response_data)
        emit_status(download_id)

    except Exception as e:
        error_msg = str(e)
        logger.exception("YouTube download error")

        if "Connection" in error_msg or "10054" in error_msg:
            error_msg = "Download interrupted. The connection was unstable. Please try again."
        elif "timeout" in error_msg.lower():
            error_msg = "Download timed out. Please check your connection and try again."
        elif "No suitable" in error_msg:
            error_msg = f"Requested quality ({quality}) not available. Try a different quality."
        elif "FFmpeg" in error_msg:
            error_msg += "\n\nPlease install FFmpeg to merge video and audio streams."

        download_sessions[download_id] = {"status": "error", "message": error_msg}
        emit_status(download_id)


def download_instagram(download_id, url, quality='1080p'):
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            raise Exception("Invalid Instagram URL")

        save_path = get_download_path("instagram")
        files = []
        media_urls = []

        # Try Instaloader first
        try:
            L = instaloader.Instaloader(
                download_pictures=False,
                download_videos=False,
                quiet=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            post = instaloader.Post.from_shortcode(L.context, shortcode)

            nodes = []
            try:
                if hasattr(post, "get_sidecar_nodes"):
                    sidecar = post.get_sidecar_nodes
                    if callable(sidecar):
                        nodes = list(sidecar())
                    else:
                        nodes = list(sidecar)
            except:
                pass

            if nodes:
                for node in nodes:
                    is_video = getattr(node, "is_video", False)
                    if is_video:
                        video_url = getattr(node, "video_url", None)
                        if video_url:
                            media_urls.append({
                                "url": str(video_url).replace("\\u0026", "&"),
                                "is_video": True,
                            })
                    else:
                        img_url = getattr(node, "display_url", None)
                        if img_url:
                            media_urls.append({
                                "url": str(img_url).replace("\\u0026", "&"),
                                "is_video": False,
                            })
            else:
                # Single post
                if getattr(post, "is_video", False):
                    media_urls.append({
                        "url": str(post.video_url).replace("\\u0026", "&"),
                        "is_video": True,
                    })
                else:
                    media_urls.append({
                        "url": str(post.url).replace("\\u0026", "&"),
                        "is_video": False,
                    })

        except Exception as insta_error:
            logger.warning(f"Instaloader failed: {insta_error}, using fallback...")

        # Fallback to web scraping if Instaloader fails
        if not media_urls:
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "text/html",
                    "Referer": "https://www.instagram.com/",
                }

                embed_url = f"https://www.instagram.com/p/{shortcode}/embed/captioned/"
                response = requests.get(embed_url, headers=headers, timeout=15)
                response.raise_for_status()
                html = response.text

                # Extract video
                video_patterns = [
                    r'"video_url":"(https://[^"]+)"',
                    r'"video_url":\s*"(https://[^"]+)"',
                ]
                for pattern in video_patterns:
                    match = re.search(pattern, html)
                    if match:
                        video_url = match.group(1).replace("\\u0026", "&").replace("\\/", "/")
                        media_urls.append({"url": video_url, "is_video": True})
                        break

                # Extract images if no video found
                if not media_urls:
                    img_patterns = [
                        r'"display_url":"(https://[^"]+)"',
                        r'"thumbnail_src":"(https://[^"]+)"',
                    ]
                    for pattern in img_patterns:
                        matches = re.findall(pattern, html)
                        for img_url in matches[:10]:
                            clean_url = img_url.replace("\\u0026", "&").replace("\\/", "/")
                            if clean_url not in [m["url"] for m in media_urls]:
                                media_urls.append({"url": clean_url, "is_video": False})

            except Exception as e:
                logger.error(f"Web scraping fallback failed: {e}")

        if not media_urls:
            raise Exception("No media URLs found. The post might be private or unavailable.")

        total = len(media_urls)
        logger.info(f"Found {total} media items to download")

        # Download function for parallel execution
        def download_single_media(idx, media_info):
            try:
                if download_cancel_flags.get(download_id):
                    return None

                media_url = media_info["url"]
                is_video = media_info["is_video"]
                ext = ".mp4" if is_video else ".jpg"
                filename = sanitize_filename(f"{shortcode}_{idx}") + ext
                filepath = os.path.join(save_path, filename)

                download_stream_fast(
                    media_url, filepath, download_id,
                    10 + int((idx - 1) / total * 70),
                    10 + int(idx / total * 70),
                    max_retries=3,
                )

                # ✅ NEW: Apply quality conversion if needed
                if quality and quality in QUALITY_MAP:
                    converted_file = filepath.replace(ext, f"_{quality}{ext}")
                    try:
                        logger.info(f"Converting {filename} to {quality}...")
                        smooth_emit_progress(
                            download_id,
                            70 + int(idx / total * 20),
                            f"Converting to {quality}..."
                        )
                        resize_with_ffmpeg(filepath, converted_file, quality)
                        os.remove(filepath)
                        filepath = converted_file
                        filename = os.path.basename(converted_file)
                    except Exception as e:
                        logger.warning(f"Quality conversion failed for {filename}, keeping original: {e}")

                logger.info(f"Downloaded: {filename}")
                return filename
            except Exception as e:
                logger.error(f"Failed to download media #{idx}: {e}")
                return None

        # Download in parallel
        from concurrent.futures import ThreadPoolExecutor, as_completed

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {
                pool.submit(download_single_media, i + 1, media): i
                for i, media in enumerate(media_urls)
            }

            for future in as_completed(futures):
                if download_cancel_flags.get(download_id):
                    pool.shutdown(wait=False)
                    raise Exception("Download cancelled")

                filename = future.result()
                if filename:
                    files.append(filename)

        if not files:
            raise Exception("No files were downloaded successfully")

        smooth_emit_progress(download_id, 100, "Completed ✅")
        download_sessions[download_id].update({
            "status": "completed",
            "filename": files[0],
            "downloaded_files": files,
            "message": f"Downloaded {len(files)} file(s) at {quality}",
        })
        emit_status(download_id)

    except Exception as e:
        logger.exception("Instagram download error")
        download_sessions[download_id] = {"status": "error", "message": str(e)}
        emit_status(download_id)


def download_pinterest(download_id, url, quality='1080p'):
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.pinterest.com/",
        }

        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        html = r.text

        # Try to find video first
        video_url = extract_video_url(html)

        save_path = get_download_path("pinterest")
        media_url = None

        if video_url:
            media_url = video_url
            ext = ".mp4"
        else:
            # It's an image post - get the highest quality image
            main_image_patterns = [
                r'"images":\{"orig":\{"url":"([^"]+)"',
                r'"url":"(https://i\.pinimg\.com/originals/[^"]+)"',
            ]

            for pattern in main_image_patterns:
                match = re.search(pattern, html)
                if match:
                    media_url = match.group(1).replace("\\u0026", "&").replace("\\/", "/")
                    break

            ext = ".jpg"

        if not media_url:
            raise Exception("No media found for this Pinterest post")

        # Download single file
        filename = sanitize_filename("pinterest_post") + ext
        filepath = os.path.join(save_path, filename)

        download_stream_fast(media_url, filepath, download_id, 10, 80)

        # ✅ NEW: Apply quality conversion if needed
        if quality and quality in QUALITY_MAP:
            smooth_emit_progress(download_id, 85, f"Converting to {quality}...")
            converted_file = filepath.replace(ext, f"_{quality}{ext}")
            try:
                resize_with_ffmpeg(filepath, converted_file, quality)
                os.remove(filepath)
                filepath = converted_file
                filename = os.path.basename(converted_file)
            except Exception as e:
                logger.warning(f"Quality conversion failed, keeping original: {e}")

        smooth_emit_progress(download_id, 100, "Completed ✅")
        download_sessions[download_id].update({
            "status": "completed",
            "filename": filename,
            "downloaded_files": [filename],
            "message": f"Download completed at {quality}!",
        })
        emit_status(download_id)

    except Exception as e:
        logger.exception("Pinterest download error")
        download_sessions[download_id] = {"status": "error", "message": str(e)}
        emit_status(download_id)



@app.route("/api/download-zip")
def download_zip():
    """Create and serve ZIP file"""
    import zipfile
    from io import BytesIO

    platform = request.args.get("platform")
    files = request.args.getlist("files[]")

    if not platform or not files:
        return jsonify({"error": "Missing parameters"}), 400

    zip_buffer = BytesIO()

    try:
        with zipfile.ZipFile(
            zip_buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=1
        ) as zip_file:
            for file in files:
                filepath = os.path.join(get_download_path(platform), file)
                if os.path.exists(filepath):
                    zip_file.write(filepath, file)

        zip_buffer.seek(0)
        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"{platform}_downloads.zip",
        )
    except Exception as e:
        logger.exception("ZIP creation error")
        return jsonify({"error": str(e)}), 500


@app.route("/api/download-with-metadata", methods=["POST"])
def download_with_metadata():
    """Download media with all metadata in a ZIP file - OPTIMIZED VERSION"""
    import zipfile
    from io import BytesIO
    import json
    from datetime import datetime

    try:
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        platform = data.get("platform", "").lower()

        if not url or not platform:
            return jsonify({"error": "Missing URL or platform"}), 400

        logger.info(f"Starting ZIP creation for {platform}: {url}")

        # Fetch preview/metadata first
        metadata = {}
        media_urls = []

        # YOUTUBE
        if platform == "youtube":
            yt = YouTube(url)

            # Get best progressive stream (video+audio)
            progressive = (
                yt.streams.filter(progressive=True, file_extension="mp4")
                .order_by("resolution")
                .desc()
                .first()
            )

            if progressive:
                best_video = progressive
                best_audio = None
            else:
                best_video = (
                    yt.streams.filter(file_extension="mp4", only_video=True)
                    .order_by("resolution")
                    .desc()
                    .first()
                )
                best_audio = (
                    yt.streams.filter(only_audio=True).order_by("abr").desc().first()
                )

            metadata = {
                "platform": "youtube",
                "title": yt.title,
                "description": yt.description or "No description available",
                "author": yt.author,
                "channel_url": yt.channel_url,
                "duration": f"{yt.length // 60}:{yt.length % 60:02d}",
                "views": yt.views,
                "publish_date": str(yt.publish_date) if yt.publish_date else "Unknown",
                "thumbnail_url": yt.thumbnail_url,
                "video_url": url,
                "keywords": yt.keywords if hasattr(yt, "keywords") else [],
                "rating": yt.rating if hasattr(yt, "rating") else None,
            }

            # Add thumbnail (small file)
            media_urls.append(
                {
                    "url": yt.thumbnail_url,
                    "filename": "thumbnail.jpg",
                    "type": "thumbnail",
                }
            )

            # Add video URL (large file)
            if progressive:
                media_urls.append(
                    {
                        "url": best_video.url,
                        "filename": sanitize_filename(yt.title) + ".mp4",
                        "type": "video",
                    }
                )
            else:
                media_urls.append(
                    {
                        "url": best_video.url,
                        "filename": sanitize_filename(yt.title) + "_video.mp4",
                        "type": "video_only",
                    }
                )
                if best_audio:
                    media_urls.append(
                        {
                            "url": best_audio.url,
                            "filename": sanitize_filename(yt.title) + "_audio.mp4",
                            "type": "audio",
                        }
                    )

            # Add audio-only MP3 (requires conversion - skip in ZIP)
            # This would take too long for ZIP creation

        # INSTAGRAM
        elif platform == "instagram":
            shortcode = extract_shortcode(url)
            if not shortcode:
                return jsonify({"error": "Invalid Instagram URL"}), 400

            title = "Instagram Post"
            author = None
            caption = None
            likes = None
            comments = None
            post_date = None

            try:
                L = instaloader.Instaloader(
                    download_pictures=False,
                    download_videos=False,
                    quiet=True,
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                post = instaloader.Post.from_shortcode(L.context, shortcode)

                if hasattr(post, "caption") and post.caption:
                    caption = str(post.caption).strip()
                    title = caption[:100] + ("..." if len(caption) > 100 else "")

                author = post.owner_username if hasattr(post, "owner_username") else None
                likes = post.likes if hasattr(post, "likes") else None
                comments = post.comments if hasattr(post, "comments") else None
                post_date = str(post.date) if hasattr(post, "date") else None

                nodes = []
                try:
                    if hasattr(post, "get_sidecar_nodes"):
                        sidecar = post.get_sidecar_nodes
                        nodes = list(sidecar()) if callable(sidecar) else list(sidecar)
                except:
                    pass

                if nodes:
                    for idx, node in enumerate(nodes):
                        is_video = getattr(node, "is_video", False)
                        if is_video:
                            video_url = getattr(node, "video_url", None)
                            if video_url:
                                media_urls.append(
                                    {
                                        "url": str(video_url).replace("\\u0026", "&"),
                                        "filename": f"{shortcode}_{idx+1}.mp4",
                                        "type": "video",
                                    }
                                )
                        else:
                            img_url = getattr(node, "display_url", None)
                            if img_url:
                                media_urls.append(
                                    {
                                        "url": str(img_url).replace("\\u0026", "&"),
                                        "filename": f"{shortcode}_{idx+1}.jpg",
                                        "type": "image",
                                    }
                                )
                else:
                    if getattr(post, "is_video", False):
                        media_urls.append(
                            {
                                "url": str(post.video_url).replace("\\u0026", "&"),
                                "filename": f"{shortcode}.mp4",
                                "type": "video",
                            }
                        )
                    else:
                        media_urls.append(
                            {
                                "url": str(post.url).replace("\\u0026", "&"),
                                "filename": f"{shortcode}.jpg",
                                "type": "image",
                            }
                        )

            except Exception as e:
                logger.warning(f"Instagram metadata extraction failed: {e}")
                return jsonify({"error": "Failed to fetch Instagram post metadata"}), 500

            metadata = {
                "platform": "instagram",
                "title": title,
                "caption": caption or "No caption",
                "author": f"@{author}" if author else "Unknown",
                "likes": likes,
                "comments_count": comments,
                "post_date": post_date,
                "post_url": url,
                "shortcode": shortcode,
                "media_count": len(media_urls),
            }

        # PINTEREST
        elif platform == "pinterest":
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.pinterest.com/",
            }

            r = requests.get(url, headers=headers, timeout=15)
            r.raise_for_status()
            html = r.text

            title = "Pinterest Post"
            description = ""
            author = None

            title_patterns = [
                r'"title":"([^"]{1,500})',
                r'"description":"([^"]{1,500})',
                r'<meta property="og:title" content="([^"]+)"',
            ]
            for pattern in title_patterns:
                match = re.search(pattern, html)
                if match:
                    title = match.group(1).strip()
                    if title and title != "Pinterest":
                        break

            desc_patterns = [
                r'"description":"([^"]{1,1000})',
                r'<meta property="og:description" content="([^"]+)"',
            ]
            for pattern in desc_patterns:
                match = re.search(pattern, html)
                if match:
                    description = match.group(1).strip()
                    break

            author_pattern = r'"pinner":\{"username":"([^"]+)"'
            author_match = re.search(author_pattern, html)
            if author_match:
                author = author_match.group(1)

            video_url = extract_video_url(html)

            if video_url:
                media_urls.append(
                    {
                        "url": video_url.replace("\\u0026", "&"),
                        "filename": "pinterest_video.mp4",
                        "type": "video",
                    }
                )

                thumbnail_match = re.search(r'"thumbnailUrl":"([^"]+)"', html)
                if thumbnail_match:
                    media_urls.append(
                        {
                            "url": thumbnail_match.group(1).replace("\\u0026", "&"),
                            "filename": "thumbnail.jpg",
                            "type": "thumbnail",
                        }
                    )
            else:
                main_image_patterns = [
                    r'"images":\{"orig":\{"url":"([^"]+)"',
                    r'"url":"(https://i\.pinimg\.com/originals/[^"]+)"',
                ]
                for pattern in main_image_patterns:
                    match = re.search(pattern, html)
                    if match:
                        img_url = match.group(1).replace("\\u0026", "&").replace("\\/", "/")
                        media_urls.append(
                            {
                                "url": img_url,
                                "filename": "pinterest_image.jpg",
                                "type": "image",
                            }
                        )
                        break

            metadata = {
                "platform": "pinterest",
                "title": title,
                "description": description or "No description",
                "author": author or "Unknown",
                "post_url": url,
                "media_type": "video" if video_url else "image",
            }

        else:
            return jsonify({"error": "Unsupported platform"}), 400

        if not media_urls:
            return jsonify({"error": "No media found"}), 404

        logger.info(f"Found {len(media_urls)} media items to download")

        # Create ZIP file in memory with streaming
        zip_buffer = BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zip_file:
            # Add metadata as JSON
            metadata["downloaded_at"] = datetime.now().isoformat()
            metadata["download_url"] = url

            zip_file.writestr(
                "metadata.json", json.dumps(metadata, indent=2, ensure_ascii=False)
            )

            # Add README
            readme_content = f"""
{'='*60}
{metadata['platform'].upper()} POST INFORMATION
{'='*60}

Title: {metadata.get('title', 'N/A')}
Author: {metadata.get('author', 'N/A')}
URL: {url}

"""
            if platform == "youtube":
                readme_content += f"""
Description:
{metadata.get('description', 'N/A')}

Duration: {metadata.get('duration', 'N/A')}
Views: {metadata.get('views', 'N/A'):,} views
Published: {metadata.get('publish_date', 'N/A')}
Channel: {metadata.get('channel_url', 'N/A')}
"""
            elif platform == "instagram":
                readme_content += f"""
Caption:
{metadata.get('caption', 'N/A')}

Likes: {metadata.get('likes', 'N/A'):,} likes
Comments: {metadata.get('comments_count', 'N/A'):,} comments
Posted: {metadata.get('post_date', 'N/A')}
Media Count: {metadata.get('media_count', 1)}
"""
            elif platform == "pinterest":
                readme_content += f"""
Description:
{metadata.get('description', 'N/A')}

Media Type: {metadata.get('media_type', 'N/A')}
"""

            readme_content += f"""
{'='*60}
Downloaded: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
{'='*60}
"""

            zip_file.writestr("README.txt", readme_content)

            # Download and add media files with streaming
            for idx, media_info in enumerate(media_urls):
                try:
                    logger.info(f"Downloading media {idx+1}/{len(media_urls)}: {media_info['filename']}")
                    
                    media_response = requests.get(
                        media_info["url"],
                        headers={
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                            "Referer": (
                                "https://www.instagram.com/"
                                if platform == "instagram"
                                else "https://www.pinterest.com/"
                            ),
                        },
                        timeout=60,  # Increased timeout
                        stream=True,
                    )
                    media_response.raise_for_status()

                    # Stream directly to ZIP without loading entire file into memory
                    media_content = BytesIO()
                    for chunk in media_response.iter_content(chunk_size=8192 * 8):  # 64KB chunks
                        if chunk:
                            media_content.write(chunk)

                    media_content.seek(0)
                    zip_file.writestr(media_info["filename"], media_content.getvalue())

                    logger.info(f"✓ Added to ZIP: {media_info['filename']}")

                except Exception as e:
                    logger.error(f"Failed to download media {media_info['filename']}: {e}")
                    # Add error note to ZIP
                    zip_file.writestr(
                        f"ERROR_{media_info['filename']}.txt",
                        f"Failed to download this file.\nURL: {media_info['url']}\nError: {str(e)}",
                    )

        zip_buffer.seek(0)

        # Generate filename
        safe_title = sanitize_filename(metadata.get("title", platform))[:50]
        zip_filename = f"{platform}_{safe_title}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"

        logger.info(f"✓ ZIP created successfully: {zip_filename}")

        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=zip_filename,
        )

    except Exception as e:
        logger.exception("Metadata ZIP download error")
        return jsonify({"error": str(e)}), 500

# 1. Add this new endpoint for audio-only download to your Flask backend:


@app.route("/api/download-audio", methods=["POST"])
def download_audio_only():
    """Download audio only from video platforms"""
    try:
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        platform = data.get("platform", "").lower()

        if not url:
            return jsonify({"error": "Missing URL"}), 400

        # Only YouTube, Instagram videos, and Pinterest videos support audio extraction
        if platform not in ["youtube", "instagram", "pinterest"]:
            return (
                jsonify({"error": "Audio extraction not supported for this platform"}),
                400,
            )

        download_id = str(uuid.uuid4())
        download_sessions[download_id] = {
            "status": "queued",
            "progress": 0,
            "message": "Extracting audio...",
            "platform": platform,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "current_speed": 0,
            "eta_seconds": None,
            "download_start_time": None,
            "last_update_time": None,
            "last_bytes_downloaded": 0,
        }
        emit_status(download_id)
        download_cancel_flags.pop(download_id, None)

        executor.submit(process_audio_download, download_id, url, platform)

        return jsonify({"download_id": download_id}), 202

    except Exception as e:
        logger.error(e)
        return jsonify({"error": str(e)}), 500


def process_audio_download(download_id, url, platform):
    """Process audio extraction for different platforms"""
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
        logger.error(e)
        download_sessions[download_id] = {"status": "error", "message": str(e)}
        emit_status(download_id)


def extract_youtube_audio(download_id, url):
    """Download YouTube audio directly (no video, no FFmpeg)"""
    yt = YouTube(url)

    smooth_emit_progress(download_id, 10, f"Fetching audio streams for {yt.title}...")

    # Select best audio-only stream (Opus or M4A)
    stream = yt.streams.filter(only_audio=True).order_by("abr").desc().first()
    if not stream:
        raise Exception("No audio-only stream found.")

    # Determine file extension based on stream type
    mime = stream.mime_type or ""
    ext = "webm" if "webm" in mime else "m4a"

    # Prepare output paths
    path = get_download_path("youtube")
    filename = sanitize_filename(yt.title) + f".{ext}"
    filepath = os.path.join(path, filename)

    smooth_emit_progress(download_id, 25, "Downloading audio stream directly...")

    # Directly download audio file (no ffmpeg conversion)
    stream.download(output_path=path, filename=filename)

    smooth_emit_progress(download_id, 100, "Audio download completed ✅")

    download_sessions[download_id].update(
        {
            "status": "completed",
            "progress": 100,
            "message": "Audio downloaded successfully! ✅",
            "filename": filename,
            "downloaded_files": [filename],
            "download_url": f"/downloads/youtube/{filename}",
        }
    )
    emit_status(download_id)

    logger.info(f"✅ Downloaded YouTube audio ({mime}) to {filepath}")
    return filepath


def extract_instagram_audio(download_id, url):
    """Extract audio from Instagram video - streams directly without downloading full video"""
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            raise Exception("Invalid Instagram URL")

        # Get video URL
        video_url = None
        try:
            L = instaloader.Instaloader(
                download_pictures=False,
                download_videos=False,
                quiet=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            post = instaloader.Post.from_shortcode(L.context, shortcode)

            if getattr(post, "is_video", False):
                video_url = str(post.video_url).replace("\\u0026", "&")
        except:
            pass

        if not video_url:
            raise Exception(
                "This Instagram post doesn't contain a video or audio extraction failed"
            )

        path = get_download_path("instagram")
        filename = sanitize_filename(f"{shortcode}_audio.mp3")
        filepath = os.path.join(path, filename)

        # Extract audio directly using FFmpeg - NO temp video file needed!
        ffmpeg_path = find_ffmpeg()
        if not ffmpeg_path:
            raise Exception(
                "FFmpeg is required for audio extraction. Please install FFmpeg."
            )

        smooth_emit_progress(download_id, 20, "Extracting audio directly (fast)...")
        
        # FFmpeg extracts audio directly from URL - only downloads audio portion!
        cmd = [
            ffmpeg_path,
            "-i",
            video_url,
            "-vn",  # Skip video
            "-acodec",
            "libmp3lame",
            "-b:a",
            "192k",  # Good quality, small size
            "-y",
            filepath,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)

        if result.returncode != 0:
            raise Exception(f"Audio extraction failed: {result.stderr}")

        smooth_emit_progress(download_id, 100, "Audio extracted! ✅")

        download_sessions[download_id].update(
            {
                "status": "completed",
                "progress": 100,
                "message": "Audio extracted successfully! ✅",
                "filename": filename,
                "downloaded_files": [filename],
                "download_url": f"/downloads/instagram/{filename}",
            }
        )
        emit_status(download_id)

    except Exception as e:
        logger.exception("Instagram audio extraction error")
        download_sessions[download_id] = {"status": "error", "message": str(e)}
        emit_status(download_id)


def extract_pinterest_audio(download_id, url):
    """Extract audio from Pinterest video - streams directly"""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.pinterest.com/",
        }

        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        html = r.text

        video_url = extract_video_url(html)
        if not video_url:
            raise Exception("This Pinterest post doesn't contain a video")

        path = get_download_path("pinterest")
        filename = sanitize_filename("pinterest_audio.mp3")
        filepath = os.path.join(path, filename)

        # Extract audio directly using FFmpeg
        ffmpeg_path = find_ffmpeg()
        if not ffmpeg_path:
            raise Exception("FFmpeg is required for audio extraction")

        smooth_emit_progress(download_id, 20, "Extracting audio directly (fast)...")
        
        # FFmpeg extracts only audio from URL - no full video download!
        cmd = [
            ffmpeg_path,
            "-i",
            video_url,
            "-vn",  # No video
            "-acodec",
            "libmp3lame",
            "-b:a",
            "192k",
            "-y",
            filepath,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)

        if result.returncode != 0:
            raise Exception(f"Audio extraction failed: {result.stderr}")

        smooth_emit_progress(download_id, 100, "Audio extracted! ✅")

        download_sessions[download_id].update(
            {
                "status": "completed",
                "progress": 100,
                "message": "Audio extracted successfully! ✅",
                "filename": filename,
                "downloaded_files": [filename],
                "download_url": f"/downloads/pinterest/{filename}",
            }
        )
        emit_status(download_id)

    except Exception as e:
        logger.exception("Pinterest audio extraction error")
        download_sessions[download_id] = {"status": "error", "message": str(e)}
        emit_status(download_id)



if __name__ == "__main__":
    # Check FFmpeg on startup
    ffmpeg = find_ffmpeg()
    if ffmpeg:
        logger.info(f"✅ FFmpeg found at: {ffmpeg}")
    else:
        logger.warning(
            "⚠️ FFmpeg not found! YouTube downloads with separate audio/video will fail."
        )
        logger.warning("Install FFmpeg: https://ffmpeg.org/download.html")

    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)