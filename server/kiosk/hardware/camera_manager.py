"""
Camera manager — the 4 locker cameras are USB (OpenCV / GStreamer).

**Face camera removed 2026-09-03.** Identity verification moved to the
user's own phone (design mandate §2.13) — this manager no longer opens,
reads, or reinitialises a 5th camera for faces. If you're looking for that
code, it's gone on purpose, not missing by accident: a `capture_face()` here
would be opening hardware the kiosk no longer has.

**Re-corrected 2026-09-03, later the same day — physically removing the face
camera shifted the USB topology for two of the four remaining cameras.**
Lockers 3 and 4 stayed at their already-verified ports; lockers 1 and 2's
cameras disappeared from their previous by-path identities entirely and
reappeared at two different, previously-unmapped ports (moved from
`xhci-hcd.1`'s hub to `xhci-hcd.0`'s — almost certainly the hub they shared
with the face camera got disturbed during its removal). Re-verified the same
way as the correction above: captured a live photo from each of the two new
ports, described each to the person standing at the kiosk, had them confirm
which real locker each one showed (locker 1 had a small remote control
sitting on the floor; locker 2 had a dark folded item inside).

**Corrected 2026-09-03 — the previous raw `/dev/videoN` mapping was both
unstable AND wrong.** Two separate real bugs, found by direct physical
verification (captured a real photo from each camera, matched each one
against what a person standing at the kiosk could see was actually inside
each locker):

1. `/dev/videoN` numbers are assigned by USB enumeration order, which is
   **not stable across reboots or replugs** — confirmed directly: the same
   physical camera landed on a different `/dev/videoN` on consecutive boots
   this session. A hardcoded raw device path silently starts pointing at a
   different physical camera (or nothing) the next time the kiosk restarts.
2. Independent of (1), the *port-to-locker* assignment itself was wrong —
   the map's own inline comments claimed a specific physical-port-to-locker
   correspondence that direct testing disproved. Real, physically-confirmed
   mapping (captured a distinct real photo per camera, matched against real
   locker contents by a person physically checking each one):
     - Locker 1 ← the port previously labeled "Locker 4" in this file
     - Locker 2 ← correct, no change
     - Locker 3 ← the port previously labeled "Locker 1" in this file
     - Locker 4 ← the port previously labeled "Locker 3" in this file

**Fix for both at once: `/dev/v4l/by-path/...` symlinks instead of raw
`/dev/videoN`.** These stay tied to the physical USB port regardless of
enumeration-order drift, so they survive reboots — and they're now assigned
to the locker each one was actually, physically confirmed to serve.

If hardware changes again (a camera physically moved to a different port),
re-verify with the same method: capture a real photo per camera via the
admin console's "Capture Image" per locker, and have someone standing at the
kiosk confirm which real locker each photo actually shows — don't just trust
a port-topology comment written down previously, this file already had one
that was wrong. `v4l2-ctl --list-devices` and `ls /dev/v4l/by-path/` show
the current raw topology if the by-path names themselves ever need updating.
"""

import io
import logging
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from config import LOCKER_PINS, MOCK_CAMERA

log = logging.getLogger("kiosk.camera")

# Map camera_index (0-3) → a stable, physical-port-based V4L2 device path.
# Each entry physically confirmed 2026-09-03 (locker 1 & 2 entries re-confirmed
# later the same day, after the face camera's removal shifted their ports —
# see the module docstring). If hardware moves again, re-verify the same way
# — don't just edit the comment from a topology diagram, that's exactly how
# this went wrong the first time.
_BY_PATH = "/dev/v4l/by-path/{}-video-index0"
USB_DEVICE_MAP: dict[int, str] = {
    0: _BY_PATH.format("platform-xhci-hcd.0-usb-0:1.2:1.0"),  # Locker 1
    1: _BY_PATH.format("platform-xhci-hcd.0-usb-0:1.3:1.0"),  # Locker 2
    2: _BY_PATH.format("platform-xhci-hcd.0-usb-0:2:1.0"),    # Locker 3
    3: _BY_PATH.format("platform-xhci-hcd.1-usb-0:2:1.0"),    # Locker 4
}

LOCKER_RESOLUTION = (1280, 720)   # MJPEG 30fps — supported by all cameras
JPEG_QUALITY      = 90


def _open_usb(device: str, width: int, height: int) -> cv2.VideoCapture | None:
    """Open a USB camera via GStreamer using MJPEG (30fps, low CPU)."""
    # MJPEG pipeline — best for these cameras (30fps at 1280x720)
    gst = (
        f"v4l2src device={device} ! "
        f"image/jpeg,width={width},height={height},framerate=30/1 ! "
        f"jpegdec ! videoconvert ! video/x-raw,format=BGR ! "
        f"appsink max-buffers=1 drop=true sync=false"
    )
    cap = cv2.VideoCapture(gst, cv2.CAP_GSTREAMER)
    if cap.isOpened():
        return cap

    # Fallback: YUYV at 640x480 (always supported)
    gst_fallback = (
        f"v4l2src device={device} ! "
        f"video/x-raw,format=YUY2,width=640,height=480,framerate=30/1 ! "
        f"videoconvert ! video/x-raw,format=BGR ! "
        f"appsink max-buffers=1 drop=true sync=false"
    )
    cap2 = cv2.VideoCapture(gst_fallback, cv2.CAP_GSTREAMER)
    if cap2.isOpened():
        log.warning("Camera %s opened with YUYV 640x480 fallback", device)
        return cap2

    log.error("Camera %s could not be opened — check v4l2-ctl --list-devices", device)
    return None


class CameraManager:
    def __init__(self):
        self._usb: dict[int, cv2.VideoCapture] = {}   # locker_id → capture
        self._init_cameras()

    def _init_cameras(self):
        if MOCK_CAMERA:
            log.warning("MOCK_CAMERA=True – returning placeholder images")
            return

        # ── Locker cameras ────────────────────────────────────────────────────
        w, h = LOCKER_RESOLUTION
        for locker_id, pins in LOCKER_PINS.items():
            usb_idx = pins["camera_index"]
            device  = USB_DEVICE_MAP.get(usb_idx, f"/dev/video{usb_idx * 2}")
            cap = _open_usb(device, w, h)
            if cap:
                self._usb[locker_id] = cap
                log.info("Locker camera locker=%s device=%s ✓", locker_id, device)

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _mock_frame(self, width: int = 640, height: int = 480) -> bytes:
        img = Image.new("RGB", (width, height), color=(128, 128, 128))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY)
        return buf.getvalue()

    def _to_jpeg(self, frame: np.ndarray) -> bytes:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if not ok:
            raise RuntimeError("JPEG encoding failed")
        return buf.tobytes()

    def _read_frame(self, cap: cv2.VideoCapture, device: str) -> bytes:
        ret, frame = cap.read()
        if not ret:
            raise RuntimeError(f"Camera read failed: {device}")
        return self._to_jpeg(frame)

    # ── Public API ─────────────────────────────────────────────────────────────

    def capture_locker(self, locker_id: int, num_frames: int = 3) -> list[bytes]:
        if MOCK_CAMERA:
            return [self._mock_frame(1280, 960) for _ in range(num_frames)]

        cap = self._usb.get(locker_id)
        if cap is None:
            log.error("Locker camera locker=%s not initialised", locker_id)
            return []

        usb_idx = LOCKER_PINS[locker_id]["camera_index"]
        device  = USB_DEVICE_MAP.get(usb_idx, "?")
        frames  = []
        for i in range(num_frames):
            if i > 0:
                time.sleep(0.5)
            try:
                frames.append(self._read_frame(cap, device))
            except Exception as e:
                log.error("Capture failed locker=%s frame=%s: %s", locker_id, i, e)

        log.info("Captured %s frames from locker=%s", len(frames), locker_id)
        return frames

    def cleanup(self):
        for cap in list(self._usb.values()):
            try:
                cap.release()
            except Exception:
                pass
        log.info("All cameras released")
