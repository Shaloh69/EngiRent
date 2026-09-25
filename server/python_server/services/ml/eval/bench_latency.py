"""
Per-stage latency of the v2 verifier on THIS machine's CPU, on synthetic
images (the cost of every v2 stage depends on image size, not content, so no
real photo is needed, and none is touched on the server).

    python -m eval.bench_latency [--threads 6] [--geometric]

Prints: model load, a cold verify (listing photos not yet cached), and warm
verifies per tier (the steady state: an owner's photos are cached after the
first check).
"""

from __future__ import annotations

import argparse
import tempfile
import time

import cv2
import numpy as np


def kiosk_frame(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    h, w = 720, 1280
    yy, xx = np.mgrid[0:h, 0:w]
    g = (205 - 30 * xx / w - 20 * yy / h + rng.normal(0, 2, (h, w))).clip(0, 255).astype(np.uint8)
    img = np.dstack([g, g, g])
    img[:, :130] = (40, 30, 150)
    x, y = 560 + seed * 5, 220
    cv2.rectangle(img, (x, y), (x + 110, y + 280), (25, 25, 25), -1)
    cv2.rectangle(img, (x + 10, y + 100), (x + 100, y + 160), (0, 200, 230), -1)
    return img


def listing_photo(seed: int) -> np.ndarray:
    rng = np.random.default_rng(100 + seed)
    img = (rng.normal(170, 25, (1280, 960, 3))).clip(0, 255).astype(np.uint8)
    img = cv2.GaussianBlur(img, (9, 9), 0)
    cv2.rectangle(img, (380, 300), (560, 900), (25, 25, 25), -1)
    cv2.rectangle(img, (395, 520), (545, 640), (0, 200, 230), -1)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--geometric", action="store_true")
    a = ap.parse_args()
    import torch

    torch.set_num_threads(a.threads)
    from app.config import settings
    from app.v2 import pipeline
    from app.v2.verifier import V2Verifier, warm

    settings.v2_cache_dir = tempfile.mkdtemp(prefix="v2bench_")
    pipeline.GEOMETRIC = a.geometric
    t = time.perf_counter()
    warm()
    print(f"model load: {time.perf_counter() - t:.1f}s  (torch threads {torch.get_num_threads()})")

    v = V2Verifier()
    frames = [kiosk_frame(i) for i in range(3)]
    listing = [listing_photo(i) for i in range(4)]
    for label, tier in [("COLD fast (4 listing photos uncached)", "fast"), ("warm fast", "fast"),
                        ("warm fast", "fast"), ("warm full", "full"), ("warm full", "full")]:
        progress = []
        r = v.verify(listing, frames, mode=tier, progress=lambda s, f: progress.append((round(f, 2), s)))
        print(f"{label:<40} {r['elapsed_seconds']:6.2f}s  decision {r['decision']:<8} "
              f"placement {r['placement']['verdict']:<9} stages {r['stage_seconds']}")
    print("progress events:", progress)


if __name__ == "__main__":
    main()
