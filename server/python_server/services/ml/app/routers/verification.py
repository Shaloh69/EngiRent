"""
API routes for item verification and face recognition.

Endpoints:
    POST /verify           - Full hybrid verification (original vs kiosk images)
    POST /extract-features - Pre-extract features for storage
    POST /register-face    - Extract 128-float face encoding from a registration photo
    POST /verify-face      - Verify captured face against stored encoding or reference URL
    GET  /health           - Service health check
"""

import base64
import json
import logging
import os
import tempfile
from urllib.request import urlretrieve

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..comparison.hybrid import HybridVerifier
from ..config import settings
from ..models.schemas import (
    FaceRegisterResponse,
    FaceVerificationResponse,
    FeatureExtractionResponse,
    HealthResponse,
    StorableFeatures,
    VerificationResponse,
)

# face_recognition is optional — gracefully degrade to Haar cascade if not installed
try:
    import face_recognition as _fr
    _FR_AVAILABLE = True
    logger_tmp = logging.getLogger(__name__)
    logger_tmp.info("face_recognition (dlib) loaded — high-accuracy mode active")
except ImportError:
    _fr = None  # type: ignore[assignment]
    _FR_AVAILABLE = False
    logging.getLogger(__name__).warning(
        "face_recognition library not installed — falling back to Haar cascade. "
        "Run: pip install face_recognition"
    )

logger = logging.getLogger(__name__)
router = APIRouter()

verifier = HybridVerifier()


async def _save_uploads(files: list[UploadFile]) -> list[str]:
    """Save uploaded files to temp directory and return file paths."""
    os.makedirs(settings.upload_dir, exist_ok=True)
    paths = []
    for f in files:
        content = await f.read()
        suffix = os.path.splitext(f.filename or "image.jpg")[1] or ".jpg"
        tmp = tempfile.NamedTemporaryFile(
            dir=settings.upload_dir, suffix=suffix, delete=False
        )
        tmp.write(content)
        tmp.close()
        paths.append(tmp.name)
    return paths


def _cleanup(paths: list[str]):
    """Remove temporary files."""
    for p in paths:
        try:
            os.unlink(p)
        except OSError:
            pass


@router.post("/verify", response_model=VerificationResponse)
async def verify_item(
    original_images: list[UploadFile] = File(
        ..., description="Owner's uploaded reference images (3+)"
    ),
    kiosk_images: list[UploadFile] = File(
        ..., description="Kiosk camera captures (3-5)"
    ),
    attempt_number: int = Form(default=1, ge=1, le=10),
    reference_features: str | None = Form(
        default=None,
        description="JSON-encoded pre-extracted features from Item.mlFeatures (skips ResNet50 re-extraction)",
    ),
):
    """
    Full hybrid verification: compare owner images with kiosk camera images.

    Upload both sets of images, and the system will:
    1. Extract traditional CV features (color, shape, texture, ORB)
    2. Run SIFT keypoint matching
    3. Run deep learning similarity (ResNet50)
    4. Check for serial number matches (OCR)
    5. Combine all scores with weighted average
    6. Return a verification decision

    Decision thresholds:
    - >= 85%: APPROVED (item verified)
    - 60-84%: PENDING (admin manual review)
    - < 60%: RETRY (up to 10 attempts) or REJECTED
    """
    if len(original_images) < 1:
        raise HTTPException(status_code=400, detail="At least 1 original image required")
    if len(kiosk_images) < 1:
        raise HTTPException(status_code=400, detail="At least 1 kiosk image required")

    orig_paths = []
    kiosk_paths = []

    try:
        orig_paths = await _save_uploads(original_images)
        kiosk_paths = await _save_uploads(kiosk_images)

        logger.info(
            "Verifying: %d original images vs %d kiosk images (attempt %d)",
            len(orig_paths),
            len(kiosk_paths),
            attempt_number,
        )

        parsed_features = json.loads(reference_features) if reference_features else None

        result = verifier.verify(
            original_sources=orig_paths,
            kiosk_sources=kiosk_paths,
            attempt_number=attempt_number,
            reference_features=parsed_features,
        )

        return VerificationResponse(**result)

    except Exception as e:
        logger.exception("Verification failed")
        raise HTTPException(status_code=500, detail=f"Verification error: {e}") from e
    finally:
        _cleanup(orig_paths + kiosk_paths)


@router.post("/extract-features", response_model=FeatureExtractionResponse)
async def extract_features(
    images: list[UploadFile] = File(
        ..., description="Images to extract features from"
    ),
):
    """
    Pre-extract and return features from uploaded images.

    Use this when an owner creates a listing - extract features once
    and store them in the database so verification is faster later.
    """
    if len(images) < 1:
        raise HTTPException(status_code=400, detail="At least 1 image required")

    paths = []
    try:
        paths = await _save_uploads(images)

        features = verifier.extract_reference_features(paths)

        return FeatureExtractionResponse(
            image_count=features["image_count"],
            traditional_features_count=len(features["traditional"]),
            deep_features_count=len(features["deep"]),
            ocr_texts=features["ocr_texts"],
            features=StorableFeatures(
                traditional=features["traditional"],
                deep=features["deep"],
                ocr_texts=features["ocr_texts"],
                image_count=features["image_count"],
            ),
        )
    except Exception as e:
        logger.exception("Feature extraction failed")
        raise HTTPException(status_code=500, detail=f"Extraction error: {e}") from e
    finally:
        _cleanup(paths)


def _load_face_cascade() -> cv2.CascadeClassifier:
    candidates = [
        "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
        "/usr/share/OpenCV/haarcascades/haarcascade_frontalface_default.xml",
        "/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
    ]
    try:
        p = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        if os.path.exists(p):
            return cv2.CascadeClassifier(p)
    except AttributeError:
        pass
    for p in candidates:
        if os.path.exists(p):
            return cv2.CascadeClassifier(p)
    return cv2.CascadeClassifier()


_face_cascade = _load_face_cascade()


def _detect_faces(img_bgr: np.ndarray) -> list:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    if _face_cascade.empty():
        return []
    return list(
        _face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    )


def _face_similarity(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Compare two face crops using histogram correlation (fast, no heavy model needed)."""
    size = (128, 128)
    a = cv2.resize(img_a, size)
    b = cv2.resize(img_b, size)
    score = 0.0
    for ch in range(3):
        ha = cv2.calcHist([a], [ch], None, [64], [0, 256])
        hb = cv2.calcHist([b], [ch], None, [64], [0, 256])
        cv2.normalize(ha, ha)
        cv2.normalize(hb, hb)
        score += cv2.compareHist(ha, hb, cv2.HISTCMP_CORREL)
    return max(0.0, score / 3.0)


@router.post("/register-face", response_model=FaceRegisterResponse)
async def register_face(
    image: UploadFile = File(..., description="In-app selfie taken during registration"),
):
    """
    Extract a 128-float face encoding from a registration photo.

    Store the returned encoding in User.faceEncoding (JSON column).
    Uses face_recognition (dlib) when available; falls back to Haar cascade
    detection-only mode which returns success=False with a descriptive message.
    """
    try:
        img_bytes = await image.read()
        img_arr = np.frombuffer(img_bytes, np.uint8)
        img_bgr = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise HTTPException(status_code=400, detail="Cannot decode image")

        if _FR_AVAILABLE:
            img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
            face_locations = _fr.face_locations(img_rgb, model="hog")
            if not face_locations:
                return FaceRegisterResponse(
                    success=False,
                    encoding=None,
                    message="No face detected — ensure good lighting and face the camera directly",
                )
            if len(face_locations) > 1:
                return FaceRegisterResponse(
                    success=False,
                    encoding=None,
                    message="Multiple faces detected — only one person should be in frame",
                )
            encodings = _fr.face_encodings(img_rgb, face_locations)
            if not encodings:
                return FaceRegisterResponse(
                    success=False,
                    encoding=None,
                    message="Could not compute face encoding — try a clearer photo",
                )
            encoding: list[float] = encodings[0].tolist()

            # Crop face for preview
            top, right, bottom, left = face_locations[0]
            face_crop_rgb = img_rgb[top:bottom, left:right]
            face_crop_bgr = cv2.cvtColor(face_crop_rgb, cv2.COLOR_RGB2BGR)
            _, buf = cv2.imencode(".jpg", face_crop_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
            face_b64 = base64.b64encode(buf.tobytes()).decode()

            return FaceRegisterResponse(
                success=True,
                encoding=encoding,
                face_image_data=face_b64,
                message="Face encoding extracted successfully",
            )

        # Haar cascade fallback — detection only, no encoding
        faces = _detect_faces(img_bgr)
        if not faces:
            return FaceRegisterResponse(
                success=False,
                encoding=None,
                message="No face detected (Haar cascade fallback — install face_recognition for encoding support)",
            )
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        face_crop = img_bgr[y : y + h, x : x + w]
        _, buf = cv2.imencode(".jpg", face_crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        face_b64 = base64.b64encode(buf.tobytes()).decode()
        return FaceRegisterResponse(
            success=False,
            encoding=None,
            face_image_data=face_b64,
            message="Face detected but encoding unavailable — face_recognition library not installed",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Face registration failed")
        raise HTTPException(status_code=500, detail=f"Face registration error: {e}") from e


def _dlib_verify(cap_rgb: np.ndarray, stored_encoding: list[float] | None, ref_rgb: np.ndarray | None) -> tuple[bool, bool, float, str]:
    """
    Compare captured face against stored encoding or reference image using dlib.
    Returns (verified, detected, confidence, message).
    """
    cap_locations = _fr.face_locations(cap_rgb, model="hog")
    if not cap_locations:
        return False, False, 0.0, "No face detected in captured image"

    cap_encodings = _fr.face_encodings(cap_rgb, cap_locations)
    if not cap_encodings:
        return False, True, 0.0, "Could not compute encoding for captured face"

    cap_enc = cap_encodings[0]

    if stored_encoding is not None:
        ref_enc = np.array(stored_encoding, dtype=np.float64)
    elif ref_rgb is not None:
        ref_locations = _fr.face_locations(ref_rgb, model="hog")
        if not ref_locations:
            ref_enc_list = _fr.face_encodings(ref_rgb)
        else:
            ref_enc_list = _fr.face_encodings(ref_rgb, ref_locations)
        if not ref_enc_list:
            return False, True, 0.0, "Could not detect face in reference image"
        ref_enc = ref_enc_list[0]
    else:
        return False, True, 0.0, "No reference encoding or image provided"

    distance = float(_fr.face_distance([ref_enc], cap_enc)[0])
    # distance 0.0 = identical, ~0.6 = threshold, 1.0+ = very different
    # Map to 0-1 confidence: confidence = 1 - (distance / 0.6), clamped
    confidence = max(0.0, min(1.0, 1.0 - distance / 0.6))
    verified = distance <= 0.5  # stricter than dlib default 0.6 for higher precision

    msg = "Identity verified" if verified else "Face does not match reference"
    return verified, True, round(confidence, 3), msg


@router.post("/verify-face", response_model=FaceVerificationResponse)
async def verify_face(
    captured_image: UploadFile = File(..., description="Captured face image from kiosk camera"),
    reference_image_url: str = Form(default="", description="URL of the user's reference profile photo (used when no stored encoding)"),
    stored_encoding: str | None = Form(default=None, description="JSON array of 128 floats from User.faceEncoding (preferred over URL)"),
):
    """
    Verify that the captured face matches a reference.

    Priority: stored_encoding (fast, no download) > reference_image_url (download + encode).
    Uses face_recognition (dlib, 99.38% LFW accuracy) when available;
    falls back to Haar cascade + histogram correlation.
    Returns verified=True when confidence >= threshold.
    """
    ref_path = None
    try:
        cap_bytes = await captured_image.read()
        cap_arr = np.frombuffer(cap_bytes, np.uint8)
        cap_img = cv2.imdecode(cap_arr, cv2.IMREAD_COLOR)
        if cap_img is None:
            raise HTTPException(status_code=400, detail="Cannot decode captured image")

        parsed_encoding: list[float] | None = None
        if stored_encoding:
            try:
                parsed_encoding = json.loads(stored_encoding)
                if not isinstance(parsed_encoding, list) or len(parsed_encoding) != 128:
                    parsed_encoding = None
            except (json.JSONDecodeError, ValueError):
                parsed_encoding = None

        if _FR_AVAILABLE:
            cap_rgb = cv2.cvtColor(cap_img, cv2.COLOR_BGR2RGB)
            ref_rgb: np.ndarray | None = None

            if parsed_encoding is None and reference_image_url:
                suffix = os.path.splitext(reference_image_url.split("?")[0])[-1] or ".jpg"
                tmp_fd, ref_path = tempfile.mkstemp(suffix=suffix, dir=settings.upload_dir)
                os.close(tmp_fd)
                urlretrieve(reference_image_url, ref_path)  # noqa: S310
                ref_bgr = cv2.imread(ref_path)
                if ref_bgr is not None:
                    ref_rgb = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2RGB)

            verified, detected, confidence, message = _dlib_verify(cap_rgb, parsed_encoding, ref_rgb)
            return FaceVerificationResponse(verified=verified, detected=detected, confidence=confidence, message=message)

        # --- Haar cascade fallback ---
        faces = _detect_faces(cap_img)
        if len(faces) == 0:
            return FaceVerificationResponse(
                verified=False,
                detected=False,
                confidence=0.0,
                message="No face detected in captured image",
            )

        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        cap_face = cap_img[y : y + h, x : x + w]

        if not reference_image_url:
            return FaceVerificationResponse(
                verified=False,
                detected=True,
                confidence=0.0,
                message="No reference provided for comparison",
            )

        suffix = os.path.splitext(reference_image_url.split("?")[0])[-1] or ".jpg"
        tmp_fd, ref_path = tempfile.mkstemp(suffix=suffix, dir=settings.upload_dir)
        os.close(tmp_fd)
        urlretrieve(reference_image_url, ref_path)  # noqa: S310

        ref_img = cv2.imread(ref_path)
        if ref_img is None:
            return FaceVerificationResponse(
                verified=False,
                detected=True,
                confidence=0.0,
                message="Could not load reference image",
            )

        ref_faces = _detect_faces(ref_img)
        if not ref_faces:
            ref_face = ref_img
        else:
            rx, ry, rw, rh = max(ref_faces, key=lambda f: f[2] * f[3])
            ref_face = ref_img[ry : ry + rh, rx : rx + rw]

        confidence = _face_similarity(cap_face, ref_face)
        verified = confidence >= 0.60

        return FaceVerificationResponse(
            verified=verified,
            detected=True,
            confidence=round(confidence, 3),
            message="Identity verified" if verified else "Face does not match reference",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Face verification failed")
        raise HTTPException(status_code=500, detail=f"Face verification error: {e}") from e
    finally:
        if ref_path and os.path.exists(ref_path):
            try:
                os.unlink(ref_path)
            except OSError:
                pass


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Service health and capability check."""
    return HealthResponse(
        status="healthy",
        service=settings.app_name,
        deep_learning_enabled=settings.enable_deep_learning,
        ocr_enabled=settings.enable_ocr,
        face_recognition_enabled=_FR_AVAILABLE,
    )
