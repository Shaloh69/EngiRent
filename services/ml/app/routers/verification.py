"""
API routes for item verification.

Endpoints:
    POST /verify           - Full hybrid verification (original vs kiosk images)
    POST /extract-features - Pre-extract features for storage
    GET  /health           - Service health check
"""

import logging
import os
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..comparison.hybrid import HybridVerifier
from ..config import settings
from ..models.schemas import (
    FeatureExtractionResponse,
    HealthResponse,
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

        result = verifier.verify(
            original_sources=orig_paths,
            kiosk_sources=kiosk_paths,
            attempt_number=attempt_number,
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
        )
    except Exception as e:
        logger.exception("Feature extraction failed")
        raise HTTPException(status_code=500, detail=f"Extraction error: {e}") from e
    finally:
        _cleanup(paths)


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Service health and capability check."""
    return HealthResponse(
        status="healthy",
        service=settings.app_name,
        deep_learning_enabled=settings.enable_deep_learning,
        ocr_enabled=settings.enable_ocr,
    )
