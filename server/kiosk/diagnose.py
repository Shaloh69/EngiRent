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

# ── 6. Discover + test all USB cameras via v4l2-ctl ───────────────────────────
section("Camera open test  (OpenCV GStreamer, auto-detected USB)")
import cv2 as _cv2, os as _os, numpy as _np, subprocess as _sp, threading as _th

def _scan_usb_cameras() -> dict[str, str]:
    """Return {device_path: camera_name} for all USB cameras found by v4l2-ctl."""
    try:
        out = _sp.run(["v4l2-ctl", "--list-devices"],
                      capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return {}
    cameras: dict[str, str] = {}
    current_name, in_usb, took_first = "", False, False
    for line in out.splitlines():
        if not line.startswith("\t"):
            in_usb = "usb" in line.lower()
            # Strip port suffix: "A4tech FHD 1080P PC Camera: A4t (usb-...)" → "A4tech FHD 1080P PC Camera"
            current_name = line.split("(usb")[0].rstrip(": \t") if in_usb else ""
            took_first = False
        elif in_usb and not took_first and line.strip().startswith("/dev/video"):
            cameras[line.strip()] = current_name or line.strip()
            took_first = True
    return cameras

_usb_cameras = _scan_usb_cameras()   # {device: name}
if not _usb_cameras:
    warn("v4l2-ctl found no USB cameras — falling back to /dev/video0-10")
    _usb_cameras = {f"/dev/video{i}": f"/dev/video{i}" for i in range(0, 11, 2)
                    if _os.path.exists(f"/dev/video{i}")}

THUMB_W, THUMB_H = 320, 240
_FONT   = _cv2.FONT_HERSHEY_SIMPLEX
_GREEN  = (0, 220, 60)
_SHADOW = (0, 0, 0)

def _open_gst_cap(device: str) -> "cv2.VideoCapture | None":
    gst = (
        f"v4l2src device={device} ! "
        f"video/x-raw,framerate=15/1 ! "
        f"videoscale ! video/x-raw,width={THUMB_W},height={THUMB_H} ! "
        f"videoconvert ! video/x-raw,format=BGR ! "
        f"appsink max-buffers=1 drop=true sync=false"
    )
    c = _cv2.VideoCapture(gst, _cv2.CAP_GSTREAMER)
    if c.isOpened():
        return c
    # Fallback — no framerate/scale constraint
    gst2 = (
        f"v4l2src device={device} ! "
        f"videoconvert ! video/x-raw,format=BGR ! "
        f"appsink max-buffers=1 drop=true sync=false"
    )
    c2 = _cv2.VideoCapture(gst2, _cv2.CAP_GSTREAMER)
    return c2 if c2.isOpened() else None

# Open and test each discovered USB camera
_preview_caps:  dict[str, object] = {}   # device → VideoCapture (kept open)
_camera_labels: dict[str, str]    = {}   # device → display name

for device, name in _usb_cameras.items():
    c = _open_gst_cap(device)
    if c is not None:
        ret, frame = c.read()
        if ret and frame is not None:
            h, w = frame.shape[:2]
            ok(f"{device}  [{name}]  →  {w}x{h} ✓")
            _preview_caps[device]  = c
            _camera_labels[device] = name
        else:
            warn(f"{device}  [{name}]  →  opened but no frame")
            c.release()
    else:
        fail(f"{device}  [{name}]  →  could not open")

# ── 6b. Live preview — one reader thread per camera to eliminate lag ──────────
if _preview_caps:
    section("Live camera preview  (press Q to quit)")
    n = len(_preview_caps)
    print(f"  {n} camera(s): {', '.join(_camera_labels[d] for d in _preview_caps)}")
    print("  Press  Q  or  Esc  to close.\n")

    # Shared latest-frame store — reader threads write, display loop reads
    _latest:  dict[str, _np.ndarray] = {}
    _flocks:  dict[str, _th.Lock]    = {d: _th.Lock() for d in _preview_caps}
    _running = [True]

    def _reader(device, cap, lock):
        blank = _np.zeros((THUMB_H, THUMB_W, 3), dtype=_np.uint8)
        while _running[0]:
            ret, frame = cap.read()
            if ret and frame is not None:
                if frame.shape[1] != THUMB_W or frame.shape[0] != THUMB_H:
                    frame = _cv2.resize(frame, (THUMB_W, THUMB_H))
                with lock:
                    _latest[device] = frame
            # no sleep — drop=true in appsink, so read() returns immediately

    for dev, cap in _preview_caps.items():
        _th.Thread(target=_reader, args=(dev, cap, _flocks[dev]), daemon=True).start()

    COLS = min(n, 3)
    ROWS = (n + COLS - 1) // COLS
    blank_tile = _np.zeros((THUMB_H, THUMB_W, 3), dtype=_np.uint8)

    _cv2.namedWindow("EngiRent Cameras", _cv2.WINDOW_NORMAL)
    _cv2.resizeWindow("EngiRent Cameras", THUMB_W * COLS, THUMB_H * ROWS)

    try:
        while True:
            tiles = []
            for device in _preview_caps:
                with _flocks[device]:
                    frame = _latest.get(device, blank_tile).copy()
                label = _camera_labels.get(device, device)
                caption = f"{label}  {device}"
                _cv2.putText(frame, caption, (6, 22),  _FONT, 0.45, _SHADOW, 3, _cv2.LINE_AA)
                _cv2.putText(frame, caption, (5, 21),  _FONT, 0.45, _GREEN,  1, _cv2.LINE_AA)
                _cv2.rectangle(frame, (0, 0), (THUMB_W-1, THUMB_H-1), _GREEN, 2)
                tiles.append(frame)

            while len(tiles) < COLS * ROWS:
                tiles.append(blank_tile.copy())

            rows_img = [_np.hstack(tiles[r*COLS:(r+1)*COLS]) for r in range(ROWS)]
            _cv2.imshow("EngiRent Cameras", _np.vstack(rows_img))
            if _cv2.waitKey(33) & 0xFF in (ord('q'), ord('Q'), 27):  # ~30 fps display
                break
    finally:
        _running[0] = False
        for c in _preview_caps.values():
            c.release()
        _cv2.destroyAllWindows()
    ok("Preview closed")
else:
    warn("No USB cameras could be opened for preview")

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
