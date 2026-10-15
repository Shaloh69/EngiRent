"""
Synthetic faces for the liveness tests: landmark sets and parsing masks built
from geometry, never from a photograph (the repo is public; real face frames
live only in the gitignored tests/fixtures/faces/).
"""

import math

import cv2
import numpy as np

from app.face.covering import HAIR, HAT, SKIN
from app.face.geometry import _MODEL_POINTS, _PNP_INDICES

W, H = 640, 480


def _eye(cx: float, cy: float, width: float, openness: float) -> np.ndarray:
    """Six dlib eye points: corners at 0/3, upper lid 1-2, lower lid 4-5."""
    half, lid = width / 2.0, openness * width / 2.0
    return np.array(
        [
            (cx - half, cy),
            (cx - half / 3, cy - lid),
            (cx + half / 3, cy - lid),
            (cx + half, cy),
            (cx + half / 3, cy + lid),
            (cx - half / 3, cy + lid),
        ]
    )


def _landmarks_at(yaw_cam_deg: float, pitch_cam_deg: float = 0.0) -> np.ndarray:
    """68 landmarks with the six PnP points projected from the generic head
    rotated by `yaw_cam_deg` about the camera's vertical axis."""
    flip = cv2.Rodrigues(np.array([math.pi, 0.0, 0.0]))[0]  # model y-up -> camera y-down, facing us
    ry = cv2.Rodrigues(np.array([0.0, math.radians(yaw_cam_deg), 0.0]))[0]
    rx = cv2.Rodrigues(np.array([math.radians(pitch_cam_deg), 0.0, 0.0]))[0]
    rvec = cv2.Rodrigues(rx @ ry @ flip)[0]
    cam = np.array([[W, 0, W / 2], [0, W, H / 2], [0, 0, 1]], dtype=np.float64)
    pts, _ = cv2.projectPoints(_MODEL_POINTS, rvec, np.array([0.0, 0.0, 1500.0]), cam, np.zeros(4))
    lm = np.zeros((68, 2))
    for i, p in zip(_PNP_INDICES, pts.reshape(-1, 2)):
        lm[i] = p
    return lm


def _landmarks() -> np.ndarray:
    lm = np.zeros((68, 2))
    lm[0:3] = (50, 100)  # jaw, image-left
    lm[14:17] = (150, 100)  # jaw, image-right
    lm[8] = (100, 170)  # chin
    lm[17:22] = [(60 + 6 * i, 80) for i in range(5)]  # brows at y=80
    lm[22:27] = [(116 + 6 * i, 80) for i in range(5)]
    lm[17] = (60, 80)
    lm[26] = (140, 80)
    lm[36:48] = (100, 95)  # eye line y=95
    return lm


def _bare() -> np.ndarray:
    m = np.zeros((200, 200), dtype=np.uint8)
    m[20:60, 45:155] = HAIR
    m[55:170, 50:150] = SKIN
    return m


def _hijab(m):
    m[5:52, 20:180] = HAT
    m[5:195, 20:50] = HAT
    m[5:195, 150:180] = HAT
    return m


def _lids(outer: np.ndarray, inner: np.ndarray, openness: float, outer_first: bool) -> np.ndarray:
    """Six eye points between two corners, EAR == openness."""
    a, b = (outer, inner) if outer_first else (inner, outer)
    d = b - a
    up = np.array([0.0, -np.linalg.norm(d) * openness / 2.0])
    return np.array([a, a + d / 3 + up, a + 2 * d / 3 + up, b, a + 2 * d / 3 - up, a + d / 3 - up])


def face_landmarks(yaw_cam_deg: float = 0.0, openness: float = 0.3) -> np.ndarray:
    """A whole synthetic face: head pose from `_landmarks_at`, eyes whose
    outer corners ARE the pose points 36 and 45 (as on a real face), so EAR
    and yaw are read from one consistent set of landmarks."""
    lm = _landmarks_at(yaw_cam_deg)
    o_left, o_right = lm[36].copy(), lm[45].copy()
    span = o_right - o_left
    lm[36:42] = _lids(o_left, o_left + 0.3 * span, openness, outer_first=True)
    lm[42:48] = _lids(o_right - 0.3 * span, o_right, openness, outer_first=True)
    return lm
