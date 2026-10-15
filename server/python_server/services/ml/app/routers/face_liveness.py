"""
POST /face/liveness-verify: the guided liveness check (spec §3 step 4).

Called only by Node, server to server, with the ML API key. The phone never
reaches this service and nothing it concluded is trusted; Node holds the
issued step order and nonce in its kiosk session and enforces them there.

A plain `def`, so FastAPI runs it in its threadpool: dlib and ONNX are
blocking, and an `async def` here would freeze every other request for the
length of the check (the 2026-09-25 /verify incident).
"""

from __future__ import annotations

import json
import logging
import os

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..config import settings
from ..face.backend import FaceModelsUnavailable, decode_frame, load_backend
from ..face.liveness import BLINK, CENTRE, TURN_LEFT, TURN_RIGHT, Thresholds, check_liveness
from ..models.schemas import LivenessVerifyResponse
from ..security import require_api_key

logger = logging.getLogger(__name__)
router = APIRouter()

_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _model_path() -> str:
    p = settings.face_parsing_model
    return p if os.path.isabs(p) else os.path.join(_SERVICE_ROOT, p)


def _parse_encoding(raw: str | None) -> np.ndarray | None:
    if not raw:
        return None
    try:
        v = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=400, detail="stored_encoding is not JSON") from e
    if not isinstance(v, list) or len(v) != 128:
        # Refuse rather than silently skip the identity check: a malformed
        # template must never turn into "no template, so no comparison".
        raise HTTPException(status_code=400, detail="stored_encoding must be 128 floats")
    return np.asarray(v, dtype=np.float64)


@router.post(
    "/face/liveness-verify",
    response_model=LivenessVerifyResponse,
    dependencies=[Depends(require_api_key)],
)
def liveness_verify(
    centre: UploadFile = File(..., description="Facing the camera, eyes open"),
    blink: UploadFile = File(..., description="Eyes closed"),
    turn_left: UploadFile = File(..., description="Head turned to the student's left"),
    turn_right: UploadFile = File(..., description="Head turned to the student's right"),
    stored_encoding: str | None = Form(default=None, description="JSON, 128 floats: compare the centre frame with it"),
    return_encoding: bool = Form(default=False, description="Return the centre frame's template (enrolment)"),
    mirrored: bool = Form(default=False, description="The phone flipped its frames left-right"),
):
    try:
        backend = load_backend(_model_path())
    except FaceModelsUnavailable as e:
        logger.error("liveness-verify refused, models unavailable: %s", e)
        raise HTTPException(status_code=503, detail="Face liveness models unavailable") from e

    template = _parse_encoding(stored_encoding)
    frames = {}
    for step, upload in ((CENTRE, centre), (BLINK, blink), (TURN_LEFT, turn_left), (TURN_RIGHT, turn_right)):
        data = upload.file.read()
        if not data:
            raise HTTPException(status_code=400, detail=f"{step} frame is empty")
        try:
            frames[step] = decode_frame(data, settings.face_max_image_side)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"{step} frame cannot be decoded") from e

    r = check_liveness(
        frames,
        backend,
        Thresholds.from_settings(settings),
        stored_encoding=template,
        mirrored=mirrored,
    )
    logger.info(
        "liveness-verify passed=%s live=%s reason=%s step=%s distance=%s metrics=%s",
        r.passed, r.live, r.reason, r.step, r.distance, r.metrics,
    )
    return LivenessVerifyResponse(
        passed=r.passed,
        live=r.live,
        reason=r.reason,
        step=r.step,
        matched=r.matched,
        distance=r.distance,
        encoding=r.encoding if (return_encoding and r.live) else None,
        metrics=r.metrics,
    )
