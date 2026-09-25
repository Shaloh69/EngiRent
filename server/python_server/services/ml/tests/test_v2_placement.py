"""
ML phase (2026-09-25): stage 1a (floor-model localisation) + stage P (placement)
on SYNTHETIC locker frames, plus the fusion map's contract.

Synthetic on purpose: the real captures are not in the repo (it is public).
The real-frame numbers live in PROGRESS.md ("ML run log"); these tests pin the
behaviour so a later edit cannot silently break a verdict.

A frame here is 1280x720 like the kiosk's: a near-white floor with a gentle
lighting gradient, red trim down the left, and dark "items" drawn on it.
"""

import cv2
import numpy as np
import pytest

from app.v2 import fusion
from app.v2.localise import localise_kiosk
from app.v2.placement import judge_placement


def floor_frame() -> np.ndarray:
    h, w = 720, 1280
    yy, xx = np.mgrid[0:h, 0:w]
    grad = (200 - 30 * (xx / w) - 20 * (yy / h)).astype(np.uint8)  # LED off-centre
    img = np.dstack([grad, grad, grad + 5]).clip(0, 255).astype(np.uint8)
    img[:, :130] = (40, 30, 150)  # red trim (BGR)
    return img


def add_item(img, x, y, w, h, colour=(20, 20, 20)):
    cv2.rectangle(img, (x, y), (x + w, y + h), colour, -1)
    cv2.rectangle(img, (x + 10, y + h // 3), (x + w - 10, y + h // 2), (0, 200, 230), -1)  # yellow grip
    return img


def verdict(img):
    return judge_placement(localise_kiosk(img))


def test_empty_bay_is_empty():
    assert verdict(floor_frame())["verdict"] == "EMPTY"


def test_centred_item_is_ok_and_found_where_it_is():
    p = verdict(add_item(floor_frame(), 600, 250, 120, 260))
    assert p["verdict"] == "OK"
    x, y, w, h = p["bbox_norm"]
    assert abs((x + w / 2) - 660 / 1280) < 0.03 and abs((y + h / 2) - 380 / 720) < 0.03


def test_item_running_off_the_top_is_truncated():
    p = verdict(add_item(floor_frame(), 600, 0, 140, 300))
    assert p["verdict"] == "TRUNCATED"
    assert "top" in p["edges"]
    assert p["message"]


def test_item_at_the_far_side_is_off_center():
    p = verdict(add_item(floor_frame(), 1080, 280, 100, 140))
    assert p["verdict"] == "OFF_CENTER"


def test_two_separate_objects_are_multiple():
    img = add_item(floor_frame(), 350, 250, 120, 240)
    img = add_item(img, 850, 250, 120, 240)
    assert verdict(img)["verdict"] == "MULTIPLE"


def test_soft_shadow_alone_is_not_an_item():
    img = floor_frame()
    shadow = img.copy()
    cv2.ellipse(shadow, (700, 400), (160, 90), 0, 0, 360, (170, 170, 175), -1)
    img = cv2.addWeighted(img, 0.5, cv2.GaussianBlur(shadow, (61, 61), 0), 0.5, 0)
    assert verdict(img)["verdict"] == "EMPTY"


@pytest.mark.parametrize("tier", ["fast"])
def test_fusion_is_monotonic_and_bounded(tier):
    lo, _ = fusion.score(tier, {"dino_max": 0.2, "sem_bc": 0.2})
    mid, _ = fusion.score(tier, {"dino_max": 0.55, "sem_bc": 0.7})
    hi, _ = fusion.score(tier, {"dino_max": 0.9, "sem_bc": 0.95})
    assert 5.0 <= lo < mid < hi <= 95.0


def test_fusion_falls_back_when_a_stage_is_missing():
    # The semantic stage was skipped for time: scored by the model that never used it.
    s, used = fusion.score("fast", {"dino_max": 0.85})
    assert used == fusion.FALLBACK and 5.0 <= s <= 95.0
