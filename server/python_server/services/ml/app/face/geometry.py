"""
Pure geometry on dlib's 68-point face landmarks: eye openness and head yaw.

Nothing here loads a model or touches an image, so every function can be
tested with synthetic landmarks (tests/test_face_geometry.py).

Landmark indices are dlib's iBUG 300-W layout:
    0-16 jaw, 17-21 / 22-26 brows (image-left / image-right),
    27-30 nose bridge (30 = tip), 36-41 / 42-47 eyes, 48 / 54 mouth corners.
"Image-left" is the left of the picture, which on an unmirrored front camera
is the person's RIGHT side.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

# Six points of a generic head (millimetre-ish units, nose tip at the origin,
# y up, the face pointing along +z). The usual LearnOpenCV head-pose model.
_MODEL_POINTS = np.array(
    [
        (0.0, 0.0, 0.0),  # 30 nose tip
        (0.0, -330.0, -65.0),  # 8 chin
        (-225.0, 170.0, -135.0),  # 36 image-left eye, outer corner
        (225.0, 170.0, -135.0),  # 45 image-right eye, outer corner
        (-150.0, -150.0, -125.0),  # 48 image-left mouth corner
        (150.0, -150.0, -125.0),  # 54 image-right mouth corner
    ],
    dtype=np.float64,
)
_PNP_INDICES = (30, 8, 36, 45, 48, 54)

LEFT_EYE = slice(36, 42)  # image-left eye
RIGHT_EYE = slice(42, 48)  # image-right eye


def eye_aspect_ratio(eye: np.ndarray) -> float:
    """Soukupova & Cech (2016) EAR for one eye's six landmarks.

    ~0.25-0.35 for an open eye, falling towards 0 as it closes. The ratio is
    scale-free, so the face's distance from the camera does not matter.
    """
    p = np.asarray(eye, dtype=np.float64)
    vertical = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
    horizontal = np.linalg.norm(p[0] - p[3])
    if horizontal <= 1e-6:
        return 0.0
    return float(vertical / (2.0 * horizontal))


def mean_ear(landmarks: np.ndarray) -> float:
    """Mean EAR of both eyes. A blink closes both, so the mean is the signal."""
    lm = np.asarray(landmarks, dtype=np.float64)
    return (eye_aspect_ratio(lm[LEFT_EYE]) + eye_aspect_ratio(lm[RIGHT_EYE])) / 2.0


def yaw_ratio(landmarks: np.ndarray) -> float:
    """Where the nose tip sits between the two outer eye corners, as a signed
    ratio in about [-1, +1]: 0 = facing the camera, positive = the face points
    toward the picture's RIGHT edge, negative = toward the LEFT.

    Unlike solvePnP's yaw this cannot flip sign: measured on 21 real phone
    attempts (2026-10-15), PnP read -60 degrees for a plainly right-pointing
    face while this ratio was correct in all 36 turn frames. The magnitude is
    not degrees; calibrate thresholds from real frames.
    """
    lm = np.asarray(landmarks, dtype=np.float64)
    d_left = lm[30, 0] - lm[36, 0]
    d_right = lm[45, 0] - lm[30, 0]
    total = d_left + d_right
    if abs(total) < 1e-6:
        return 0.0
    return float((d_left - d_right) / total)


def head_pose(landmarks: np.ndarray, image_size: tuple[int, int]) -> tuple[float, float]:
    """(yaw, pitch) in degrees from six landmarks and `cv2.solvePnP`.

    Sign conventions are defined on the IMAGE, not on the person, so they do
    not depend on whether the phone mirrored the frame:
        yaw   > 0  the face points towards the right edge of the picture
        pitch > 0  the face points up

    Read from the head's forward vector rather than from Euler angles, which
    flip and wrap near the solver's 180-degree solutions.
    `image_size` is (width, height).
    """
    lm = np.asarray(landmarks, dtype=np.float64)
    image_points = np.array([lm[i] for i in _PNP_INDICES], dtype=np.float64)
    w, h = image_size
    focal = float(w)  # an uncalibrated phone camera: focal length ~ image width
    camera = np.array([[focal, 0, w / 2.0], [0, focal, h / 2.0], [0, 0, 1]], dtype=np.float64)
    ok, rvec, _tvec = cv2.solvePnP(
        _MODEL_POINTS, image_points, camera, np.zeros((4, 1)), flags=cv2.SOLVEPNP_ITERATIVE
    )
    if not ok:
        raise ValueError("head pose could not be solved")
    rot, _ = cv2.Rodrigues(rvec)
    fwd = rot @ np.array([0.0, 0.0, 1.0])  # the model's +z, in camera coordinates
    # Facing the camera, fwd ~ (0, 0, -1). Camera x points right, y points down.
    yaw = math.degrees(math.atan2(fwd[0], -fwd[2]))
    pitch = math.degrees(math.atan2(-fwd[1], -fwd[2]))
    return yaw, pitch
