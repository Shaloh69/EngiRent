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
        return STEPS[int(rgb[0, 0, 0]) // 40]

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


def frame(step: str) -> np.ndarray:
    f = np.zeros((480, 640, 3), dtype=np.uint8)
    f[0, 0, 0] = STEPS.index(step) * 40
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


def run(spec=None, mask=None, **kw):
    return check_liveness(FRAMES, FakeBackend(spec or good_spec(), mask), T, **kw)


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


@pytest.mark.parametrize("step", [CENTRE, BLINK])
def test_a_photo_or_screen_on_a_frontal_frame_is_refused(step):
    spec = good_spec()
    spec[step]["spoof"] = -1.5
    r = run(spec)
    assert (r.passed, r.reason, r.step) == (False, "SPOOF", step)


def test_the_spoof_margin_threshold_is_inclusive_at_zero():
    spec = good_spec()
    spec[CENTRE]["spoof"] = 0.0
    assert run(spec).passed
    spec[CENTRE]["spoof"] = -0.01
    assert run(spec).reason == "SPOOF"


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
    spec[CENTRE]["lm"] = face_landmarks(0, 0.22)
    spec[BLINK]["lm"] = face_landmarks(0, 0.18)  # <= 0.19, but 0.82 of open
    assert run(spec).reason == "NO_BLINK"


def test_a_turn_that_is_too_small_fails():
    spec = good_spec()
    spec[TURN_LEFT]["lm"] = face_landmarks(-10, 0.3)
    assert (run(spec).reason, run(spec).step) == ("TURN_LEFT_SHORT", TURN_LEFT)


def test_turning_the_wrong_way_fails():
    spec = good_spec()
    spec[TURN_LEFT]["lm"], spec[TURN_RIGHT]["lm"] = spec[TURN_RIGHT]["lm"], spec[TURN_LEFT]["lm"]
    assert run(spec).reason == "TURN_LEFT_SHORT"


def test_mirrored_frames_swap_which_image_direction_is_left():
    spec = good_spec()
    spec[TURN_LEFT]["lm"], spec[TURN_RIGHT]["lm"] = spec[TURN_RIGHT]["lm"], spec[TURN_LEFT]["lm"]
    assert run(spec, mirrored=True).passed
    assert run(mirrored=True).reason == "TURN_LEFT_SHORT"


@pytest.mark.parametrize("step", [BLINK, TURN_LEFT, TURN_RIGHT])
def test_a_different_person_on_any_step_fails(step):
    spec = good_spec()
    spec[step]["enc"] = SOMEONE_ELSE
    assert (run(spec).reason, run(spec).step) == ("NOT_SAME_PERSON", step)


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
