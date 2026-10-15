"""
app/face/geometry.py on synthetic landmarks: no face image, no model.

Head pose is checked by projecting the same generic head the solver uses at a
KNOWN rotation and asking the solver to recover it, plus a direct check of
what the sign means on the picture (the nose moves towards the side the face
points at), so the convention cannot silently invert.
"""

import numpy as np
import pytest

from app.face.geometry import eye_aspect_ratio, head_pose, mean_ear
from tests.face_synth import H, W, _eye, _landmarks_at


def test_ear_open_eye_is_high_and_closed_is_low():
    assert eye_aspect_ratio(_eye(100, 100, 40, 0.6)) == pytest.approx(0.6, abs=1e-6)
    assert eye_aspect_ratio(_eye(100, 100, 40, 0.05)) == pytest.approx(0.05, abs=1e-6)


def test_ear_is_scale_free():
    assert eye_aspect_ratio(_eye(100, 100, 20, 0.3)) == pytest.approx(
        eye_aspect_ratio(_eye(400, 300, 90, 0.3))
    )


def test_ear_degenerate_eye_is_zero_not_a_crash():
    assert eye_aspect_ratio(np.zeros((6, 2))) == 0.0


def test_mean_ear_averages_both_eyes():
    lm = np.zeros((68, 2))
    lm[36:42] = _eye(200, 200, 40, 0.3)
    lm[42:48] = _eye(300, 200, 40, 0.1)
    assert mean_ear(lm) == pytest.approx(0.2)


def test_frontal_face_has_near_zero_yaw_and_pitch():
    yaw, pitch = head_pose(_landmarks_at(0.0), (W, H))
    assert abs(yaw) < 1.0 and abs(pitch) < 1.0


@pytest.mark.parametrize("deg", [-35.0, -20.0, 20.0, 35.0])
def test_yaw_magnitude_is_recovered(deg):
    yaw, _ = head_pose(_landmarks_at(deg), (W, H))
    assert abs(yaw) == pytest.approx(abs(deg), abs=2.0)


@pytest.mark.parametrize("deg", [-30.0, 30.0])
def test_positive_yaw_means_the_face_points_at_the_image_right(deg):
    lm = _landmarks_at(deg)
    yaw, _ = head_pose(lm, (W, H))
    eyes_mid_x = (lm[36, 0] + lm[45, 0]) / 2.0
    nose_towards_right = lm[30, 0] > eyes_mid_x
    assert (yaw > 0) == nose_towards_right


def test_pitch_does_not_leak_into_yaw():
    yaw, pitch = head_pose(_landmarks_at(0.0, pitch_cam_deg=15.0), (W, H))
    assert abs(yaw) < 2.0 and abs(pitch) == pytest.approx(15.0, abs=2.0)
