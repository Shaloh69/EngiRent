"""
Stage P: is the item placed so the camera can judge it?

From stage 1a's mask: OK / OFF_CENTER / TRUNCATED / EMPTY / MULTIPLE, plus a
direction to move it. A non-OK verdict is not a judgement of the ITEM. Node
turns it into a "reposition" that re-opens the door, with its own retry cap
that does not count toward the attempt-2 review escalation (verdictPolicy.ts).

Thresholds were set on the real 2026-09-24/25 captures
(eval/labels_real_2026-09-24.csv): the smallest real item (the screwdriver)
covers ~2.0% of the floor, so EMPTY is < 0.5%; 13 of 20 real item captures
touch the frame's top edge, which is exactly what TRUNCATED must catch.
"""

from __future__ import annotations

import numpy as np

from .localise import Localisation

EMPTY_MAX_AREA = 0.005
EDGE_PX = 12  # ~4% of the working height: the hull is eroded ~4 px, and where the far floor is darkest an item's last few rows blend into it (measured: masks stop 8-10 px short of the top on 4 real cut-off captures)
EDGE_MIN_CONTACT = 12  # px along the edge (of 480): a shaft tip grazing it is not a cut-off item
OFF_CENTER_MAX = 0.32  # centroid offset from the floor centre, as a fraction of the floor's size
MULTI_MIN_RATIO = 0.25  # a second blob this big relative to the first counts as another object
MULTI_MIN_GAP = 0.08  # ...and at least this far away (fraction of the floor diagonal)

MESSAGES = {
    "OK": "",
    "EMPTY": "No item found in the locker. Place the item on the floor of the locker.",
    "TRUNCATED": "Part of the item is outside the camera's view. Move it toward the middle of the floor.",
    "OFF_CENTER": "The item is too close to the side. Move it toward the middle of the floor.",
    "MULTIPLE": "More than one object is in the locker. Leave only the rented item inside.",
}


def judge_placement(loc: Localisation) -> dict:
    h, w = loc.mask.shape
    fy, fx = np.nonzero(loc.floor)
    fcx, fcy = (float(fx.mean()), float(fy.mean())) if fx.size else (w / 2, h / 2)
    fw = float(fx.max() - fx.min() + 1) if fx.size else float(w)
    fh = float(fy.max() - fy.min() + 1) if fy.size else float(h)

    out = {
        "verdict": "OK",
        "edges": [],
        "offset": [0.0, 0.0],
        "area_frac": round(loc.area_frac, 4),
        "bbox_norm": None,
    }
    if not loc.components or loc.area_frac < EMPTY_MAX_AREA:
        out["verdict"] = "EMPTY"
        out["message"] = MESSAGES["EMPTY"]
        return out

    x, y, bw, bh = loc.bbox
    out["bbox_norm"] = [round(x / w, 4), round(y / h, 4), round(bw / w, 4), round(bh / h, 4)]

    m = loc.mask > 0
    edges = []
    for name, band in (
        ("top", m[:EDGE_PX].any(axis=0)),
        ("bottom", m[-EDGE_PX:].any(axis=0)),
        ("left", m[:, :EDGE_PX].any(axis=1)),
        ("right", m[:, -EDGE_PX:].any(axis=1)),
    ):
        if int(band.sum()) >= EDGE_MIN_CONTACT:
            edges.append(name)
    out["edges"] = edges

    ys, xs = np.nonzero(m)
    dx = (float(xs.mean()) - fcx) / fw
    dy = (float(ys.mean()) - fcy) / fh
    # Direction to MOVE the item, in image terms: opposite its offset.
    out["offset"] = [round(dx, 3), round(dy, 3)]

    big = loc.components[0]
    others = [
        c
        for c in loc.components[1:]
        if c["area"] >= MULTI_MIN_RATIO * big["area"]
        and np.hypot(c["centroid"][0] - big["centroid"][0], c["centroid"][1] - big["centroid"][1])
        >= MULTI_MIN_GAP * np.hypot(fw, fh)
    ]

    if others:
        out["verdict"] = "MULTIPLE"
    elif edges:
        out["verdict"] = "TRUNCATED"
    elif max(abs(dx), abs(dy)) > OFF_CENTER_MAX:
        out["verdict"] = "OFF_CENTER"
    out["message"] = MESSAGES[out["verdict"]]
    return out
