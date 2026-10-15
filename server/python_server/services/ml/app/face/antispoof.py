"""
Passive anti-spoofing (spec §7.4, F1b): is this a live face, or a printed
photo / a screen held up to the camera?

Model and preprocessing come from facenox/face-antispoof-onnx
(https://github.com/facenox/face-antispoof-onnx, Apache License 2.0, commit
2f8dd93dd0fd9d120f08e83d9020719f67ffdb68): MiniFASNetV2-SE, INT8 ONNX,
`models/best/98.20/best_model_quantized.onnx`. `square_crop` and `preprocess`
below are ported from its `src/inference/inference.py::crop` and
`src/inference/preprocess.py::preprocess` with the logic unchanged; only the
names, typing and comments are EngiRent's.

Pipeline (theirs): a square crop of 1.5x the longer side of the face box,
reflect-padded at the image edges; letterboxed to 128x128 (reflect border);
RGB scaled to [0, 1], CHW, no mean/std. Output logits are [real, spoof]; the
face is real when real - spoof >= logit(p), p = 0.5 by default (their demo).

One adaptation, and it is a guess until measured: their box came from their
own detector (forehead to chin), dlib's HOG box is tighter, so the box here
is built from the 68 landmarks to approximate theirs (`face_box`).
"""

from __future__ import annotations

import cv2
import numpy as np

INPUT_SIZE = 128
EXPANSION = 1.5


def face_box(landmarks: np.ndarray) -> tuple[int, int, int, int]:
    """(x1, y1, x2, y2): jaw width, from above the brows to the chin."""
    lm = np.asarray(landmarks, dtype=np.float64)
    x1, x2 = lm[0:17, 0].min(), lm[0:17, 0].max()
    brow, chin = lm[17:27, 1].min(), lm[0:17, 1].max()
    y1 = brow - 0.3 * (chin - brow)
    return int(x1), int(y1), int(x2), int(chin)


def square_crop(img: np.ndarray, bbox: tuple[int, int, int, int], expansion: float = EXPANSION) -> np.ndarray:
    """Ported `crop()`: square, centred, `expansion` x the longer side, reflect-padded."""
    h_img, w_img = img.shape[:2]
    x, y, x2, y2 = bbox
    w, h = x2 - x, y2 - y
    if w <= 0 or h <= 0:
        raise ValueError("invalid face box")
    max_dim = max(w, h)
    cx, cy = x + w / 2, y + h / 2
    x = int(cx - max_dim * expansion / 2)
    y = int(cy - max_dim * expansion / 2)
    size = int(max_dim * expansion)
    x1c, y1c = max(0, x), max(0, y)
    x2c, y2c = min(w_img, x + size), min(h_img, y + size)
    top, left = int(max(0, -y)), int(max(0, -x))
    bottom, right = int(max(0, y + size - h_img)), int(max(0, x + size - w_img))
    part = img[y1c:y2c, x1c:x2c, :] if (x2c > x1c and y2c > y1c) else np.zeros((0, 0, 3), img.dtype)
    out = cv2.copyMakeBorder(part, top, bottom, left, right, cv2.BORDER_REFLECT_101)
    if out.shape[0] != size or out.shape[1] != size:
        raise ValueError("face crop size mismatch")
    return out


def preprocess(crop_rgb: np.ndarray, size: int = INPUT_SIZE) -> np.ndarray:
    """Ported `preprocess()`: letterbox to size x size, [0, 1], CHW float32."""
    old = crop_rgb.shape[:2]
    ratio = float(size) / max(old)
    shape = tuple(int(v * ratio) for v in old)
    interp = cv2.INTER_LANCZOS4 if ratio > 1.0 else cv2.INTER_AREA
    img = cv2.resize(crop_rgb, (shape[1], shape[0]), interpolation=interp)
    dw, dh = size - shape[1], size - shape[0]
    img = cv2.copyMakeBorder(img, dh // 2, dh - dh // 2, dw // 2, dw - dw // 2, cv2.BORDER_REFLECT_101)
    return img.transpose(2, 0, 1).astype(np.float32) / 255.0


def real_minus_spoof(session, input_name: str, rgb: np.ndarray, landmarks: np.ndarray) -> float:
    """real - spoof logit for the face these landmarks describe. >= 0 reads real."""
    batch = preprocess(square_crop(rgb, face_box(landmarks)))[None]
    logits = session.run(None, {input_name: batch})[0][0]
    return float(logits[0] - logits[1])
