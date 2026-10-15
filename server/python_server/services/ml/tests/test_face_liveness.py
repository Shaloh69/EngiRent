"""
The liveness decision (app/face/liveness.py) and its route
(app/routers/face_liveness.py), with a fake face backend: synthetic
landmarks, encodings and parsing masks, no face image anywhere.

What the real models make of real faces is tests/test_face_real_backend.py.
"""

import io
import json

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.face import backend as backend_mod
from app.face.backend import FaceModelsUnavailable
from app.face.liveness import (
    BLINK,
    CENTRE,
    EXTRA_BLINKS,
    STEPS,
    TURN_LEFT,
    TURN_RIGHT,
    Thresholds,
    check_liveness,
)
from app.routers import face_liveness
from tests.face_synth import _bare, _hijab, _landmarks, face_landmarks

T = Thresholds.from_settings(settings)
ME = np.linspace(-0.2, 0.2, 128)
SOMEONE_ELSE = ME + 0.1  # distance ~1.13, far past both thresholds


class FakeBackend:
    """Each frame carries its step index in pixel [0, 0, 0]; the fake looks
    up what that step should 'contain' in `spec`."""

    def __init__(self, spec: dict, mask: np.ndarray | None = None):
        self.spec = spec
        self.mask = _bare() if mask is None else mask

    def _step(self, rgb):
        return ALL_KEYS[int(rgb[0, 0, 0]) // 30]

    def faces(self, rgb):
        return [(10, 110, 110, 10)] * self.spec[self._step(rgb)].get("faces", 1)

    def landmarks(self, rgb, box):
        return self.spec[self._step(rgb)]["lm"]

    def encoding(self, rgb, box):
        return self.spec[self._step(rgb)].get("enc", ME)

    def parse(self, rgb, box):
        return self.mask, _landmarks()

    def spoof_margin(self, rgb, landmarks):
        return self.spec[self._step(rgb)].get("spoof", 2.0)


ALL_KEYS = (*STEPS, *EXTRA_BLINKS)


def frame(step: str) -> np.ndarray:
    f = np.zeros((480, 640, 3), dtype=np.uint8)
    f[0, 0, 0] = ALL_KEYS.index(step) * 30
    return f


FRAMES = {s: frame(s) for s in STEPS}


def good_spec() -> dict:
    # Unmirrored front camera: the student's LEFT is the picture's right, i.e.
    # positive image yaw, which face_landmarks gives for a negative camera yaw.
    return {
        CENTRE: {"lm": face_landmarks(0, 0.30)},
        BLINK: {"lm": face_landmarks(0, 0.05)},
        TURN_LEFT: {"lm": face_landmarks(-30, 0.30)},
        TURN_RIGHT: {"lm": face_landmarks(30, 0.30)},
    }


def run(spec=None, mask=None, extras=(), **kw):
    frames = dict(FRAMES)
    for k in extras:
        frames[k] = frame(k)
    return check_liveness(frames, FakeBackend(spec or good_spec(), mask), T, **kw)


# ── the decision ───────────────────────────────────────────────────────────


def test_a_live_bare_headed_person_who_does_every_step_passes():
    r = run(stored_encoding=ME + 0.001)
    assert r.passed and r.live and r.matched is True and r.reason is None
    assert r.metrics["yaw_turn_left"] > 20 and r.metrics["yaw_turn_right"] < -20


def test_without_a_template_liveness_alone_decides_and_matched_is_unknown():
    r = run()
    assert r.passed and r.matched is None and r.distance is None
    assert r.encoding == pytest.approx(list(ME))


@pytest.mark.parametrize("step", STEPS)
def test_no_face_on_any_step_fails_on_that_step(step):
    spec = good_spec()
    spec[step]["faces"] = 0
    r = run(spec)
    assert (r.passed, r.reason, r.step) == (False, "NO_FACE", step)


def test_two_people_in_a_frame_fail():
    spec = good_spec()
    spec[TURN_RIGHT]["faces"] = 2
    assert (run(spec).reason, run(spec).step) == ("MULTIPLE_FACES", TURN_RIGHT)


def test_a_cap_is_refused():
    m = _bare()
    m[15:76, 40:160] = 18  # HAT over the forehead
    r = run(mask=m)
    assert (r.passed, r.reason) == (False, "HAT")


def test_a_face_framing_covering_with_the_forehead_visible_passes():
    assert run(mask=_hijab(_bare())).passed


def test_a_photo_or_screen_that_scores_low_on_every_facing_frame_is_refused():
    spec = good_spec()
    spec[CENTRE]["spoof"] = -3.0
    spec[BLINK]["spoof"] = -3.0
    r = run(spec)
    assert (r.passed, r.reason, r.step) == (False, "SPOOF", CENTRE)


def test_one_good_facing_frame_is_enough_because_single_real_frames_score_low_sometimes():
    # Measured on real phones: a real face scored -5.95 / -2.71 on single frames,
    # while every real attempt had one facing frame >= -0.22.
    spec = good_spec()
    spec[CENTRE]["spoof"] = -2.71
    spec[BLINK]["spoof"] = -4.14
    spec["BLINK2"] = {"lm": face_landmarks(0, 0.12), "spoof": -0.22}
    assert run(spec, extras=("BLINK2",)).passed


def test_the_spoof_margin_threshold_is_inclusive_at_the_configured_limit():
    assert T.spoof_min_margin == -1.0
    spec = good_spec()
    spec[CENTRE]["spoof"] = spec[BLINK]["spoof"] = -1.0
    assert run(spec).passed
    spec[CENTRE]["spoof"] = spec[BLINK]["spoof"] = -1.01
    assert run(spec).reason == "SPOOF"


def test_real_phone_faces_from_the_first_live_test_are_not_refused_as_spoofs():
    # Margins measured on two students' real attempts, 2026-10-15.
    for centre, blink in ((-1.6003, 3.9), (-0.8002, -0.42), (-2.7148, 0.66), (-1.0234, -0.22), (-0.96, 6.99)):
        spec = good_spec()
        spec[CENTRE]["spoof"], spec[BLINK]["spoof"] = centre, blink
        assert run(spec).passed, (centre, blink)


def test_turn_frames_are_not_spoof_checked_the_model_is_unreliable_there():
    spec = good_spec()
    spec[TURN_LEFT]["spoof"] = -3.0
    spec[TURN_RIGHT]["spoof"] = -3.0
    assert run(spec).passed


def test_eyes_closed_on_the_centre_frame_fail():
    spec = good_spec()
    spec[CENTRE]["lm"] = face_landmarks(0, 0.1)
    assert run(spec).reason == "EYES_CLOSED"


def test_a_centre_frame_that_does_not_face_the_camera_fails():
    spec = good_spec()
    spec[CENTRE]["lm"] = face_landmarks(-20, 0.3)
    assert run(spec).reason == "NOT_FACING"


def test_no_blink_fails():
    spec = good_spec()
    spec[BLINK]["lm"] = face_landmarks(0, 0.3)
    assert (run(spec).reason, run(spec).step) == ("NO_BLINK", BLINK)


def test_a_half_blink_fails_on_the_ratio_even_under_the_absolute_limit():
    spec = good_spec()
    spec[CENTRE]["lm"] = face_landmarks(0, 0.23)
    spec[BLINK]["lm"] = face_landmarks(0, 0.20)  # 0.87 of open: more than the 0.85 allowed
    assert run(spec).reason == "NO_BLINK"


def test_blink_frames_measured_on_real_students_pass_or_fail_as_they_should():
    # (open, blink) from the first live test: three real blinks, one eyes-open frame.
    # Judged by eye on 8 attempts. 0.217 -> 0.179 (0.825) was a real blink and must pass,
    # which is why the rule is relative to the person's own open eye, at 0.85.
    for open_ear, blink_ear, expect in (
        (0.2124, 0.1627, True), (0.2488, 0.1589, True), (0.2192, 0.1969, False), (0.303, 0.4285, False),
        (0.217, 0.179, True), (0.163, 0.098, True), (0.200, 0.101, True),
    ):
        spec = good_spec()
        spec[CENTRE]["lm"] = face_landmarks(0, open_ear)
        spec[BLINK]["lm"] = face_landmarks(0, blink_ear)
        assert (run(spec).reason != "NO_BLINK") is expect, (open_ear, blink_ear)


def test_a_missed_blink_frame_is_rescued_by_a_better_candidate():
    spec = good_spec()
    spec[BLINK]["lm"] = face_landmarks(0, 0.30)  # the required frame missed the closed moment
    spec["BLINK2"] = {"lm": face_landmarks(0, 0.05)}
    r = run(spec, extras=("BLINK2",))
    assert r.passed and r.metrics["blink_candidates"] == 2 and r.metrics["ear_blink"] < 0.1


def test_extra_candidates_that_are_no_help_change_nothing():
    spec = good_spec()
    spec[BLINK]["lm"] = face_landmarks(0, 0.30)
    spec["BLINK2"] = {"lm": face_landmarks(0, 0.29)}
    spec["BLINK3"] = {"lm": face_landmarks(0, 0.28)}
    assert run(spec, extras=("BLINK2", "BLINK3")).reason == "NO_BLINK"


def test_an_extra_candidate_with_no_face_or_two_faces_is_ignored_not_fatal():
    spec = good_spec()
    spec["BLINK2"] = {"lm": face_landmarks(0, 0.05), "faces": 0}
    spec["BLINK3"] = {"lm": face_landmarks(0, 0.05), "faces": 2}
    r = run(spec, extras=("BLINK2", "BLINK3"))
    assert r.passed and r.metrics["blink_candidates"] == 1


def test_the_closest_shut_candidate_is_the_one_checked_for_same_person():
    spec = good_spec()
    spec[BLINK]["lm"] = face_landmarks(0, 0.30)
    spec["BLINK2"] = {"lm": face_landmarks(0, 0.05), "enc": SOMEONE_ELSE}
    r = run(spec, extras=("BLINK2",))
    assert r.reason == "NOT_SAME_PERSON" and r.step == BLINK


def test_a_turn_that_is_too_small_fails():
    spec = good_spec()
    spec[TURN_LEFT]["lm"] = face_landmarks(-10, 0.3)
    assert (run(spec).reason, run(spec).step) == ("TURN_LEFT_SHORT", TURN_LEFT)


def test_turning_the_wrong_way_is_told_apart_from_not_turning_far_enough():
    spec = good_spec()
    spec[TURN_LEFT]["lm"], spec[TURN_RIGHT]["lm"] = spec[TURN_RIGHT]["lm"], spec[TURN_LEFT]["lm"]
    assert run(spec).reason == "TURN_LEFT_WRONG"
    spec = good_spec()
    spec[TURN_LEFT]["lm"] = face_landmarks(-8)  # barely turned the right way
    assert run(spec).reason == "TURN_LEFT_SHORT"
    spec = good_spec()
    spec[TURN_RIGHT]["lm"] = face_landmarks(-30)  # turned LEFT when asked for right
    assert run(spec).reason == "TURN_RIGHT_WRONG"


def test_mirrored_frames_swap_which_image_direction_is_left():
    spec = good_spec()
    spec[TURN_LEFT]["lm"], spec[TURN_RIGHT]["lm"] = spec[TURN_RIGHT]["lm"], spec[TURN_LEFT]["lm"]
    assert run(spec, mirrored=True).passed
    assert run(mirrored=True).reason == "TURN_LEFT_WRONG"


def test_the_turn_decision_ignores_the_head_pose_solver_which_flips_at_large_turns():
    # Real frame from the first live test: the face plainly pointed at the picture's
    # right (a left turn) and solvePnP said -60 degrees. The ratio does not flip.
    from app.face import liveness as L

    spec = good_spec()
    original = L.head_pose
    L.head_pose = lambda lm, size: (-60.0, 0.0)
    try:
        assert run(spec).passed
    finally:
        L.head_pose = original


def test_ratios_measured_on_real_phone_frames_decide_as_they_should():
    # The weakest real left turn measured +0.34 and the strongest facing frame 0.12.
    assert T.turn_min_yaw_ratio == 0.28 and T.centre_max_yaw_ratio == 0.20
    import numpy as np

    from app.face.geometry import yaw_ratio

    def lm_with_ratio(r):
        lm = np.zeros((68, 2))
        lm[36] = (100, 100)
        lm[45] = (200, 100)
        lm[30] = (150 + 50 * r, 120)  # nose position between the eye corners
        return lm

    for r in (0.34, 0.42, 0.75, 1.13):
        assert yaw_ratio(lm_with_ratio(r)) == pytest.approx(r, abs=1e-9)
    assert yaw_ratio(lm_with_ratio(0.0)) == 0.0


def test_a_different_person_on_the_blink_frame_fails():
    spec = good_spec()
    spec[BLINK]["enc"] = SOMEONE_ELSE
    assert (run(spec).reason, run(spec).step) == ("NOT_SAME_PERSON", BLINK)


@pytest.mark.parametrize("step", [TURN_LEFT, TURN_RIGHT])
def test_turned_frames_are_not_identity_checked(step):
    # A turned head drifts from the frontal template and would refuse the real
    # student; each encoding also costs ~0.3 s.
    spec = good_spec()
    spec[step]["enc"] = SOMEONE_ELSE
    assert run(spec).passed


def test_a_live_stranger_is_live_but_does_not_pass():
    r = run(stored_encoding=SOMEONE_ELSE)
    assert r.live and r.matched is False and not r.passed and r.reason == "NO_MATCH"


def test_the_match_threshold_is_the_one_photo_checks_0_5():
    assert T.match_max_distance == 0.5
    edge = ME.copy()
    edge[0] += 0.49
    assert run(stored_encoding=edge).matched is True
    edge[0] += 0.02
    assert run(stored_encoding=edge).matched is False


# ── the route ──────────────────────────────────────────────────────────────


def _png(step: str) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(frame(step)).save(buf, format="PNG")
    return buf.getvalue()


FILES = {"centre": CENTRE, "blink": BLINK, "turn_left": TURN_LEFT, "turn_right": TURN_RIGHT}


def _files(skip: str | None = None, empty: str | None = None):
    return {
        k: (f"{k}.png", b"" if k == empty else _png(step), "image/png")
        for k, step in FILES.items()
        if k != skip
    }


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(face_liveness.router, prefix="/api/v1")
    monkeypatch.setattr(face_liveness, "load_backend", lambda *_p: FakeBackend(good_spec()))
    monkeypatch.setattr(settings, "api_key", "")
    return TestClient(app)


URL = "/api/v1/face/liveness-verify"


def test_route_happy_path_and_encoding_only_on_request(client):
    r = client.post(URL, files=_files(), data={"stored_encoding": json.dumps((ME + 0.001).tolist())})
    body = r.json()
    assert r.status_code == 200 and body["passed"] and body["matched"] and body["encoding"] is None
    r = client.post(URL, files=_files(), data={"return_encoding": "true"})
    assert r.json()["encoding"] == pytest.approx(list(ME))


def test_route_a_failed_check_is_a_200_with_a_reason_not_an_error(client, monkeypatch):
    spec = good_spec()
    spec[BLINK]["lm"] = face_landmarks(0, 0.3)
    monkeypatch.setattr(face_liveness, "load_backend", lambda *_p: FakeBackend(spec))
    body = client.post(URL, files=_files(), data={"return_encoding": "true"}).json()
    assert (body["passed"], body["live"], body["reason"], body["encoding"]) == (False, False, "NO_BLINK", None)


@pytest.mark.parametrize("bad", ["[1, 2, 3]", "not json", json.dumps({"a": 1})])
def test_route_refuses_a_malformed_template_instead_of_skipping_the_match(client, bad):
    assert client.post(URL, files=_files(), data={"stored_encoding": bad}).status_code == 400


def test_route_refuses_an_empty_frame(client):
    assert client.post(URL, files=_files(empty="blink")).status_code == 400


def test_route_refuses_a_missing_frame(client):
    assert client.post(URL, files=_files(skip="turn_right")).status_code == 422


def test_route_requires_the_api_key_when_one_is_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "k")
    assert client.post(URL, files=_files()).status_code == 401
    assert client.post(URL, files=_files(), headers={"X-API-Key": "k"}).status_code == 200


def test_route_fails_closed_with_503_when_models_are_missing(client, monkeypatch):
    def unavailable(*_p):
        raise FaceModelsUnavailable("no weights")

    monkeypatch.setattr(face_liveness, "load_backend", unavailable)
    assert client.post(URL, files=_files()).status_code == 503


@pytest.mark.parametrize("which", ["parsing", "antispoof"])
def test_real_loader_fails_closed_when_either_weights_file_is_missing(monkeypatch, which):
    monkeypatch.setattr(backend_mod, "_backend", None)
    parsing, spoof = face_liveness._model_paths()
    paths = ("does/not/exist.onnx", spoof) if which == "parsing" else (parsing, "does/not/exist.onnx")
    with pytest.raises(FaceModelsUnavailable):
        backend_mod.load_backend(*paths)
    assert backend_mod._backend is None


# ── opt-in test capture ────────────────────────────────────────────────────


def test_nothing_is_kept_unless_the_flag_file_exists(client, tmp_path, monkeypatch):
    monkeypatch.setattr(face_liveness, "_DEBUG_FLAG", str(tmp_path / "face_debug.on"))
    monkeypatch.setattr(face_liveness, "_DEBUG_DIR", str(tmp_path / "face_debug"))
    assert client.post(URL, files=_files()).status_code == 200
    assert not (tmp_path / "face_debug").exists()


def test_with_the_flag_the_frames_and_verdict_are_kept_and_old_ones_purged(client, tmp_path, monkeypatch):
    import os
    import time

    flag, folder = tmp_path / "face_debug.on", tmp_path / "face_debug"
    monkeypatch.setattr(face_liveness, "_DEBUG_FLAG", str(flag))
    monkeypatch.setattr(face_liveness, "_DEBUG_DIR", str(folder))
    flag.write_text("")
    old = folder / "000000-OLD"
    old.mkdir(parents=True)
    (old / "centre.jpg").write_bytes(b"x")
    os.utime(old, (time.time() - 90000, time.time() - 90000))

    assert client.post(URL, files=_files()).status_code == 200

    kept = sorted(p.name for p in folder.iterdir())
    assert len(kept) == 1 and kept[0].endswith("-PASS"), kept  # the 25 h old one is gone
    files = sorted(p.name for p in (folder / kept[0]).iterdir())
    assert files == ["blink.jpg", "centre.jpg", "turn_left.jpg", "turn_right.jpg", "verdict.json"]


def test_a_capture_failure_never_breaks_the_attempt(client, tmp_path, monkeypatch):
    flag = tmp_path / "face_debug.on"
    flag.write_text("")
    monkeypatch.setattr(face_liveness, "_DEBUG_FLAG", str(flag))
    monkeypatch.setattr(face_liveness, "_DEBUG_DIR", str(tmp_path / "not" / "a" / "dir\0bad"))
    assert client.post(URL, files=_files()).status_code == 200


def test_the_phones_mirrored_claim_is_ignored_because_frames_are_never_mirrored(client):
    # 1.15.2 still sends mirrored=true; the real frames are unmirrored, so a left turn
    # (face toward the picture's right) must pass whatever the phone claims.
    for claim in ("true", "false"):
        body = client.post(URL, files=_files(), data={"mirrored": claim}).json()
        assert body["passed"] and body["live"], claim


def test_a_right_turn_that_is_too_small_fails_just_like_a_left_one():
    spec = good_spec()
    spec[TURN_RIGHT]["lm"] = face_landmarks(8)  # barely turned the right way (ratio about -0.1)
    r = run(spec)
    assert (r.reason, r.step) == ("TURN_RIGHT_SHORT", TURN_RIGHT)
