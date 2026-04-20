"""
Camera manager for 5 cameras:
  - Cameras 1 & 2: CSI ribbon (picamera2) → Lockers 1 & 2
  - Cameras 3 & 4: USB (OpenCV)           → Lockers 3 & 4
  - Camera 5:      USB hub (OpenCV)        → Face recognition

Captures still frames as JPEG bytes ready for Supabase upload.
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

# USB camera device paths – adjust if Linux assigns different indices
# On Pi 5 with 2 CSI cameras, USB cams usually start at /dev/video4
USB_DEVICE_MAP = {
    0: "/dev/video4",   # USB port 1 → Locker 3 camera
    1: "/dev/video5",   # USB port 2 → Locker 4 camera
    2: "/dev/video6",   # USB port 3/Hub → Face recognition camera
}

CSI_RESOLUTION = (1280, 960)
USB_RESOLUTION = (1280, 960)
FACE_RESOLUTION = (640, 480)
JPEG_QUALITY = 90


class CameraManager:
    def __init__(self):
        self._csi: dict[int, object] = {}   # locker_id → Picamera2 instance
        self._usb: dict[int, object] = {}   # usb_index → cv2.VideoCapture
        self._face_cap = None
        self._init_cameras()

    def _init_cameras(self):
        if MOCK_CAMERA:
            log.warning("MOCK_CAMERA=True – returning placeholder images")
            return

        # ── CSI cameras ───────────────────────────────────────────────────────
        try:
            from picamera2 import Picamera2

            for locker_id, pins in LOCKER_PINS.items():
                if pins["camera_type"] == "csi":
                    idx = pins["camera_index"]
                    cam = Picamera2(idx)
                    cfg = cam.create_still_configuration(
                        main={"size": CSI_RESOLUTION, "format": "RGB888"}
                    )
                    cam.configure(cfg)
                    cam.start()
                    self._csi[locker_id] = cam
                    log.info("CSI camera locker=%s index=%s started", locker_id, idx)
        except Exception as e:
            log.error("CSI camera init failed: %s", e)

        # ── USB cameras ───────────────────────────────────────────────────────
        for locker_id, pins in LOCKER_PINS.items():
            if pins["camera_type"] == "usb":
                usb_idx = pins["camera_index"]
                device = USB_DEVICE_MAP.get(usb_idx, usb_idx)
                cap = cv2.VideoCapture(device)
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, USB_RESOLUTION[0])
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, USB_RESOLUTION[1])
                    self._usb[locker_id] = cap
                    log.info("USB camera locker=%s device=%s started", locker_id, device)
                else:
                    log.error("USB camera locker=%s device=%s FAILED", locker_id, device)

        # ── Face recognition camera ───────────────────────────────────────────
        face_device = USB_DEVICE_MAP[2]
        cap = cv2.VideoCapture(face_device)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, FACE_RESOLUTION[0])
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FACE_RESOLUTION[1])
            self._face_cap = cap
            log.info("Face camera device=%s started", face_device)
        else:
            log.error("Face camera device=%s FAILED", face_device)

    # ── Capture helpers ────────────────────────────────────────────────────────

    def _mock_frame(self, width: int = 640, height: int = 480) -> bytes:
        """Returns a solid grey JPEG for mock mode."""
        img = Image.new("RGB", (width, height), color=(128, 128, 128))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY)
        return buf.getvalue()

    def _ndarray_to_jpeg(self, frame: np.ndarray) -> bytes:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if not ok:
            raise RuntimeError("JPEG encoding failed")
        return buf.tobytes()

    def _csi_to_jpeg(self, cam) -> bytes:
        frame = cam.capture_array()           # RGB888 numpy array
        frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        return self._ndarray_to_jpeg(frame_bgr)

    def _usb_to_jpeg(self, cap) -> bytes:
        ret, frame = cap.read()
        if not ret:
            raise RuntimeError("USB camera read failed")
        return self._ndarray_to_jpeg(frame)

    # ── Public API ─────────────────────────────────────────────────────────────

    def capture_locker(self, locker_id: int, num_frames: int = 3) -> list[bytes]:
        """
        Capture `num_frames` images from the locker camera.
        Returns list of JPEG bytes.
        """
        if MOCK_CAMERA:
            return [self._mock_frame(1280, 960) for _ in range(num_frames)]

        frames = []
        pins = LOCKER_PINS[locker_id]

        for i in range(num_frames):
            if i > 0:
                time.sleep(0.5)   # brief gap between captures
            try:
                if pins["camera_type"] == "csi":
                    cam = self._csi.get(locker_id)
                    if cam is None:
                        raise RuntimeError(f"CSI cam locker={locker_id} not initialised")
                    frames.append(self._csi_to_jpeg(cam))
                else:
                    cap = self._usb.get(locker_id)
                    if cap is None:
                        raise RuntimeError(f"USB cam locker={locker_id} not initialised")
                    frames.append(self._usb_to_jpeg(cap))
            except Exception as e:
                log.error("Capture failed locker=%s frame=%s: %s", locker_id, i, e)

        log.info("Captured %s frames from locker=%s", len(frames), locker_id)
        return frames

    def capture_face(self, num_frames: int = 1) -> list[bytes]:
        """Capture face recognition frame(s)."""
        if MOCK_CAMERA:
            return [self._mock_frame(640, 480) for _ in range(num_frames)]

        if self._face_cap is None:
            log.error("Face camera not initialised")
            return []

        frames = []
        for _ in range(num_frames):
            try:
                frames.append(self._usb_to_jpeg(self._face_cap))
            except Exception as e:
                log.error("Face capture failed: %s", e)
        return frames

    def cleanup(self):
        for cam in self._csi.values():
            try:
                cam.stop()
                cam.close()
            except Exception:
                pass
        for cap in list(self._usb.values()) + ([self._face_cap] if self._face_cap else []):
            try:
                cap.release()
            except Exception:
                pass
        log.info("All cameras released")
