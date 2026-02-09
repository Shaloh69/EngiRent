"""
EngiRent AI Verification Service - FastAPI Application.

This service handles item verification by comparing owner-uploaded
images with kiosk camera captures using a hybrid approach:

- Phase 1: Traditional CV (color histograms, shape descriptors, LBP texture, ORB keypoints)
- Phase 2: SIFT keypoint matching with Lowe's ratio test
- Phase 3: Deep learning features (ResNet50) + OCR serial number matching
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import verification

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title=settings.app_name,
    description=(
        "AI-powered item verification for EngiRent Hub kiosks. "
        "Compares owner listing photos with kiosk camera captures "
        "to verify item identity before releasing rental payments."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(verification.router, prefix="/api/v1", tags=["verification"])


@app.get("/")
async def root():
    return {
        "service": settings.app_name,
        "version": "1.0.0",
        "docs": "/docs",
        "verification_endpoint": "/api/v1/verify",
    }
