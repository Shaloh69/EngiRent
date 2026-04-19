"""
Face detection + verification.

  1. Use MediaPipe to detect a face is present in the frame.
  2. Send the image to the ML service /api/v1/verify-face for identity check.
  3. Return (detected: bool, confidence: float, face_url: str | None)
"""

import io
import logging

import aiohttp
import mediapipe as mp
import numpy as np
import cv2

from config import ML_SERVICE_URL
from services.image_uploader import upload_face_image

log = logging.getLogger(__name__)

mp_face = mp.solutions.face_detection
_detector = mp_face.FaceDetection(model_selection=0, min_detection_confidence=0.6)


def detect_face_in_frame(jpeg_bytes: bytes) -> tuple[bool, float]:
    """
    Returns (face_found, confidence) from MediaPipe.
    Quick local check before sending to ML service.
    """
    try:
        nparr = np.frombuffer(jpeg_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = _detector.process(rgb)
        if results.detections:
            score = results.detections[0].score[0]
            return True, float(score)
        return False, 0.0
    except Exception as e:
        log.error("Face detection error: %s", e)
        return False, 0.0


async def verify_face(
    jpeg_bytes: bytes, reference_face_url: str
) -> dict:
    """
    Full verification pipeline:
      1. Detect face locally with MediaPipe
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

    # Send to ML service for identity verification
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
        # Fall back: accept if local MediaPipe confidence is high enough
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
