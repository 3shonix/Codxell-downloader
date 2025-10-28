# app/config.py
import os
from concurrent.futures import ThreadPoolExecutor

BASE_DIR = os.getcwd()
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# shared executor and state
executor = ThreadPoolExecutor(max_workers=4)
download_sessions = {}         # {download_id: {...}}
download_cancel_flags = {}     # {download_id: True}

# quality mapping used for conversion/resizing
QUALITY_MAP = {
    '2160p': {'width': 3840, 'height': 2160},
    '1440p': {'width': 2560, 'height': 1440},
    '1080p': {'width': 1920, 'height': 1080},
    '720p': {'width': 1280, 'height': 720},
    '480p': {'width': 854,  'height': 480},
    '360p': {'width': 640,  'height': 360},
    '240p': {'width': 426,  'height': 240},
    '144p': {'width': 256,  'height': 144},
}
