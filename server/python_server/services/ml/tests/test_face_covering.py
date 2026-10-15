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

KW = dict(hat_min_share=0.04, forehead_min_skin=0.5, forehead_band=0.25, frame_min_share=0.01)


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


def test_cap_worn_high_is_still_refused_because_it_does_not_frame_the_face():
    m = _bare()
    m[5:50, 40:160] = HAT  # forehead fully visible, nothing below the ears
    r = _assess(m)
    assert r.forehead_skin >= 0.5 and not r.frames_face and r.refused


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


def test_a_few_stray_pixels_below_the_eyes_do_not_count_as_framing():
    m = _bare()
    m[5:58, 40:160] = HAT
    m[120, 30] = HAT
    m[120, 170] = HAT
    r = _assess(m)
    assert not r.frames_face and r.refused
