"""
Stage 6: does comparing a RETURN against the item's own DEPOSIT frames
(same camera, same light, same white floor) separate better than comparing
against the owner's listing photos?

Every item capture is compared with every other item capture (kiosk crop vs
kiosk crop, DINOv2, best rotation, best frame pair). Positive = the same
physical item. Both screwdriver rentals are the same screwdriver, and the
"wrong item" captures are the Hand Rivets tool, so they count by item.

    python -m eval.return_vs_deposit
"""

from __future__ import annotations

import itertools

import cv2
import numpy as np

from eval.harness import load_captures


def main():
    import torch

    torch.set_num_threads(6)
    from app.v2 import pipeline

    caps = [c for c in load_captures() if c["kind"] == "item"]
    emb = {}
    for c in caps:
        fr = [pipeline.prepare_frame(cv2.imread(f), full=False) for f in c["frames"]]
        emb[c["capture"]] = [f for f in fr if f.get("crop") is not None]

    pos, neg = [], []
    for a, b in itertools.combinations(caps, 2):
        A, B = emb[a["capture"]], emb[b["capture"]]
        if not A or not B:
            continue
        # a rotated a-crop against b's upright crop (index 0 of b's rotations)
        s = max(float((fa["dino"] @ fb["dino"][0]).max()) for fa in A for fb in B)
        (pos if a["truth"] == b["truth"] else neg).append((s, a["capture"], b["capture"]))
    pos.sort()
    neg.sort(reverse=True)
    print(f"kiosk-vs-kiosk DINOv2: {len(pos)} same-item pairs, {len(neg)} different-item pairs")
    print(f"  same item   min {pos[0][0]:.3f}  median {np.median([p[0] for p in pos]):.3f}")
    print(f"  different   max {neg[0][0]:.3f}  median {np.median([n[0] for n in neg]):.3f}")
    print(f"  gap {pos[0][0] - neg[0][0]:+.3f}")
    print("  worst same-item:", pos[0][1].split('/', 1)[1], "|", pos[0][2].split('/', 1)[1])
    print("  best different:", neg[0][1].split('/', 1)[1], "|", neg[0][2].split('/', 1)[1])


if __name__ == "__main__":
    main()
