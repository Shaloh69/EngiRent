"""
The real face backend for `liveness.check_liveness`: dlib (via
face_recognition) for detection, 68-point landmarks and the 128-d encoding,
and BiSeNet face parsing over ONNX Runtime for the head-covering rule.

Fails closed: if dlib, its landmark model or the parsing weights are missing,
`load_backend()` raises `FaceModelsUnavailable` and the route answers 503.
There is deliberately no weaker fallback (compare the Haar path in
routers/verification.py, which this endpoint does not use).

The encoder runs with face_recognition's defaults (5-point alignment, no
jitter), the same as /register-face, so a new template stays comparable with
an enrolment made before the revamp: that comparison is what authorises a
re-enrolment (PROGRESS.md, ruling 2026-10-15).
"""

from __future__ import annotations

import io
import logging
import os
import threading

import cv2
import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


class FaceModelsUnavailable(RuntimeError):
    pass


def decode_frame(data: bytes, max_side: int) -> np.ndarray:
    """JPEG/PNG bytes -> RGB array, upright (EXIF applied), longest side capped."""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    w, h = img.size
    scale = max_side / float(max(w, h))
    if scale < 1.0:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR)
    return np.asarray(img)


class DlibOnnxBackend:
    _MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    _STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    def __init__(self, parsing_model_path: str):
        try:
            import dlib
            import face_recognition
            import face_recognition_models
            import onnxruntime as ort
        except ImportError as e:
            raise FaceModelsUnavailable(f"face libraries missing: {e}") from e
        if not os.path.isfile(parsing_model_path):
            raise FaceModelsUnavailable(f"face parsing model missing: {parsing_model_path}")
        self._fr = face_recognition
        self._dlib = dlib
        self._predictor = dlib.shape_predictor(face_recognition_models.pose_predictor_model_location())
        self._session = ort.InferenceSession(parsing_model_path, providers=["CPUExecutionProvider"])
        self._input = self._session.get_inputs()[0].name

    def faces(self, rgb):
        return [tuple(int(v) for v in b) for b in self._fr.face_locations(rgb, model="hog")]

    def landmarks(self, rgb, box):
        top, right, bottom, left = box
        shape = self._predictor(rgb, self._dlib.rectangle(left, top, right, bottom))
        return np.array([(p.x, p.y) for p in shape.parts()], dtype=np.float64)

    def encoding(self, rgb, box):
        return self._fr.face_encodings(rgb, [box])[0]

    def parse(self, rgb, box):
        # CelebAMask-HQ faces fill the middle of a square with the whole head
        # and some shoulder in view, so crop generously, above all upwards,
        # where a hat would be.
        top, right, bottom, left = box
        fw, fh = right - left, bottom - top
        h, w = rgb.shape[:2]
        x0, x1 = max(0, int(left - 0.6 * fw)), min(w, int(right + 0.6 * fw))
        y0, y1 = max(0, int(top - 0.9 * fh)), min(h, int(bottom + 0.5 * fh))
        crop = rgb[y0:y1, x0:x1]
        x = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        x = ((x - self._MEAN) / self._STD).transpose(2, 0, 1)[None].astype(np.float32)
        out = self._session.run(None, {self._input: x})[0]
        mask = out.squeeze(0).argmax(0).astype(np.uint8)
        mask = cv2.resize(mask, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_NEAREST)
        lm = self.landmarks(rgb, box) - np.array([x0, y0], dtype=np.float64)
        return mask, lm


_backend: DlibOnnxBackend | None = None
_lock = threading.Lock()


def load_backend(parsing_model_path: str) -> DlibOnnxBackend:
    """One backend per process; models load on first use (a few seconds)."""
    global _backend
    with _lock:
        if _backend is None:
            _backend = DlibOnnxBackend(parsing_model_path)
            logger.info("face liveness backend loaded (dlib + BiSeNet %s)", parsing_model_path)
        return _backend
