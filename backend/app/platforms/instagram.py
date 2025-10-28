# app/platforms/instagram.py
import os
import logging
import re
import instaloader
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from ..config import download_sessions, download_cancel_flags
from ..utils import get_download_path, smooth_emit_progress, emit_status, resize_with_ffmpeg, download_stream_fast, sanitize_filename
logger = logging.getLogger(__name__)

def extract_shortcode(url):
    m = re.search(r"/(?:p|reel|reels)/([A-Za-z0-9_-]+)", url)
    return m.group(1) if m else None

def gather_instagram_metadata(url):
    """Return (metadata, media_urls_list) where media_urls_list contains dicts {url, filename, type}"""
    shortcode = extract_shortcode(url)
    if not shortcode:
        raise Exception("Invalid Instagram URL")
    metadata = {"platform":"instagram","post_url":url}
    media_urls = []
    try:
        L = instaloader.Instaloader(download_pictures=False, download_videos=False, quiet=True, user_agent="Mozilla/5.0")
        post = instaloader.Post.from_shortcode(L.context, shortcode)
        title = "Instagram Post"
        caption = getattr(post, "caption", None)
        if caption:
            title = caption[:100] + ("..." if len(caption) > 100 else "")
        metadata.update({
            "title": title,
            "author": getattr(post, "owner_username", None),
            "caption": caption
        })
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
                        media_urls.append({"url": str(video_url).replace("\\u0026","&"), "filename": f"{shortcode}_{idx+1}.mp4", "type":"video"})
                else:
                    img_url = getattr(node, "display_url", None)
                    if img_url:
                        media_urls.append({"url": str(img_url).replace("\\u0026","&"), "filename": f"{shortcode}_{idx+1}.jpg", "type":"image"})
        else:
            if getattr(post, "is_video", False):
                media_urls.append({"url": str(post.video_url).replace("\\u0026","&"), "filename": f"{shortcode}.mp4", "type":"video"})
            else:
                media_urls.append({"url": str(post.url).replace("\\u0026","&"), "filename": f"{shortcode}.jpg", "type":"image"})
    except Exception as e:
        # fallback scraping
        try:
            headers = {"User-Agent":"Mozilla/5.0","Referer":"https://www.instagram.com/"}
            embed_url = f"https://www.instagram.com/p/{shortcode}/embed/captioned/"
            r = requests.get(embed_url, headers=headers, timeout=15)
            r.raise_for_status()
            html = r.text
            video_patterns = [r'"video_url":"(https://[^"]+)"', r'"video_url":\s*"(https://[^"]+)"']
            for pattern in video_patterns:
                match = re.search(pattern, html)
                if match:
                    media_urls.append({"url": match.group(1).replace("\\u0026","&").replace("\\/","/"), "filename": f"{shortcode}.mp4", "type":"video"})
                    break
            if not media_urls:
                img_patterns = [r'"display_url":"(https://[^"]+)"', r'"thumbnail_src":"(https://[^"]+)"']
                for pattern in img_patterns:
                    matches = re.findall(pattern, html)
                    for i, img_url in enumerate(matches[:10]):
                        clean_url = img_url.replace("\\u0026","&").replace("\\/","/")
                        media_urls.append({"url": clean_url, "filename": f"{shortcode}_{i+1}.jpg", "type":"image"})
        except Exception:
            raise Exception("Failed to gather metadata")
    return metadata, media_urls

def download_instagram(download_id, url, quality='1080p'):
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            raise Exception("Invalid Instagram URL")
        save_path = get_download_path("instagram")
        metadata, media_urls = gather_instagram_metadata(url)
        if not media_urls:
            raise Exception("No media URLs found")
        files = []
        def download_single(idx, mi):
            if download_cancel_flags.get(download_id):
                return None
            media_url = mi["url"]
            is_video = mi["type"] == "video"
            ext = ".mp4" if is_video else ".jpg"
            filename = sanitize_filename(mi.get("filename", f"{shortcode}_{idx}{ext}"))
            filepath = os.path.join(save_path, filename)
            download_stream_fast(media_url, filepath, download_id, 10 + int((idx-1)/len(media_urls)*70), 10 + int(idx/len(media_urls)*70), max_retries=3)
            # conversion
            from ..config import QUALITY_MAP
            if quality and quality in QUALITY_MAP:

                converted = filepath.replace(ext, f"_{quality}{ext}")
                try:
                    smooth_emit_progress(download_id, 70 + int(idx/len(media_urls)*20), f"Converting to {quality}...")
                    resize_with_ffmpeg(filepath, converted, quality)
                    os.remove(filepath)
                    filepath = converted
                    filename = os.path.basename(converted)
                except Exception as e:
                    logger.warning(f"Quality conversion failed for {filename}: {e}")
            return filename

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(download_single, i+1, m): i for i,m in enumerate(media_urls)}
            for future in as_completed(futures):
                if download_cancel_flags.get(download_id):
                    pool.shutdown(wait=False)
                    raise Exception("Download cancelled")
                fn = future.result()
                if fn:
                    files.append(fn)
        if not files:
            raise Exception("No files downloaded")
        smooth_emit_progress(download_id, 100, "Completed ✅")
        download_sessions[download_id].update({
            "status":"completed",
            "filename": files[0],
            "downloaded_files": files,
            "message": f"Downloaded {len(files)} file(s)"
        })
        emit_status(download_id)
    except Exception as e:
        logger.exception("Instagram download error")
        download_sessions[download_id] = {"status":"error","message":str(e)}
        emit_status(download_id)

def extract_instagram_audio(download_id, url):
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            raise Exception("Invalid Instagram URL")
        metadata, media_urls = gather_instagram_metadata(url)
        video_url = None
        for m in media_urls:
            if m["type"] == "video":
                video_url = m["url"]
                break
        if not video_url:
            raise Exception("No video found for audio extraction")
        save_path = get_download_path("instagram")
        filename = sanitize_filename(f"{shortcode}_audio.mp3")
        filepath = os.path.join(save_path, filename)
        ffmpeg_path = __import__("..utils", fromlist=["find_ffmpeg"]).find_ffmpeg()
        if not ffmpeg_path:
            raise Exception("FFmpeg is required for audio extraction")
        smooth_emit_progress(download_id, 20, "Extracting audio directly (fast)...")
        cmd = [ffmpeg_path, "-i", video_url, "-vn", "-acodec", "libmp3lame", "-b:a", "192k", "-y", filepath]
        subprocess = __import__("subprocess")
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if res.returncode != 0:
            raise Exception(f"Audio extraction failed: {res.stderr}")
        smooth_emit_progress(download_id, 100, "Audio extracted! ✅")
        download_sessions[download_id].update({"status":"completed","progress":100,"message":"Audio extracted successfully! ✅","filename":filename,"downloaded_files":[filename],"download_url":f"/downloads/instagram/{filename}"})
        emit_status(download_id)
    except Exception as e:
        logger.exception("Instagram audio extraction error")
        download_sessions[download_id] = {"status":"error","message":str(e)}
        emit_status(download_id)
