"""
API routes for item verification.

Endpoints:
    POST /verify           - Full hybrid verification (original vs kiosk images)
    POST /extract-features - Pre-extract features for storage
    GET  /health           - Service health check
"""

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
    FaceVerificationResponse,
    FeatureExtractionResponse,
    HealthResponse,
    StorableFeatures,
    VerificationResponse,
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


@router.post("/verify-face", response_model=FaceVerificationResponse)
async def verify_face(
    captured_image: UploadFile = File(..., description="Captured face image from kiosk camera"),
    reference_image_url: str = Form(..., description="URL of the user's reference profile photo"),
):
    """
    Verify that the captured face matches a reference image.

    Uses OpenCV Haar cascade for detection + histogram correlation for identity matching.
    Returns verified=True when confidence >= 0.60.
    """
    cap_path = ref_path = None
    try:
        cap_bytes = await captured_image.read()
        cap_arr = np.frombuffer(cap_bytes, np.uint8)
        cap_img = cv2.imdecode(cap_arr, cv2.IMREAD_COLOR)
        if cap_img is None:
            raise HTTPException(status_code=400, detail="Cannot decode captured image")

        faces = _detect_faces(cap_img)
        if len(faces) == 0:
            return FaceVerificationResponse(
                verified=False,
                detected=False,
                confidence=0.0,
                message="No face detected in captured image",
            )

        # Crop the largest detected face from captured image
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        cap_face = cap_img[y : y + h, x : x + w]

        # Download and decode the reference image
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
        if len(ref_faces) == 0:
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
    )
