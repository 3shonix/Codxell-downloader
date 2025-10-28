# app/platforms/youtube.py
import os
import logging
from pytubefix import YouTube
from ..config import download_sessions, download_cancel_flags
from ..utils import smooth_emit_progress, emit_status, get_download_path, find_ffmpeg, resize_with_ffmpeg
from ..utils import download_stream_fast 

logger = logging.getLogger(__name__)

# To avoid circular import across utils, reimport download_stream_fast from utils dynamic
from ..utils import download_stream_fast, sanitize_filename

def download_youtube(download_id, url, quality='1080p'):
    try:
        if download_cancel_flags.get(download_id):
            return

        yt = YouTube(url)
        smooth_emit_progress(download_id, 10, f"Fetching streams for {yt.title}...")

        # progressive?
        stream = yt.streams.filter(progressive=True, file_extension="mp4", res=quality).first()
        if not stream:
            video_stream = yt.streams.filter(file_extension="mp4", res=quality, only_video=True).first()
            if not video_stream:
                video_stream = yt.streams.filter(file_extension="mp4", only_video=True).order_by("resolution").desc().first()
            audio_stream = yt.streams.filter(only_audio=True).order_by("abr").desc().first()
        else:
            video_stream, audio_stream = stream, None

        if not (stream or video_stream):
            raise Exception("No suitable video stream available")

        path = get_download_path("youtube")
        filename = sanitize_filename(yt.title) + ".mp4"
        filepath = os.path.join(path, filename)
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
                ffmpeg_path = find_ffmpeg()
                if not ffmpeg_path:
                    raise Exception("FFmpeg required for merging")
                # merge
                cmd = [ffmpeg_path, "-i", tmp_video, "-i", tmp_audio, "-c:v", "copy", "-c:a", "aac", "-preset", "ultrafast", "-threads", "0", "-y", filepath]
                subprocess = __import__("subprocess")
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if res.returncode != 0:
                    raise Exception(f"FFmpeg merge failed: {res.stderr}")

                # optional conversion to requested quality
                from ..config import QUALITY_MAP
                if quality and quality in QUALITY_MAP:

                    smooth_emit_progress(download_id, 75, f"Converting to {quality}...")
                    converted_file = filepath.replace(".mp4", f"_{quality}.mp4")
                    try:
                        resize_with_ffmpeg(filepath, converted_file, quality)
                        os.remove(filepath)
                        filepath = converted_file
                        filename = os.path.basename(converted_file)
                    except Exception as e:
                        logger.warning(f"Quality conversion failed, keeping original: {e}")

                # convert audio-only
                ffmpeg_path = find_ffmpeg()
                if ffmpeg_path:
                    cmd2 = [ffmpeg_path, "-i", tmp_audio, "-vn", "-acodec", "libmp3lame", "-q:a", "2", "-y", audio_filepath]
                    subprocess.run(cmd2, capture_output=True, text=True, timeout=60)

            finally:
                for tmp in [tmp_video, tmp_audio]:
                    if os.path.exists(tmp):
                        try:
                            os.remove(tmp)
                        except:
                            pass
        else:
            # progressive stream
            download_stream_fast(stream.url, filepath, download_id, 15, 85)
            if quality and quality in __import__("..config", fromlist=["QUALITY_MAP"]).QUALITY_MAP:
                smooth_emit_progress(download_id, 90, f"Converting to {quality}...")
                converted_file = filepath.replace(".mp4", f"_{quality}.mp4")
                try:
                    resize_with_ffmpeg(filepath, converted_file, quality)
                    os.remove(filepath)
                    filepath = converted_file
                    filename = os.path.basename(converted_file)
                except Exception as e:
                    logger.warning(f"Quality conversion failed, keeping original: {e}")

        # finalize
        response_data = {"status":"completed","progress":100,"message":"Download completed! ✅","filename":filename,"download_url":f"/downloads/youtube/{filename}"}
        if os.path.exists(audio_filepath):
            response_data["audio_link"] = {"url":f"/downloads/youtube/{audio_filename}","filename":audio_filename}

        download_sessions[download_id].update(response_data)
        emit_status(download_id)
    except Exception as e:
        logger.exception("YouTube download error")
        err = str(e)
        if "FFmpeg" in err:
            err += "\n\nPlease install FFmpeg to merge video and audio streams."
        download_sessions[download_id] = {"status":"error","message": err}
        emit_status(download_id)

def extract_youtube_audio(download_id, url):
    # download highest-bitrate audio stream directly via pytube's stream.download
    yt = YouTube(url)
    smooth_emit_progress(download_id, 10, f"Fetching audio streams for {yt.title}...")
    stream = yt.streams.filter(only_audio=True).order_by("abr").desc().first()
    if not stream:
        raise Exception("No audio-only stream found.")
    mime = stream.mime_type or ""
    ext = "webm" if "webm" in mime else "m4a"
    path = get_download_path("youtube")
    filename = sanitize_filename(yt.title) + f".{ext}"
    filepath = os.path.join(path, filename)
    smooth_emit_progress(download_id, 25, "Downloading audio stream directly...")
    # use pytube's download to path
    stream.download(output_path=path, filename=filename)
    smooth_emit_progress(download_id, 100, "Audio download completed ✅")
    download_sessions[download_id].update({
        "status":"completed","progress":100,"message":"Audio downloaded successfully! ✅",
        "filename": filename, "downloaded_files":[filename], "download_url": f"/downloads/youtube/{filename}"
    })
    emit_status(download_id)
    return filepath
