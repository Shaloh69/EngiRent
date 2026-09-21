"""
D-89 — cutting the item out of its background before anything compares it.

The second physical test put a correct glue gun in the locker and scored ~53
because SSIM, pHash and the deep model compared the raw photos, so they mostly
measured how unlike the owner's bedsheet the white locker looked. `isolate_item`
paints everything but the item a flat white and crops to it, so every stage then
compares item against item.

Synthetic images on purpose: a saturated red block on a dark-grey field is
strongly separable, so the assertions are about the CONTRACT (background gone,
cropped, fallback when unusable), not about GrabCut's fine behaviour on a real
photograph — that is measured separately, on the real captures, in PROGRESS.md.
"""

import numpy as np
import pytest

from app.utils.background import isolate_item

WHITE = np.array([255, 255, 255], dtype=np.uint8)


def _scene(bg=(60, 60, 60), item=(0, 0, 255), size=400, block=140):
    img = np.full((size, size, 3), bg, dtype=np.uint8)
    lo = (size - block) // 2
    img[lo : lo + block, lo : lo + block] = item  # BGR red block, dead centre
    return img


def test_crops_to_the_item():
    out = isolate_item(_scene())
    assert out.shape[0] < 400 and out.shape[1] < 400
    # the block is 140px; with 12px padding either side the crop is ~164px
    assert 140 <= out.shape[0] <= 200
    assert 140 <= out.shape[1] <= 200


def test_background_is_painted_flat_white():
    out = isolate_item(_scene())
    # The corner of the crop lies in the padding ring, outside the item mask —
    # so it must be the flat fill, not the dark-grey field it came from.
    assert (out[0, 0] == WHITE).all()
    assert (out[0, -1] == WHITE).all()


def test_the_item_itself_survives_untouched():
    out = isolate_item(_scene())
    h, w = out.shape[:2]
    centre = out[h // 2, w // 2]
    assert tuple(centre) == (0, 0, 255)  # still saturated red, not whitened


def test_two_different_backdrops_converge_after_isolation():
    """The whole point. The same item on a dark field and on a light one is two
    very different photographs; after isolation both must look alike, which is
    what lets every downstream stage compare the item rather than the room."""
    dark = isolate_item(_scene(bg=(40, 40, 40)))
    light = isolate_item(_scene(bg=(225, 215, 200)))
    hh, ww = min(dark.shape[0], light.shape[0]), min(dark.shape[1], light.shape[1])
    diff = np.abs(dark[:hh, :ww].astype(int) - light[:hh, :ww].astype(int)).mean()
    assert diff < 25  # raw-vs-raw would differ by ~150 across most of the frame


def test_an_image_with_no_findable_item_is_returned_unchanged():
    """A bad cut-out is worse than none: it would compare a fragment of one item
    against the whole of another. A uniform image has nothing to segment."""
    flat = np.full((300, 300, 3), 128, dtype=np.uint8)
    out = isolate_item(flat)
    assert out.shape == flat.shape
    assert (out == flat).all()


def test_output_is_a_valid_bgr_image():
    out = isolate_item(_scene())
    assert out.ndim == 3 and out.shape[2] == 3
    assert out.dtype == np.uint8


@pytest.mark.parametrize("bg", [(60, 60, 60), (230, 230, 230), (30, 90, 30)])
def test_never_returns_an_empty_image(bg):
    out = isolate_item(_scene(bg=bg))
    assert out.size > 0
