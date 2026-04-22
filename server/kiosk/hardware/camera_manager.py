"""
Camera manager — all 5 cameras are USB (OpenCV / GStreamer).

  Index 0 → Locker 1  (/dev/video0)
  Index 1 → Locker 2  (/dev/video2)
  Index 2 → Locker 3  (/dev/video4)
  Index 3 → Locker 4  (/dev/video6)
  Index 4 → Face cam  (/dev/video8)

USB cameras on Pi OS expose two V4L2 nodes each (video + metadata).
Always use the even-numbered node (0, 2, 4 …) — that is the actual capture device.
Run `v4l2-ctl --list-devices` to verify and update USB_DEVICE_MAP if your
cameras land on different indices after a reboot or replug.
"""

import io
import logging
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from config import LOCKER_PINS, MOCK_CAMERA, FACE_CAMERA_INDEX

log = logging.getLogger("kiosk.camera")

# Map camera_index (0-4) → V4L2 device node.
# Update these paths if v4l2-ctl --list-devices shows different numbers.
USB_DEVICE_MAP: dict[int, str] = {
    0: "/dev/video0",    # Locker 1  ← update after testing with ffmpeg
    1: "/dev/video2",    # Locker 2  ← update after testing with ffmpeg
    2: "/dev/video4",    # Locker 3  ← update after testing with ffmpeg
    3: "/dev/video7",    # Locker 4  ← Web Camera usb-xhci-hcd.1-1.3
    4: "/dev/video10",   # Face cam  ← Web Camera usb-xhci-hcd.1-1.4
}

LOCKER_RESOLUTION = (1280, 720)   # MJPEG 30fps — supported by all cameras
FACE_RESOLUTION   = (640, 480)    # MJPEG 30fps — sufficient for face detection
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
        self._usb:      dict[int, cv2.VideoCapture] = {}   # locker_id → capture
        self._face_cap: cv2.VideoCapture | None = None
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

        # ── Face camera ───────────────────────────────────────────────────────
        face_device = USB_DEVICE_MAP.get(FACE_CAMERA_INDEX, "/dev/video8")
        fw, fh = FACE_RESOLUTION
        cap = _open_usb(face_device, fw, fh)
        if cap:
            self._face_cap = cap
            log.info("Face camera device=%s ✓", face_device)

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

    def capture_face(self, num_frames: int = 1) -> list[bytes]:
        if MOCK_CAMERA:
            return [self._mock_frame(640, 480) for _ in range(num_frames)]

        if self._face_cap is None:
            log.error("Face camera not initialised")
            return []

        face_device = USB_DEVICE_MAP.get(FACE_CAMERA_INDEX, "/dev/video8")
        frames = []
        for _ in range(num_frames):
            try:
                frames.append(self._read_frame(self._face_cap, face_device))
            except Exception as e:
                log.error("Face capture failed: %s", e)
        return frames

    def cleanup(self):
        for cap in list(self._usb.values()):
            try:
                cap.release()
            except Exception:
                pass
        if self._face_cap:
            try:
                self._face_cap.release()
            except Exception:
                pass
        log.info("All cameras released")
