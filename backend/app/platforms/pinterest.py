# app/platforms/pinterest.py
import os
import re
import logging
import requests
from ..config import download_sessions, download_cancel_flags
from ..utils import get_download_path, smooth_emit_progress, emit_status, resize_with_ffmpeg, download_stream_fast, sanitize_filename
logger = logging.getLogger(__name__)

def extract_video_url(html):
    patterns = [
        r'"video_url":"(https:[^"]+mp4[^"]*)"',
        r'"contentUrl":"(https:[^"]+mp4[^"]*)"',
        r'"url":"(https:[^"]+\.mp4[^"]*)"',
    ]
    for pattern in patterns:
        m = re.search(pattern, html)
        if m:
            return m.group(1).replace("\\u0026", "&").replace("\\/", "/").replace("\\", "")
    return None

def gather_pinterest_metadata(url):
    headers = {"User-Agent":"Mozilla/5.0","Referer":"https://www.pinterest.com/"}
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    html = r.text
    title = "Pinterest Post"
    for pattern in [r'"title":"([^"]{1,500})', r'"description":"([^"]{1,500})', r'<meta property="og:title" content="([^"]+)"']:
        m = re.search(pattern, html)
        if m:
            title = m.group(1).strip()
            if title and title != "Pinterest":
                break
    media_urls = []
    video_url = extract_video_url(html)
    if video_url:
        media_urls.append({"url": video_url.replace("\\u0026","&"), "filename":"pinterest_video.mp4", "type":"video"})
        thumbnail_match = re.search(r'"thumbnailUrl":"([^"]+)"', html)
        if thumbnail_match:
            media_urls.append({"url": thumbnail_match.group(1).replace("\\u0026","&"), "filename":"thumbnail.jpg", "type":"thumbnail"})
    else:
        for pattern in [r'"images":\{"orig":\{"url":"([^"]+)"', r'"url":"(https://i\.pinimg\.com/originals/[^"]+)"']:
            m = re.search(pattern, html)
            if m:
                media_urls.append({"url": m.group(1).replace("\\u0026","&").replace("\\/","/"), "filename":"pinterest_image.jpg", "type":"image"})
                break
    metadata = {"platform":"pinterest","title":title,"post_url":url}
    return metadata, media_urls

def download_pinterest(download_id, url, quality='1080p'):
    try:
        headers = {"User-Agent":"Mozilla/5.0","Referer":"https://www.pinterest.com/"}
        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        html = r.text
        video_url = extract_video_url(html)
        save_path = get_download_path("pinterest")
        media_url = None
        if video_url:
            media_url = video_url
            ext = ".mp4"
        else:
            main_image_patterns = [r'"images":\{"orig":\{"url":"([^"]+)"', r'"url":"(https://i\.pinimg\.com/originals/[^"]+)"']
            for p in main_image_patterns:
                m = re.search(p, html)
                if m:
                    media_url = m.group(1).replace("\\u0026","&").replace("\\/","/")
                    break
            ext = ".jpg"
        if not media_url:
            raise Exception("No media found for this Pinterest post")
        filename = sanitize_filename("pinterest_post") + ext
        filepath = os.path.join(save_path, filename)
        download_stream_fast(media_url, filepath, download_id, 10, 80)
        from ..config import QUALITY_MAP
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
            "status":"completed","filename":filename,"downloaded_files":[filename],"message":f"Download completed at {quality}!"
        })
        emit_status(download_id)
    except Exception as e:
        logger.exception("Pinterest download error")
        download_sessions[download_id] = {"status":"error","message":str(e)}
        emit_status(download_id)

def extract_pinterest_audio(download_id, url):
    try:
        headers = {"User-Agent":"Mozilla/5.0","Referer":"https://www.pinterest.com/"}
        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        html = r.text
        video_url = extract_video_url(html)
        if not video_url:
            raise Exception("This Pinterest post doesn't contain a video")
        path = get_download_path("pinterest")
        filename = sanitize_filename("pinterest_audio.mp3")
        filepath = os.path.join(path, filename)
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
        download_sessions[download_id].update({"status":"completed","progress":100,"message":"Audio extracted successfully! ✅","filename":filename,"downloaded_files":[filename],"download_url":f"/downloads/pinterest/{filename}"})
        emit_status(download_id)
    except Exception as e:
        logger.exception("Pinterest audio extraction error")
        download_sessions[download_id] = {"status":"error","message":str(e)}
        emit_status(download_id)
