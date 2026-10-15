"""
Server-side liveness decision over a guided frame set (spec §3 step 4).

The phone coaches the student through BLINK, TURN_LEFT and TURN_RIGHT in the
order the server issued, and sends one frame per step plus a centred,
eyes-open frame. Nothing the phone concluded is trusted: every step is
re-checked here, on the frames.

Order and nonce are Node's to enforce (they live in its kiosk session, the
trust boundary). This module only answers "do these frames show a live,
bare-headed person doing each step, and is it the enrolled person".

The face backend is a parameter so the decision logic is testable without a
face image (tests/test_face_liveness.py); `backend.DlibOnnxBackend` is the
real one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from .covering import assess_covering
from .geometry import head_pose, mean_ear

CENTRE, BLINK, TURN_LEFT, TURN_RIGHT = "CENTRE", "BLINK", "TURN_LEFT", "TURN_RIGHT"
STEPS = (CENTRE, BLINK, TURN_LEFT, TURN_RIGHT)

# Reason codes. Node maps each to the sentence the student sees; the code
# itself never reaches a screen.
NO_FACE = "NO_FACE"
MULTIPLE_FACES = "MULTIPLE_FACES"
HAT = "HAT"
EYES_CLOSED = "EYES_CLOSED"
NOT_FACING = "NOT_FACING"
NO_BLINK = "NO_BLINK"
TURN_LEFT_SHORT = "TURN_LEFT_SHORT"
TURN_RIGHT_SHORT = "TURN_RIGHT_SHORT"
NOT_SAME_PERSON = "NOT_SAME_PERSON"
NO_MATCH = "NO_MATCH"


class FaceBackend(Protocol):
    def faces(self, rgb: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Face boxes as (top, right, bottom, left), like face_recognition."""

    def landmarks(self, rgb: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
        """(68, 2) landmarks in image coordinates."""

    def encoding(self, rgb: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
        """128-d identity encoding."""

    def parse(self, rgb: np.ndarray, box: tuple[int, int, int, int]) -> tuple[np.ndarray, np.ndarray]:
        """(mask, landmarks) in one shared frame: the parsing mask of a crop
        around the face and the face's landmarks translated into that crop."""


@dataclass(frozen=True)
class Thresholds:
    match_max_distance: float
    same_person_max_distance: float
    ear_open_min: float
    ear_closed_max: float
    ear_closed_ratio_max: float
    centre_max_yaw_deg: float
    turn_min_yaw_deg: float
    hat_min_share: float
    forehead_min_skin: float
    forehead_band: float
    frame_min_share: float

    @classmethod
    def from_settings(cls, s) -> "Thresholds":
        return cls(
            match_max_distance=s.face_match_max_distance,
            same_person_max_distance=s.face_same_person_max_distance,
            ear_open_min=s.face_ear_open_min,
            ear_closed_max=s.face_ear_closed_max,
            ear_closed_ratio_max=s.face_ear_closed_ratio_max,
            centre_max_yaw_deg=s.face_centre_max_yaw_deg,
            turn_min_yaw_deg=s.face_turn_min_yaw_deg,
            hat_min_share=s.face_hat_min_share,
            forehead_min_skin=s.face_forehead_min_skin,
            forehead_band=s.face_forehead_band,
            frame_min_share=s.face_frame_min_share,
        )


@dataclass
class LivenessResult:
    live: bool  # every liveness step passed (blink, turns, no hat, one person)
    reason: str | None = None  # first failure, None when everything passed
    step: str | None = None  # which frame the failure was found on
    matched: bool | None = None  # centre vs stored template; None if none given
    distance: float | None = None  # that comparison's dlib distance
    encoding: list[float] | None = None  # centre frame's template (enrolment)
    metrics: dict[str, float] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        """Live AND, when a template was given, the same person."""
        return self.live and self.matched is not False


def _fail(reason: str, step: str | None, metrics: dict[str, float]) -> LivenessResult:
    return LivenessResult(live=False, reason=reason, step=step, metrics=metrics)


def check_liveness(
    frames: dict[str, np.ndarray],
    backend: FaceBackend,
    t: Thresholds,
    *,
    stored_encoding: np.ndarray | None = None,
    mirrored: bool = False,
) -> LivenessResult:
    """Decide on one frame set. `frames` maps each of STEPS to an RGB image.

    `mirrored` says the phone flipped its frames left-right (a selfie
    preview). It only decides which image direction counts as the student's
    left; both turns are required either way, so a wrong flag cannot let a
    missing turn through.
    """
    metrics: dict[str, float] = {}
    boxes: dict[str, tuple[int, int, int, int]] = {}
    marks: dict[str, np.ndarray] = {}

    for step in STEPS:
        found = backend.faces(frames[step])
        if not found:
            return _fail(NO_FACE, step, metrics)
        if len(found) > 1:
            return _fail(MULTIPLE_FACES, step, metrics)
        boxes[step] = found[0]
        marks[step] = backend.landmarks(frames[step], found[0])

    def pose(step: str) -> float:
        h, w = frames[step].shape[:2]
        yaw, pitch = head_pose(marks[step], (w, h))
        metrics[f"yaw_{step.lower()}"] = round(yaw, 2)
        metrics[f"pitch_{step.lower()}"] = round(pitch, 2)
        return yaw

    # The centre frame carries the identity, so it must be a plain, frontal,
    # eyes-open, bare-headed face.
    mask, crop_marks = backend.parse(frames[CENTRE], boxes[CENTRE])
    cov = assess_covering(
        mask,
        crop_marks,
        hat_min_share=t.hat_min_share,
        forehead_min_skin=t.forehead_min_skin,
        forehead_band=t.forehead_band,
        frame_min_share=t.frame_min_share,
    )
    metrics["hat_share"] = round(cov.hat_share, 4)
    metrics["forehead_skin"] = round(cov.forehead_skin, 4)
    metrics["covering_frames_face"] = float(cov.frames_face)
    if cov.refused:
        return _fail(HAT, CENTRE, metrics)

    ear_open = mean_ear(marks[CENTRE])
    metrics["ear_centre"] = round(ear_open, 4)
    if ear_open < t.ear_open_min:
        return _fail(EYES_CLOSED, CENTRE, metrics)
    if abs(pose(CENTRE)) > t.centre_max_yaw_deg:
        return _fail(NOT_FACING, CENTRE, metrics)

    ear_closed = mean_ear(marks[BLINK])
    metrics["ear_blink"] = round(ear_closed, 4)
    if ear_closed > t.ear_closed_max or ear_closed > t.ear_closed_ratio_max * ear_open:
        return _fail(NO_BLINK, BLINK, metrics)

    # On an unmirrored front camera the student's left is the picture's right,
    # so turning to their left points the face at the image's right edge.
    left_sign = -1.0 if mirrored else 1.0
    if left_sign * pose(TURN_LEFT) < t.turn_min_yaw_deg:
        return _fail(TURN_LEFT_SHORT, TURN_LEFT, metrics)
    if -left_sign * pose(TURN_RIGHT) < t.turn_min_yaw_deg:
        return _fail(TURN_RIGHT_SHORT, TURN_RIGHT, metrics)

    # One person throughout: a swap between steps (a photo for the centre
    # frame, a live accomplice for the movements) fails here.
    centre_enc = np.asarray(backend.encoding(frames[CENTRE], boxes[CENTRE]), dtype=np.float64)
    for step in (BLINK, TURN_LEFT, TURN_RIGHT):
        enc = np.asarray(backend.encoding(frames[step], boxes[step]), dtype=np.float64)
        d = float(np.linalg.norm(enc - centre_enc))
        metrics[f"same_person_{step.lower()}"] = round(d, 4)
        if d > t.same_person_max_distance:
            return _fail(NOT_SAME_PERSON, step, metrics)

    result = LivenessResult(live=True, encoding=centre_enc.tolist(), metrics=metrics)
    if stored_encoding is not None:
        d = float(np.linalg.norm(np.asarray(stored_encoding, dtype=np.float64) - centre_enc))
        result.distance = round(d, 4)
        result.matched = d <= t.match_max_distance
        if not result.matched:
            result.reason, result.step = NO_MATCH, CENTRE
    return result
