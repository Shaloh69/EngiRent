"""
The REAL face backend (dlib + BiSeNet ONNX) through the real route.

Part 1 needs no face: it proves the models load and that a frame with no face
fails with a reason rather than an error.

Part 2 runs every fixture case found under tests/fixtures/faces/, which is
GITIGNORED: real faces are biometric data and this repository is public. A
case is a folder:

    tests/fixtures/faces/<case>/
        centre.jpg  blink.jpg  turn_left.jpg  turn_right.jpg
        expect.txt     line 1: PASS, or the reason code expected (HAT, NO_BLINK, ...)
                       optional line 2: mirrored
        enrolled.jpg   optional: a separate photo of the same person; its
                       encoding is sent as stored_encoding and must match

Run with `-s` to print each case's measured EAR / yaw / covering numbers,
which is what the thresholds in config.py get tuned from. Skips cleanly when
the weights or the fixtures are absent.
"""

import io
import json
import os
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.face.backend import FaceModelsUnavailable, decode_frame, load_backend
from app.routers import face_liveness

FIXTURES = Path(__file__).parent / "fixtures" / "faces"
FRAMES = ("centre", "blink", "turn_left", "turn_right")

try:
    BACKEND = load_backend(face_liveness._model_path())
except FaceModelsUnavailable as e:  # pragma: no cover - environment dependent
    pytest.skip(f"face models unavailable: {e}", allow_module_level=True)


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(face_liveness.router, prefix="/api/v1")
    monkeypatch.setattr(settings, "api_key", "")
    return TestClient(app)


def _jpeg(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_a_frame_with_no_face_fails_with_a_reason_not_an_error(client):
    grey = _jpeg(np.full((480, 640, 3), 128, dtype=np.uint8))
    files = {k: (f"{k}.jpg", grey, "image/jpeg") for k in FRAMES}
    r = client.post("/api/v1/face/liveness-verify", files=files)
    assert r.status_code == 200
    assert (r.json()["passed"], r.json()["reason"], r.json()["step"]) == (False, "NO_FACE", "CENTRE")


def test_the_parsing_model_returns_a_crop_sized_mask_of_known_labels():
    rgb = np.random.default_rng(0).integers(0, 255, (480, 640, 3), dtype=np.uint8)
    mask, lm = BACKEND.parse(rgb, (150, 380, 330, 260))
    assert mask.ndim == 2 and mask.max() <= 18 and lm.shape == (68, 2)


def _cases():
    if not FIXTURES.is_dir():
        return []
    return sorted(p for p in FIXTURES.iterdir() if p.is_dir() and (p / "expect.txt").is_file())


@pytest.mark.parametrize("case", _cases(), ids=lambda p: p.name)
def test_fixture_case(client, case):
    lines = (case / "expect.txt").read_text(encoding="utf-8").split()
    expect, mirrored = lines[0].strip(), "mirrored" in lines[1:]
    files = {k: (f"{k}.jpg", (case / f"{k}.jpg").read_bytes(), "image/jpeg") for k in FRAMES}
    data = {"mirrored": str(mirrored).lower()}
    if (case / "enrolled.jpg").is_file():
        rgb = decode_frame((case / "enrolled.jpg").read_bytes(), settings.face_max_image_side)
        boxes = BACKEND.faces(rgb)
        assert len(boxes) == 1, "enrolled.jpg must show exactly one face"
        data["stored_encoding"] = json.dumps(BACKEND.encoding(rgb, boxes[0]).tolist())
    body = client.post("/api/v1/face/liveness-verify", files=files, data=data).json()
    print(f"\n[{case.name}] expect={expect} got passed={body['passed']} reason={body['reason']} "
          f"step={body['step']} distance={body['distance']} metrics={body['metrics']}")
    if expect == "PASS":
        assert body["passed"], body
    else:
        assert body["reason"] == expect, body


def test_fixtures_are_not_tracked_by_git():
    """The whole point of the folder: nothing in it may ever be committed."""
    if not _cases():
        pytest.skip("no fixtures present")
    import subprocess

    probe = str(_cases()[0] / "centre.jpg")
    r = subprocess.run(["git", "check-ignore", "-q", probe], cwd=os.path.dirname(__file__))
    assert r.returncode == 0, f"{probe} is NOT gitignored"
