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


def get_download_path(platform):
    path = os.path.join(DOWNLOADS_DIR, platform)
    os.makedirs(path, exist_ok=True)
    return path


def find_ffmpeg():
    """Find FFmpeg executable in system"""
    # Try common locations
    possible_paths = [
        'ffmpeg',  # System PATH
        'ffmpeg.exe',  # Windows
        '/usr/bin/ffmpeg',  # Linux
        '/usr/local/bin/ffmpeg',  # macOS
        os.path.join(os.getcwd(), 'ffmpeg.exe'),  # Local directory
        os.path.join(os.getcwd(), 'ffmpeg', 'ffmpeg.exe'),  # ffmpeg folder
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
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-preset", "ultrafast",
            "-threads", "0",
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


def emit_status(download_id):
    session = download_sessions.get(download_id)
    if session:
        socketio.emit(
            "download_update",
            {"download_id": download_id, "session": session},
            room=download_id,
        )


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


def smooth_emit_progress(download_id, target_progress, message=None, step=2, delay=0.05):
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
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "ffmpeg_available": ffmpeg_available
    })


@app.route("/api/download", methods=["POST"])
def start_download():
    try:
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        platform = data.get("platform", "").lower()
        quality = data.get("quality", "highest").lower()

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
        }
        emit_status(download_id)
        download_cancel_flags.pop(download_id, None)

        executor.submit(process_download, download_id, url, platform, quality)

        return jsonify({"download_id": download_id}), 202

    except Exception as e:
        logger.error(e)
        return jsonify({"error": str(e)}), 500


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

        # YOUTUBE
        if platform == "youtube":
            yt = YouTube(url)
            video_streams = yt.streams.filter(file_extension="mp4", only_video=True)
            progressive = yt.streams.filter(progressive=True, file_extension="mp4")
            qualities = [s.resolution for s in video_streams if s.resolution]
            prog_qualities = [s.resolution for s in progressive if s.resolution]
            all_qualities = sorted(list(set(qualities + prog_qualities)), reverse=True)

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
                    "video_url": best_video.url if best_video else None,
                    "audio_url": best_audio.url if best_audio else None,
                    "available_qualities": all_qualities,
                    "duration": yt.length,
                    "author": yt.author,
                    "ux_tip": "🎥 YouTube HD/4K video detected • Adaptive stream support enabled",
                }
            )

        # INSTAGRAM
        if platform == "instagram":
            shortcode = extract_shortcode(url)
            if not shortcode:
                return jsonify({"error": "Invalid Instagram link"}), 400

            media_items = []

            # Method 1: Try Instaloader first
            try:
                L = instaloader.Instaloader(
                    download_pictures=False,
                    download_videos=False,
                    quiet=True,
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                post = instaloader.Post.from_shortcode(L.context, shortcode)

                # Try to get sidecar (carousel) posts
                nodes = []
                try:
                    if hasattr(post, 'get_sidecar_nodes'):
                        sidecar = post.get_sidecar_nodes
                        if callable(sidecar):
                            nodes = list(sidecar())
                        else:
                            nodes = list(sidecar)
                except:
                    pass

                # Process nodes
                if nodes:
                    for node in nodes:
                        is_video = getattr(node, 'is_video', False)
                        if is_video:
                            video_url = getattr(node, 'video_url', None)
                            thumbnail = getattr(node, 'display_url', None)
                            if video_url:
                                media_items.append({
                                    "type": "video",
                                    "url": str(video_url).replace("\\u0026", "&"),
                                    "thumbnail": str(thumbnail) if thumbnail else None,
                                })
                        else:
                            img_url = getattr(node, 'display_url', None)
                            if img_url:
                                media_items.append({
                                    "type": "image",
                                    "url": str(img_url).replace("\\u0026", "&"),
                                })
                else:
                    # Single post
                    if getattr(post, 'is_video', False):
                        media_items.append({
                            "type": "video",
                            "url": str(post.video_url).replace("\\u0026", "&"),
                            "thumbnail": str(post.url),
                        })
                    else:
                        media_items.append({
                            "type": "image",
                            "url": str(post.url).replace("\\u0026", "&"),
                        })

            except Exception as e:
                logger.warning(f"Instaloader failed: {e}")

            # Method 2: Fallback to web scraping
            if not media_items:
                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "en-US,en;q=0.9",
                    }
                    
                    # Try embed URL
                    embed_url = f"https://www.instagram.com/p/{shortcode}/embed/captioned/"
                    response = requests.get(embed_url, headers=headers, timeout=15)
                    
                    if response.status_code == 200:
                        html = response.text
                        
                        # Extract video URL
                        video_patterns = [
                            r'"video_url":"(https://[^"]+)"',
                            r'"video_url":\s*"(https://[^"]+)"',
                        ]
                        for pattern in video_patterns:
                            match = re.search(pattern, html)
                            if match:
                                video_url = match.group(1).replace("\\u0026", "&").replace("\\/", "/")
                                media_items.append({
                                    "type": "video",
                                    "url": video_url,
                                    "thumbnail": None,
                                })
                                break
                        
                        # Extract images
                        if not media_items:
                            img_patterns = [
                                r'"display_url":"(https://[^"]+)"',
                                r'"thumbnail_src":"(https://[^"]+)"',
                            ]
                            for pattern in img_patterns:
                                matches = re.findall(pattern, html)
                                for img_url in matches[:5]:  # Limit to 5 images
                                    clean_url = img_url.replace("\\u0026", "&").replace("\\/", "/")
                                    if clean_url not in [m["url"] for m in media_items]:
                                        media_items.append({
                                            "type": "image",
                                            "url": clean_url,
                                        })

                except Exception as e:
                    logger.error(f"Web scraping failed: {e}")

            if not media_items:
                return jsonify({"error": "No media found. The post might be private or unavailable."}), 404

            return jsonify({
                "platform": "instagram",
                "title": "Instagram Post",
                "media": media_items,
                "thumbnail": media_items[0].get("thumbnail") or media_items[0]["url"],
                "available_qualities": ["1080p"],
                "ux_tip": f"📱 Instagram Post with {len(media_items)} media file(s)",
            })

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

                    media_items.append({
                        "type": "video",
                        "url": video_url.replace("\\u0026", "&"),
                        "thumbnail": thumbnail,
                    })
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

                return jsonify({
                    "platform": "pinterest",
                    "title": title,
                    "media": media_items,
                    "thumbnail": media_items[0].get("thumbnail") or media_items[0]["url"],
                    "available_qualities": ["1080p", "720p"] if video_url else ["original"],
                    "ux_tip": f"📌 Pinterest {'Video' if video_url else 'Image'}",
                })

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
        smooth_emit_progress(download_id, 5, "Preparing download...")
        if platform == "youtube":
            download_youtube(download_id, url, quality)
        elif platform == "instagram":
            download_instagram(download_id, url)
        elif platform == "pinterest":
            download_pinterest(download_id, url)
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
            if os.path.exists(filepath) and attempt > 0:
                downloaded = os.path.getsize(filepath)
                headers["Range"] = f"bytes={downloaded}-"
                mode = "ab"
                logger.info(f"Resuming download from byte {downloaded}")
            else:
                mode = "wb"

            response = requests.get(
                url, headers=headers, stream=True, timeout=30, allow_redirects=True
            )
            response.raise_for_status()

            total_size = int(response.headers.get("content-length", 0))
            if "content-range" in response.headers:
                range_header = response.headers["content-range"]
                total_size = int(range_header.split("/")[-1])

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

                        if stable_chunks % 5 == 0:
                            if total_size > 0:
                                progress = start_progress + int(
                                    (downloaded / total_size)
                                    * (end_progress - start_progress)
                                )
                                if download_sessions.get(download_id):
                                    download_sessions[download_id]["progress"] = min(
                                        progress, 100
                                    )
                                    download_sessions[download_id][
                                        "message"
                                    ] = f"Downloading... {progress}%"
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


def download_youtube(download_id, url, quality):
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

        smooth_emit_progress(download_id, 15, "Starting download...")

        if audio_stream:
            tmp_video = filepath + ".video.tmp"
            tmp_audio = filepath + ".audio.tmp"

            try:
                download_sessions[download_id][
                    "message"
                ] = "Downloading video stream..."
                emit_status(download_id)
                download_stream_fast(video_stream.url, tmp_video, download_id, 15, 50)

                download_sessions[download_id][
                    "message"
                ] = "Downloading audio stream..."
                emit_status(download_id)
                download_stream_fast(audio_stream.url, tmp_audio, download_id, 50, 80)

                smooth_emit_progress(download_id, 85, "Merging audio and video...")
                merge_video_audio_fast(tmp_video, tmp_audio, filepath)

            finally:
                for tmp_file in [tmp_video, tmp_audio]:
                    if os.path.exists(tmp_file):
                        try:
                            os.remove(tmp_file)
                        except Exception as e:
                            logger.warning(f"Failed to remove temp file {tmp_file}: {e}")
        else:
            download_stream_fast(stream.url, filepath, download_id, 15, 95)

        # Instantly set to 100% when complete
        download_sessions[download_id].update(
            {
                "status": "completed",
                "progress": 100,
                "message": "Download completed! ✅",
                "filename": filename,
                "download_url": f"/downloads/youtube/{filename}",
            }
        )
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


def download_instagram(download_id, url):
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
                if hasattr(post, 'get_sidecar_nodes'):
                    sidecar = post.get_sidecar_nodes
                    if callable(sidecar):
                        nodes = list(sidecar())
                    else:
                        nodes = list(sidecar)
            except:
                pass

            if nodes:
                for node in nodes:
                    is_video = getattr(node, 'is_video', False)
                    if is_video:
                        video_url = getattr(node, 'video_url', None)
                        if video_url:
                            media_urls.append({
                                "url": str(video_url).replace("\\u0026", "&"),
                                "is_video": True
                            })
                    else:
                        img_url = getattr(node, 'display_url', None)
                        if img_url:
                            media_urls.append({
                                "url": str(img_url).replace("\\u0026", "&"),
                                "is_video": False
                            })
            else:
                # Single post
                if getattr(post, 'is_video', False):
                    media_urls.append({
                        "url": str(post.video_url).replace("\\u0026", "&"),
                        "is_video": True
                    })
                else:
                    media_urls.append({
                        "url": str(post.url).replace("\\u0026", "&"),
                        "is_video": False
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
                    media_url,
                    filepath,
                    download_id,
                    10 + int((idx - 1) / total * 80),
                    10 + int(idx / total * 80),
                    max_retries=3,
                )

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
        download_sessions[download_id].update(
            {
                "status": "completed",
                "filename": files[0],
                "downloaded_files": files,
                "message": f"Downloaded {len(files)} file(s)",
            }
        )
        emit_status(download_id)

    except Exception as e:
        logger.exception("Instagram download error")
        download_sessions[download_id] = {"status": "error", "message": str(e)}
        emit_status(download_id)


def download_pinterest(download_id, url):
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.pinterest.com/",
        }

        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        html = r.text

        video_url = extract_video_url(html)
        images = re.findall(r'"(https:[^"]+\.pinimg\.com[^"]+?)"', html)
        image_urls = list(
            {i.replace("\\u0026", "&") for i in images if "236x" not in i}
        )

        save_path = get_download_path("pinterest")
        media_urls = [video_url] if video_url else []
        media_urls += image_urls[:5]

        if not media_urls:
            raise Exception("No media found")

        files = []
        total_files = len(media_urls)

        for idx, media in enumerate(media_urls, 1):
            if download_cancel_flags.get(download_id):
                raise Exception("Download cancelled")

            ext = ".mp4" if media.endswith(".mp4") else ".jpg"
            filename = sanitize_filename(f"pinterest_{idx}") + ext
            filepath = os.path.join(save_path, filename)

            start_prog = 10 + int((idx - 1) / total_files * 80)
            end_prog = 10 + int(idx / total_files * 80)

            download_stream_fast(media, filepath, download_id, start_prog, end_prog)
            files.append(filename)

        smooth_emit_progress(download_id, 100, "Completed ✅")
        download_sessions[download_id].update(
            {
                "status": "completed",
                "filename": files[0],
                "downloaded_files": files,
                "message": f"Downloaded {len(files)} file(s)",
            }
        )
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


if __name__ == "__main__":
    # Check FFmpeg on startup
    ffmpeg = find_ffmpeg()
    if ffmpeg:
        logger.info(f"✅ FFmpeg found at: {ffmpeg}")
    else:
        logger.warning("⚠️ FFmpeg not found! YouTube downloads with separate audio/video will fail.")
        logger.warning("Install FFmpeg: https://ffmpeg.org/download.html")
    
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)