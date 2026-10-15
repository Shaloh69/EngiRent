"""
app/face/covering.py on hand-drawn parsing masks (no model, no face image).

The masks are crude on purpose: each one isolates the single property the
rule is meant to look at. Whether the real BiSeNet labels a real cap or hijab
this way is a separate question, answered by the fixture run in
tests/test_face_real_backend.py, not here.
"""

import numpy as np
import pytest

from app.face.covering import EYE_G, HAT, assess_covering
from tests.face_synth import _bare, _hijab, _landmarks

KW = dict(hat_min_share=0.08, forehead_min_skin=0.6, forehead_band=0.25, frame_min_share=0.01)


def _assess(m):
    return assess_covering(m, _landmarks(), **KW)


def test_bare_head_passes():
    r = _assess(_bare())
    assert not r.refused and r.hat_share == 0.0


def test_cap_over_the_forehead_is_refused():
    m = _bare()
    m[15:76, 40:160] = HAT
    r = _assess(m)
    assert r.refused and r.forehead_skin < 0.5


def test_a_hat_label_on_hair_with_the_forehead_fully_visible_is_not_a_hat():
    # The first live test: dark curly hair and a hand on the head were labelled
    # `hat` (share 0.24) on two bare-headed faces whose forehead skin was 0.93-0.98.
    m = _bare()
    m[5:50, 40:160] = HAT
    r = _assess(m)
    assert r.hat_share >= 0.08 and r.forehead_skin >= 0.9 and not r.refused


def test_face_framing_covering_with_the_forehead_visible_passes():
    r = _assess(_hijab(_bare()))
    assert r.hat_share >= 0.04 and r.frames_face and r.forehead_skin >= 0.5
    assert not r.refused


def test_hood_pulled_over_the_forehead_is_refused():
    m = _hijab(_bare())
    m[5:72, 20:180] = HAT
    r = _assess(m)
    assert r.frames_face and r.forehead_skin < 0.5 and r.refused


@pytest.mark.parametrize("covering", [None, "hijab"])
def test_glasses_are_ignored(covering):
    m = _bare() if covering is None else _hijab(_bare())
    m[88:102, 60:140] = EYE_G
    assert not _assess(m).refused


def test_a_covering_over_the_forehead_is_refused_even_with_stray_pixels_elsewhere():
    m = _bare()
    m[5:70, 40:160] = HAT  # down over the forehead
    m[120, 30] = HAT
    r = _assess(m)
    assert r.forehead_skin < 0.6 and r.refused


def test_forehead_values_measured_on_real_caps_are_refused_and_real_bare_heads_pass():
    # Forehead skin: 5 real caps measured 0.29 0.36 0.41 0.47 0.29 (all refused); the two
    # false refusals of the first live test measured 0.93 and 0.98 (pass).
    for fh, refused in ((0.29, True), (0.36, True), (0.41, True), (0.47, True), (0.93, False), (0.98, False)):
        assert (fh < KW["forehead_min_skin"]) is refused, fh
