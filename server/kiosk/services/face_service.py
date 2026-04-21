"""
Face detection + verification.

  1. Use OpenCV Haar cascade (built-in, no extra install) to detect a face.
  2. Send the image to the ML service /api/v1/verify-face for identity check.
  3. Return (detected: bool, confidence: float, face_url: str | None)
"""

import io
import logging

import aiohttp
import cv2
import numpy as np

from config import ML_SERVICE_URL
from services.image_uploader import upload_face_image

log = logging.getLogger("kiosk.face")

# Locate haarcascades — cv2.data exists only in pip-installed OpenCV;
# apt-installed (Pi OS Trixie) puts them in /usr/share/opencv4/
import os as _os

_HERE = _os.path.dirname(_os.path.abspath(__file__))

_CASCADE_CANDIDATES = [
    _os.path.join(_HERE, "..", "data", "haarcascade_frontalface_default.xml"),  # bundled
    "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
    "/usr/share/OpenCV/haarcascades/haarcascade_frontalface_default.xml",
    "/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
]


def _find_cascade_path() -> str:
    try:
        p = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        if _os.path.exists(p):
            return p
    except AttributeError:
        pass
    for p in _CASCADE_CANDIDATES:
        p = _os.path.normpath(p)
        if _os.path.exists(p):
            log.info("Haar cascade found at %s", p)
            return p
    raise FileNotFoundError(
        "haarcascade_frontalface_default.xml not found.\n"
        "Fix: mkdir -p server/kiosk/data && cp <cascade.xml> server/kiosk/data/"
    )


_cascade = cv2.CascadeClassifier(_find_cascade_path())


def detect_face_in_frame(jpeg_bytes: bytes) -> tuple[bool, float]:
    """
    Returns (face_found, confidence) using OpenCV Haar cascade.
    Quick local check before sending to ML service.
    Confidence is estimated from relative face size (larger = more confident).
    """
    try:
        nparr = np.frombuffer(jpeg_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        faces = _cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(80, 80),
        )

        if len(faces) == 0:
            return False, 0.0

        # Estimate confidence from the largest detected face area vs frame area
        h, w = frame.shape[:2]
        frame_area = w * h
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        face_ratio   = (fw * fh) / frame_area
        confidence   = min(0.5 + face_ratio * 2.0, 0.99)   # scale 0.5–0.99
        return True, round(confidence, 3)

    except Exception as e:
        log.error("Face detection error: %s", e)
        return False, 0.0


async def verify_face(jpeg_bytes: bytes, reference_face_url: str) -> dict:
    """
    Full verification pipeline:
      1. Detect face locally with OpenCV Haar cascade
      2. Upload captured image to Supabase
      3. Send both images to ML service for identity comparison

    Returns:
      {
        "detected": bool,
        "verified": bool,
        "confidence": float,
        "face_url": str | None,
        "error": str | None
      }
    """
    detected, local_conf = detect_face_in_frame(jpeg_bytes)

    if not detected:
        log.warning("No face detected in frame (local check)")
        return {
            "detected": False,
            "verified": False,
            "confidence": 0.0,
            "face_url": None,
            "error": "No face detected",
        }

    face_url = upload_face_image(jpeg_bytes)

    if not face_url:
        return {
            "detected": True,
            "verified": False,
            "confidence": 0.0,
            "face_url": None,
            "error": "Image upload failed",
        }

    try:
        async with aiohttp.ClientSession() as session:
            data = aiohttp.FormData()
            data.add_field(
                "captured_image",
                io.BytesIO(jpeg_bytes),
                filename="face.jpg",
                content_type="image/jpeg",
            )
            data.add_field("reference_image_url", reference_face_url)

            async with session.post(
                f"{ML_SERVICE_URL}/api/v1/verify-face",
                data=data,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    log.warning(
                        "ML face endpoint returned %d – using local fallback. Body: %s",
                        resp.status,
                        body[:200],
                    )
                    return {
                        "detected": True,
                        "verified": local_conf >= 0.80,
                        "confidence": local_conf,
                        "face_url": face_url,
                        "error": f"ML service error {resp.status} – local fallback used",
                    }
                result = await resp.json()
                return {
                    "detected": True,
                    "verified": result.get("verified", False),
                    "confidence": result.get("confidence", local_conf),
                    "face_url": face_url,
                    "error": None,
                }

    except aiohttp.ClientConnectorError:
        log.warning("ML service unreachable – using local confidence %.2f", local_conf)
        return {
            "detected": True,
            "verified": local_conf >= 0.80,
            "confidence": local_conf,
            "face_url": face_url,
            "error": "ML service unreachable – local fallback used",
        }
    except Exception as e:
        log.error("Face verification error: %s", e)
        return {
            "detected": True,
            "verified": False,
            "confidence": 0.0,
            "face_url": face_url,
            "error": str(e),
        }
