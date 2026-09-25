"""
Stage 1b: cut the item out of an owner's listing photo.

Listing photos are taken anywhere (a bedsheet, a table, in a hand), so the
kiosk's floor model does not apply. A learned salient-object segmenter does:
rembg's ISNet ("isnet-general-use", ~170 MB ONNX, CPU). A listing photo is
cut once and cached by content hash (see cache.py), so its cost is paid when
the listing is first checked, not on every deposit.
"""

from __future__ import annotations

import cv2
import numpy as np

_SESSION = None
MODEL = "isnet-general-use"
WORK_MAX = 1024


def _session():
    global _SESSION
    if _SESSION is None:
        from rembg import new_session

        _SESSION = new_session(MODEL)
    return _SESSION


def cut_listing(img_bgr: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int] | None]:
    """Return (mask uint8 0/255 at the input's size, bbox x,y,w,h or None)."""
    from PIL import Image
    from rembg import remove

    h, w = img_bgr.shape[:2]
    s = min(1.0, WORK_MAX / max(h, w))
    small = cv2.resize(img_bgr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img_bgr
    pil = Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
    m = np.array(remove(pil, session=_session(), only_mask=True))
    if s < 1:
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)
    mask = (m > 127).astype(np.uint8) * 255
    # Keep the largest object and anything comparably large (a tool with a
    # detached part); drop specks.
    n, cc, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return mask, None
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = [i + 1 for i, a in enumerate(areas) if a >= 0.15 * areas.max()]
    mask = np.isin(cc, keep).astype(np.uint8) * 255
    ys, xs = np.nonzero(mask)
    return mask, (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
