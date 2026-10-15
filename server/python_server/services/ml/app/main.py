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
from .routers import face_liveness, verification

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

_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    # All real callers are server-side and don't need CORS; only listed browser
    # origins are permitted. Never fall back to "*".
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(verification.router, prefix="/api/v1", tags=["verification"])
app.include_router(face_liveness.router, prefix="/api/v1", tags=["face"])


@app.on_event("startup")
async def _warm_v2():
    # The v2 models take minutes to load on this CPU; load them in the
    # background at startup so the first deposit after a restart is not the
    # one that pays for it.
    if settings.pipeline_version == "v2":
        import threading

        from .v2.verifier import warm

        threading.Thread(target=warm, name="v2-warm", daemon=True).start()


@app.get("/")
async def root():
    return {
        "service": settings.app_name,
        "version": "1.0.0",
        "docs": "/docs",
        "verification_endpoint": "/api/v1/verify",
    }
