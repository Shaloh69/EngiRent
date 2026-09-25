"""
Turn a localised item into the crops every later stage compares.

Both sides end up the same way: the item's own pixels, white-balanced against
their own background, on the same neutral grey, padded square. That removes the
two biggest differences between a listing photo and a locker photo that are NOT
the item: the background (a bedsheet vs a white floor) and the light's colour
(a warm room vs the locker LED).
"""

from __future__ import annotations

import cv2
import numpy as np

NEUTRAL = 127
PAD = 0.08


def white_balance(img: np.ndarray, bg_mask: np.ndarray) -> np.ndarray:
    """Scale channels so the background's median reads neutral grey.

    The locker floor is white and the typical listing backdrop (a sheet, a
    table) is near-white, so the background is the one thing in each photo
    known to be colourless. Gains are clamped: a genuinely coloured backdrop
    must not recolour the item.
    """
    px = img[bg_mask > 0]
    if px.shape[0] < 500:
        return img
    med = np.median(px, axis=0).astype(np.float32) + 1.0
    gains = np.clip(med.mean() / med, 0.75, 1.35)
    return np.clip(img.astype(np.float32) * gains, 0, 255).astype(np.uint8)


def make_crop(img_bgr: np.ndarray, mask: np.ndarray, bg_mask: np.ndarray | None = None) -> dict | None:
    """mask: uint8 0/255 at img's size. Returns RGB crop on neutral grey + its mask."""
    ys, xs = np.nonzero(mask)
    if xs.size < 50:
        return None
    if bg_mask is None:
        bg_mask = cv2.bitwise_not(cv2.dilate(mask, np.ones((15, 15), np.uint8)))
    img = white_balance(img_bgr, bg_mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * PAD))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    canvas = np.full((side, side, 3), NEUTRAL, np.uint8)
    cmask = np.zeros((side, side), np.uint8)
    sx0, sy0 = cx - side // 2, cy - side // 2
    ix0, iy0 = max(0, sx0), max(0, sy0)
    ix1, iy1 = min(img.shape[1], sx0 + side), min(img.shape[0], sy0 + side)
    sub = img[iy0:iy1, ix0:ix1]
    subm = mask[iy0:iy1, ix0:ix1]
    # Soft edge so the cut-out line itself is not a feature.
    alpha = cv2.GaussianBlur(subm, (5, 5), 0).astype(np.float32)[..., None] / 255.0
    region = canvas[iy0 - sy0: iy1 - sy0, ix0 - sx0: ix1 - sx0]
    region[:] = (sub * alpha + region * (1 - alpha)).astype(np.uint8)
    cmask[iy0 - sy0: iy1 - sy0, ix0 - sx0: ix1 - sx0] = subm
    crop = cv2.resize(canvas, (336, 336), interpolation=cv2.INTER_AREA)
    cmask = cv2.resize(cmask, (336, 336), interpolation=cv2.INTER_NEAREST)
    return {"rgb": cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), "mask": cmask}


def rotations(rgb: np.ndarray, flips: bool = True) -> list[np.ndarray]:
    """Test-time augmentation: items lie at any angle in the bay."""
    out = [rgb, np.rot90(rgb, 1), np.rot90(rgb, 2), np.rot90(rgb, 3)]
    if flips:
        f = rgb[:, ::-1]
        out += [f, np.rot90(f, 1), np.rot90(f, 2), np.rot90(f, 3)]
    return [np.ascontiguousarray(o) for o in out]


def colour_hist(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Hue-saturation histogram of the item's own pixels (dark pixels binned apart)."""
    hsv = cv2.cvtColor(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), cv2.COLOR_BGR2HSV)
    m = mask > 0
    h, s, v = hsv[..., 0][m], hsv[..., 1][m], hsv[..., 2][m]
    dark = v < 60
    grey = (~dark) & (s < 50)
    col = (~dark) & (~grey)
    hh, _ = np.histogram(h[col], bins=18, range=(0, 180))
    vv, _ = np.histogram(v[grey], bins=4, range=(0, 256))
    vec = np.concatenate([hh, vv, [dark.sum()]]).astype(np.float32)
    return vec / max(1.0, vec.sum())
