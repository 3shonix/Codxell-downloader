# app/routes/preview_routes.py
from flask import Blueprint, request, jsonify
from pytubefix import YouTube
import requests
import re
import instaloader
from ..config import QUALITY_MAP

preview_bp = Blueprint("preview", __name__)

def extract_shortcode(url):
    m = re.search(r"/(?:p|reel|reels)/([A-Za-z0-9_-]+)", url)
    return m.group(1) if m else None

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

@preview_bp.route("/api/preview", methods=["POST"])
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

        all_qualities = list(QUALITY_MAP.keys())

        if platform == "youtube":
            yt = YouTube(url)
            progressive_stream = yt.streams.filter(progressive=True, file_extension="mp4").order_by("resolution").desc().first()
            if progressive_stream:
                best_video = progressive_stream
                best_audio = None
            else:
                best_video = yt.streams.filter(file_extension="mp4", only_video=True).order_by("resolution").desc().first()
                best_audio = yt.streams.filter(only_audio=True).order_by("abr").desc().first()
            return jsonify({
                "platform": "youtube",
                "title": yt.title,
                "thumbnail": yt.thumbnail_url,
                "video_url": progressive_stream.url if progressive_stream else best_video.url,
                "audio_url": None if progressive_stream else (best_audio.url if best_audio else None),
                "available_qualities": all_qualities,
                "duration": yt.length,
                "author": yt.author,
                "ux_tip": "🎥 All quality options available with FFmpeg conversion",
            })

        if platform == "instagram":
            shortcode = extract_shortcode(url)
            if not shortcode:
                return jsonify({"error": "Invalid Instagram link"}), 400

            media_items = []
            title = "Instagram Post"
            author = None

            try:
                L = instaloader.Instaloader(download_pictures=False, download_videos=False, quiet=True,
                                            user_agent="Mozilla/5.0")
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
                        nodes = list(sidecar()) if callable(sidecar) else list(sidecar)
                except:
                    pass

                if nodes:
                    for node in nodes:
                        is_video = getattr(node, "is_video", False)
                        if is_video:
                            video_url = getattr(node, "video_url", None)
                            thumbnail = getattr(node, "display_url", None)
                            if video_url:
                                media_items.append({"type":"video","url":str(video_url).replace("\\u0026","&"),"thumbnail":thumbnail})
                        else:
                            img_url = getattr(node, "display_url", None)
                            if img_url:
                                media_items.append({"type":"image","url":str(img_url).replace("\\u0026","&")})
                else:
                    if getattr(post, "is_video", False):
                        media_items.append({"type":"video","url":str(post.video_url).replace("\\u0026","&"),"thumbnail":str(post.url)})
                    else:
                        media_items.append({"type":"image","url":str(post.url).replace("\\u0026","&")})

            except Exception as e:
                # fallback to scraping
                pass

            if not media_items:
                try:
                    headers = {"User-Agent":"Mozilla/5.0","Accept":"text/html,application/xhtml+xml","Accept-Language":"en-US,en;q=0.9"}
                    embed_url = f"https://www.instagram.com/p/{shortcode}/embed/captioned/"
                    r = requests.get(embed_url, headers=headers, timeout=15)
                    if r.status_code == 200:
                        html = r.text
                        # title
                        caption_patterns = [r'"caption":"([^"]{1,200})', r'"edge_media_to_caption".*?"text":"([^"]{1,200})', r'<meta property="og:description" content="([^"]{1,200})']
                        for pattern in caption_patterns:
                            match = re.search(pattern, html)
                            if match:
                                caption = match.group(1).strip()
                                if caption and caption not in ["Instagram","Instagram Post"]:
                                    title = caption[:100] + ("..." if len(caption) > 100 else "")
                                    break
                        # author
                        username_patterns = [r'"username":"([^"]+)"', r'"owner":\{"username":"([^"]+)"']
                        for pattern in username_patterns:
                            match = re.search(pattern, html)
                            if match:
                                author = match.group(1)
                                break
                        # video
                        video_patterns = [r'"video_url":"(https://[^"]+)"', r'"video_url":\s*"(https://[^"]+)"']
                        for pattern in video_patterns:
                            match = re.search(pattern, html)
                            if match:
                                video_url = match.group(1).replace("\\u0026","&").replace("\\/","/")
                                media_items.append({"type":"video","url":video_url,"thumbnail":None})
                                break
                        if not media_items:
                            img_patterns = [r'"display_url":"(https://[^"]+)"', r'"thumbnail_src":"(https://[^"]+)"']
                            for pattern in img_patterns:
                                matches = re.findall(pattern, html)
                                for img_url in matches[:5]:
                                    clean_url = img_url.replace("\\u0026","&").replace("\\/","/")
                                    if clean_url not in [m["url"] for m in media_items]:
                                        media_items.append({"type":"image","url":clean_url})
                except Exception:
                    pass

            if not media_items:
                return jsonify({"error":"No media found. The post might be private or unavailable."}), 404

            return jsonify({
                "platform":"instagram",
                "title": title,
                "author": f"@{author}" if author else None,
                "media": media_items,
                "thumbnail": media_items[0].get("thumbnail") or media_items[0]["url"],
                "available_qualities": all_qualities,
                "ux_tip": "📱 Instagram Post • All qualities available with conversion"
            })

        if platform == "pinterest":
            try:
                headers = {"User-Agent":"Mozilla/5.0","Referer":"https://www.pinterest.com/"}
                r = requests.get(url, headers=headers, timeout=15)
                r.raise_for_status()
                html = r.text
                media_items = []
                video_url = extract_video_url(html)
                if video_url:
                    thumbnail_match = re.search(r'"thumbnailUrl":"([^"]+)"', html)
                    thumbnail = thumbnail_match.group(1).replace("\\u0026","&") if thumbnail_match else ""
                    media_items.append({"type":"video","url":video_url.replace("\\u0026","&"),"thumbnail":thumbnail})
                else:
                    main_image_patterns = [r'"images":\{"orig":\{"url":"([^"]+)"', r'"url":"(https://i\.pinimg\.com/originals/[^"]+)"']
                    for pattern in main_image_patterns:
                        match = re.search(pattern, html)
                        if match:
                            img_url = match.group(1).replace("\\u0026","&").replace("\\/","/")
                            media_items.append({"type":"image","url":img_url})
                            break
                title_patterns = [r'"title":"([^"]{1,200})', r'"description":"([^"]{1,200})']
                title = "Pinterest Post"
                for pattern in title_patterns:
                    m = re.search(pattern, html)
                    if m:
                        title = m.group(1).strip()
                        if title and title != "Pinterest":
                            break
                if not media_items:
                    raise Exception("No media found")
                return jsonify({
                    "platform":"pinterest",
                    "title": title,
                    "media": media_items,
                    "thumbnail": media_items[0].get("thumbnail") or media_items[0]["url"],
                    "available_qualities": all_qualities,
                    "ux_tip": "📌 Pinterest • All qualities available with conversion",
                })
            except Exception as e:
                return jsonify({"error": f"Pinterest preview failed: {str(e)}"}), 500

    except Exception as ex:
        return jsonify({"error": f"Preview failed: {str(ex)}"}), 500
