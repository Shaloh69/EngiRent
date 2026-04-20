#!/usr/bin/env python3
"""
EngiRent Kiosk – Diagnostic script
Run:  python3 diagnose.py
Checks all imports, GPIO, cameras, Flask UI, and socket config.
"""

import os
import sys
import subprocess

sys.path.insert(0, os.path.dirname(__file__))

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
WARN = "\033[93m⚠\033[0m"
HEAD = "\033[1;96m"
RST  = "\033[0m"

def section(title):
    print(f"\n{HEAD}── {title} {'─' * (50 - len(title))}{RST}")

def ok(msg):   print(f"  {PASS}  {msg}")
def fail(msg): print(f"  {FAIL}  {msg}")
def warn(msg): print(f"  {WARN}  {msg}")

# ── 1. Python version ──────────────────────────────────────────────────────────
section("Python")
ok(f"Python {sys.version.split()[0]} at {sys.executable}")

# ── 2. Core imports ────────────────────────────────────────────────────────────
section("Core imports")
checks = [
    ("dotenv",        "python-dotenv"),
    ("structlog",     "structlog"),
    ("flask",         "Flask"),
    ("flask_socketio","flask-socketio"),
    ("flask_cors",    "flask-cors"),
    ("socketio",      "python-socketio"),
    ("aiohttp",       "aiohttp"),
    ("supabase",      "supabase"),
    ("PIL",           "pillow"),
]
for mod, pkg in checks:
    try:
        __import__(mod)
        ok(f"{pkg}")
    except ImportError as e:
        fail(f"{pkg}  →  {e}")

# ── 3. Hardware imports ────────────────────────────────────────────────────────
section("Hardware imports")
for mod, pkg in [("cv2","opencv"), ("gpiozero","gpiozero"), ("lgpio","lgpio"), ("picamera2","picamera2")]:
    try:
        m = __import__(mod)
        ver = getattr(m, "__version__", "?")
        ok(f"{pkg}  v{ver}")
    except ImportError as e:
        fail(f"{pkg}  →  {e}")

# ── 4. OpenCV build info ───────────────────────────────────────────────────────
section("OpenCV backends")
try:
    import cv2
    info = cv2.getBuildInformation()
    for line in info.splitlines():
        if any(k in line for k in ("V4L2", "GStreamer", "FFMPEG")):
            status = "enabled" if "YES" in line or "YES (" in line else "disabled"
            (ok if "YES" in line else warn)(line.strip())
except Exception as e:
    fail(str(e))

# ── 5. Video devices ───────────────────────────────────────────────────────────
section("Video devices  (v4l2-ctl --list-devices)")
try:
    result = subprocess.run(["v4l2-ctl", "--list-devices"],
                            capture_output=True, text=True, timeout=5)
    if result.stdout.strip():
        for line in result.stdout.strip().splitlines():
            print(f"     {line}")
    else:
        warn("No video devices found — plug in USB cameras")
except FileNotFoundError:
    warn("v4l2-ctl not found — run: sudo apt install v4l-utils")
except Exception as e:
    fail(str(e))

# ── 6. Test USB camera nodes with OpenCV GStreamer ────────────────────────────
# Only test even-numbered nodes 0–10; Pi ISP nodes (video19+) stall GStreamer.
section("Camera open test  (OpenCV GStreamer, USB nodes only)")
import cv2 as _cv2, os as _os, numpy as _np
USB_TEST_NODES = [f"/dev/video{i}" for i in range(0, 11, 2)]  # 0,2,4,6,8,10
_CAMERA_LABELS = {
    "/dev/video0": "Face Cam  (A4tech FHD)",
    "/dev/video2": "Locker 3  (Web Camera)",
    "/dev/video4": "Locker 4  (Web Camera)",
    "/dev/video6": "Extra Cam 1",
    "/dev/video8": "Extra Cam 2",
    "/dev/video10": "Extra Cam 3",
}
_working_cameras: list[str] = []

for device in USB_TEST_NODES:
    if not _os.path.exists(device):
        continue
    gst = (
        f"v4l2src device={device} ! "
        f"videoconvert ! video/x-raw,format=BGR ! "
        f"appsink max-buffers=1 drop=true sync=false"
    )
    cap = _cv2.VideoCapture(gst, _cv2.CAP_GSTREAMER)
    if cap.isOpened():
        ret, frame = cap.read()
        if ret and frame is not None:
            h, w = frame.shape[:2]
            label = _CAMERA_LABELS.get(device, device)
            ok(f"{device}  [{label}]  →  {w}x{h} ✓")
            _working_cameras.append(device)
        else:
            warn(f"{device}  →  opened but no frame (metadata/busy?)")
        cap.release()
    else:
        fail(f"{device}  →  could not open")

# ── 6b. Live preview of all working cameras ───────────────────────────────────
if _working_cameras:
    section("Live camera preview  (press Q to quit)")
    print(f"  Found {len(_working_cameras)} camera(s): {', '.join(_working_cameras)}")
    print("  Opening preview window… press  Q  to close and continue.\n")

    _caps: dict[str, object] = {}
    for device in _working_cameras:
        gst = (
            f"v4l2src device={device} ! "
            f"videoconvert ! video/x-raw,format=BGR ! "
            f"appsink max-buffers=1 drop=true sync=false"
        )
        c = _cv2.VideoCapture(gst, _cv2.CAP_GSTREAMER)
        if c.isOpened():
            _caps[device] = c

    THUMB_W, THUMB_H = 400, 300
    _FONT        = _cv2.FONT_HERSHEY_SIMPLEX
    _GREEN       = (0, 220, 60)
    _WHITE       = (255, 255, 255)
    _SHADOW      = (0, 0, 0)

    if _caps:
        try:
            while True:
                tiles = []
                for device, c in _caps.items():
                    ret, frame = c.read()
                    if not ret or frame is None:
                        frame = _np.zeros((THUMB_H, THUMB_W, 3), dtype=_np.uint8)
                    else:
                        frame = _cv2.resize(frame, (THUMB_W, THUMB_H))

                    label   = _CAMERA_LABELS.get(device, device)
                    caption = f"{label}  |  {device}"

                    # Shadow + text for readability on any background
                    _cv2.putText(frame, caption, (11, 31), _FONT, 0.58, _SHADOW, 3, _cv2.LINE_AA)
                    _cv2.putText(frame, caption, (10, 30), _FONT, 0.58, _GREEN,  2, _cv2.LINE_AA)

                    # Green border on each tile
                    _cv2.rectangle(frame, (0, 0), (THUMB_W - 1, THUMB_H - 1), _GREEN, 2)
                    tiles.append(frame)

                # Tile: up to 3 per row
                cols = min(len(tiles), 3)
                rows_needed = (len(tiles) + cols - 1) // cols
                while len(tiles) < cols * rows_needed:
                    tiles.append(_np.zeros((THUMB_H, THUMB_W, 3), dtype=_np.uint8))
                row_imgs = [_np.hstack(tiles[r * cols:(r + 1) * cols]) for r in range(rows_needed)]
                grid = _np.vstack(row_imgs)

                _cv2.imshow("EngiRent Camera Diagnostic", grid)
                if _cv2.waitKey(1) & 0xFF in (ord('q'), ord('Q'), 27):
                    break
        finally:
            for c in _caps.values():
                c.release()
            _cv2.destroyAllWindows()
        ok("Preview closed")
    else:
        warn("Could not re-open cameras for preview (another process may hold them)")

# ── 7. Face cascade ────────────────────────────────────────────────────────────
section("Face detection (Haar cascade)")
try:
    from services.face_service import _find_cascade_path
    p = _find_cascade_path()
    ok(f"Cascade found: {p}")
except Exception as e:
    fail(str(e))

# ── 8. .env config ─────────────────────────────────────────────────────────────
section(".env configuration")
from dotenv import load_dotenv
load_dotenv()
keys = ["KIOSK_ID", "SERVER_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
        "ML_SERVICE_URL", "UI_PORT", "RELAY_ACTIVE_LEVEL", "MOCK_GPIO", "MOCK_CAMERA"]
for k in keys:
    v = os.getenv(k, "")
    if not v:
        fail(f"{k}  →  NOT SET")
    elif "your-" in v.lower() or "paste" in v.lower():
        warn(f"{k}  →  still placeholder value")
    else:
        masked = v[:8] + "…" if len(v) > 12 else v
        ok(f"{k}  =  {masked}")

# ── 9. WiFi ────────────────────────────────────────────────────────────────────
section("WiFi")
try:
    result = subprocess.run(
        ["nmcli", "-t", "-f", "TYPE,STATE", "con", "show", "--active"],
        capture_output=True, text=True, timeout=5,
    )
    wifi_lines = [l for l in result.stdout.splitlines() if "wifi" in l.lower()]
    if wifi_lines:
        ok(f"WiFi active: {wifi_lines[0]}")
    else:
        warn("No active WiFi connection found")
        print("     All active connections:")
        for l in result.stdout.splitlines():
            print(f"       {l}")
except Exception as e:
    fail(str(e))

# ── 10. Port 8080 ──────────────────────────────────────────────────────────────
section("Flask UI port 8080")
import socket as _socket
s = _socket.socket()
s.settimeout(1)
result = s.connect_ex(("127.0.0.1", 8080))
s.close()
if result == 0:
    ok("Port 8080 is OPEN — Flask UI is running")
else:
    warn("Port 8080 not open — Flask UI not started yet")

# ── Done ───────────────────────────────────────────────────────────────────────
print(f"\n{HEAD}{'=' * 56}{RST}")
print(f"{HEAD}  Diagnostic complete{RST}")
print(f"{HEAD}{'=' * 56}{RST}\n")
