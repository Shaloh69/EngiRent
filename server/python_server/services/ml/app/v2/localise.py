"""
Stage 1a: find the item on a kiosk locker floor.

The locker camera is fixed and looks down at a flat, near-white floor, so the
item is whatever is NOT floor. The floor is modelled from the frame itself: a
smooth low-order surface fitted to the floor's own pixels in Lab, with the
item pixels iteratively excluded from the fit. That removes the lighting
gradient (the LED is off-centre) without needing a stored empty-bay frame.

Why not a stored empty-bay reference (the handoff's first proposal)? There is
no lit one: the only empty captures on record (2026-09-24, before ~21:07) are
at mean brightness 86 and 28 against ~135 for every item capture, and bay 2 has
none at all. A reference can be added later as an extra cue; the self-modelled
floor works on the first capture of a bay ever taken.

Everything here runs on a 480-px-wide copy of the frame; masks and boxes are
returned in that working resolution plus the scale back to the original.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

WORK_W = 480


@dataclass
class Localisation:
    """What stage 1a found in one kiosk frame."""

    mask: np.ndarray  # uint8 0/255 item mask, working resolution
    floor: np.ndarray  # uint8 0/255 floor region (hull), working resolution
    bbox: tuple[int, int, int, int] | None  # x, y, w, h of the item (working res)
    area_frac: float  # item area / floor area
    components: list[dict] = field(default_factory=list)  # significant blobs
    scale: float = 1.0  # original / working
    frame_small: np.ndarray | None = None  # the BGR working copy


def _resize(img: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    s = WORK_W / w
    return cv2.resize(img, (WORK_W, int(round(h * s))), interpolation=cv2.INTER_AREA), 1.0 / s


def _floor_region(lab: np.ndarray) -> np.ndarray:
    """The locker floor: the biggest region close to the floor's own colour, as a hull.

    "Close to the floor's colour" rather than "unsaturated": the white balance
    drifts between captures (bay 1 at 22:41 reads mean HSV saturation ~52 on
    the bare floor), and the far end of the floor is much darker than the
    middle. The floor colour is taken from the brighter half of the frame.

    The hull (not the raw region) is what lets an item that runs off the top
    edge still count as "on the floor": it is a notch in the region, not a hole.
    """
    L = lab[..., 0]
    top = L > np.percentile(L, 50)
    Lf = float(np.median(L[top]))
    af, bf = float(np.median(lab[..., 1][top])), float(np.median(lab[..., 2][top]))
    chroma = np.hypot(lab[..., 1] - af, lab[..., 2] - bf)
    cand = ((L > 0.45 * Lf) & (chroma < 20)).astype(np.uint8) * 255
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab_cc, stats, _ = cv2.connectedComponentsWithStats(cand, 8)
    if n <= 1:
        return np.full(L.shape, 255, np.uint8)
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    region = (lab_cc == biggest).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = cv2.convexHull(max(cnts, key=cv2.contourArea))
    out = np.zeros_like(region)
    cv2.fillConvexPoly(out, hull, 255)
    # Pull the edge in a little: the hull's rim is where the floor meets the
    # wall, the red trim and the rail, none of which is the item.
    return cv2.erode(out, np.ones((9, 9), np.uint8))


def _poly_design(h: int, w: int, deg: int = 2) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    x = (xx / w - 0.5).ravel()
    y = (yy / h - 0.5).ravel()
    cols = [np.ones_like(x)]
    for d in range(1, deg + 1):
        for i in range(d + 1):
            cols.append((x ** (d - i)) * (y ** i))
    return np.stack(cols, 1)


def _fit_floor(lab: np.ndarray, floor: np.ndarray, iters: int = 3) -> np.ndarray:
    """Model the empty floor's Lab colour as a smooth surface; return it."""
    h, w = floor.shape
    A = _poly_design(h, w)
    Y = lab.reshape(-1, 3).astype(np.float32)
    use = floor.ravel() > 0
    model = np.zeros_like(Y)
    for _ in range(iters):
        idx = np.flatnonzero(use)
        if idx.size < 500:
            break
        sub = idx[:: max(1, idx.size // 20000)]
        coef, *_ = np.linalg.lstsq(A[sub], Y[sub], rcond=None)
        model = A @ coef
        resid = np.abs(Y - model)
        # Re-fit on pixels that look like floor under the current model: this
        # is what keeps a large dark item from dragging the floor model down.
        use = (floor.ravel() > 0) & (resid[:, 0] < 18) & (resid[:, 1] < 8) & (resid[:, 2] < 8)
    return model.reshape(h, w, 3)


def localise_kiosk(frame_bgr: np.ndarray) -> Localisation:
    small, scale = _resize(frame_bgr)
    small_blur = cv2.GaussianBlur(small, (3, 3), 0)
    lab = cv2.cvtColor(small_blur, cv2.COLOR_BGR2LAB).astype(np.float32)
    floor = _floor_region(lab)
    model = _fit_floor(lab, floor)

    dL = model[..., 0] - lab[..., 0]  # positive = darker than the floor
    dC = np.hypot(lab[..., 1] - model[..., 1], lab[..., 2] - model[..., 2])
    # Darker by a lot, or a clearly different colour. Soft shadows are a
    # modest L drop with almost no colour change, so they sit under both.
    strong = ((dL > 38) | (dC > 16)) & (floor > 0)
    # Thin dark parts (a screwdriver's shaft) are too narrow to reach the L
    # threshold after blurring, but a black-hat picks out exactly "narrow and
    # darker than its surroundings" while ignoring broad soft shadows. They
    # only count where they connect to a strong region (below), so floor dirt
    # specks do not.
    bh = cv2.morphologyEx(lab[..., 0], cv2.MORPH_BLACKHAT, np.ones((11, 11), np.uint8))
    thin = (bh > 22) & (floor > 0)
    fg = (strong | thin).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    # The floor's rim is where the wall, the red trim and the rail meet it; a
    # small blob that lives mostly on the rim is the locker, not the item.
    rim = cv2.subtract(floor, cv2.erode(floor, np.ones((25, 25), np.uint8)))

    floor_area = max(1, int(np.count_nonzero(floor)))
    fy, fx = np.nonzero(floor)
    floor_h = int(fy.max() - fy.min() + 1) if fy.size else floor.shape[0]
    floor_w = int(fx.max() - fx.min() + 1) if fx.size else floor.shape[1]
    n, cc, stats, cents = cv2.connectedComponentsWithStats(fg, 8)
    min_area = 0.002 * floor_area
    strong_u8 = strong.astype(np.uint8)
    comps = []
    mask = np.zeros_like(fg)
    for i in range(1, n):
        a = int(stats[i, cv2.CC_STAT_AREA])
        if a < min_area:
            continue
        comp = cc == i
        if int(strong_u8[comp].sum()) < 0.3 * a:
            continue  # mostly thin/weak evidence with no solid body: not an item
        if a < 0.02 * floor_area and np.count_nonzero(rim[comp]) > 0.5 * a:
            continue
        x, y, w, h = (int(v) for v in stats[i, :4])
        # Bay 1's rail curves INTO the convex hull, so the rim test misses it.
        # It is a thin line spanning the floor end to end, which no item is.
        cnts, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        thickness = a / max(1.0, 0.5 * sum(cv2.arcLength(c, True) for c in cnts))
        if thickness < 9 and (h > 0.6 * floor_h or w > 0.6 * floor_w):
            continue
        comps.append({"area": a, "bbox": (x, y, w, h), "centroid": tuple(float(c) for c in cents[i])})
        mask[cc == i] = 255
    comps.sort(key=lambda c: -c["area"])

    bbox = None
    if comps:
        ys, xs = np.nonzero(mask)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
    return Localisation(
        mask=mask,
        floor=floor,
        bbox=bbox,
        area_frac=float(np.count_nonzero(mask)) / floor_area,
        components=comps,
        scale=scale,
        frame_small=small,
    )
