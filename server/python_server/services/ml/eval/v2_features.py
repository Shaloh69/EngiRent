"""
Dump the v2 pipeline's raw per-stage evidence for every (capture x listing)
pair, per tier, and print each stage's own separation. Fusion is fitted on this
dump by eval/fit_fusion.py; nothing here is tuned.

    python -m eval.v2_features --tier fast --threads 6
"""

from __future__ import annotations

import argparse
import json
import time

import cv2
import numpy as np

from eval.harness import LISTING_TITLES, LISTINGS, RUNS, listing_photos, load_captures, pair_kind


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["fast", "full"], default="fast")
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--geometric", action="store_true")
    a = ap.parse_args()
    import torch

    torch.set_num_threads(a.threads)
    from app.v2 import embed, pipeline

    t0 = time.perf_counter()
    embed._get("dino")
    embed._get("clip")
    from app.v2.listing import _session

    _session()
    print(f"models loaded in {time.perf_counter() - t0:.1f}s")

    full = a.tier == "full"
    pipeline.GEOMETRIC = a.geometric
    lst = {}
    for li in LISTINGS:
        s = time.perf_counter()
        lst[li] = [pipeline.prepare_listing(cv2.imread(p)) for p in listing_photos(li)]
        print(f"listing {li}: {len(lst[li])} photos in {time.perf_counter() - s:.1f}s (one-off, cached)", flush=True)

    rows = []
    for c in load_captures():
        s = time.perf_counter()
        frames = [pipeline.prepare_frame(cv2.imread(f), full) for f in c["frames"]]
        cap_s = time.perf_counter() - s
        stage_t: dict = {}
        for f in frames:
            for k, v in f["times"].items():
                stage_t[k] = stage_t.get(k, 0.0) + v
        for li in LISTINGS:
            s = time.perf_counter()
            feats = pipeline.pair_features(lst[li], frames, LISTING_TITLES[li])
            pair_s = time.perf_counter() - s
            for f in frames:
                f.pop("disk_cache", None)
                if "rots" in f:
                    f["disk_cache"] = {}
            r = {"capture": c["capture"], "listing": li, "kind": pair_kind(c, li), "bay": c["bay"],
                 "truth": c["truth"], "placement_label": c["placement"], "tier": a.tier,
                 "capture_seconds": round(cap_s, 3), "pair_seconds": round(pair_s, 3),
                 "stage_seconds": {k: round(v, 3) for k, v in stage_t.items()}, **feats}
            rows.append(r)
        print(f"{cap_s:5.1f}s {c['capture']}", flush=True)

    RUNS.mkdir(exist_ok=True)
    out = RUNS / f"v2feats_{a.tier}_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    with open(out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, default=float) + "\n")
    print(f"-> {out}")

    for k in ["dino_max", "dino_mean", "clip_max", "sem_bc", "sem_title", "colour"] + (["lg_inliers"] if a.geometric else []):
        pos = [r[k] for r in rows if r["kind"] == "pos"]
        neg = [r[k] for r in rows if r["kind"] != "pos"]
        hard = [r[k] for r in rows if r["kind"] == "neg_hard"]
        auc = np.mean([p > n for p in pos for n in neg]) + 0.5 * np.mean([p == n for p in pos for n in neg])
        print(f"{k:<10} pos min {min(pos):.3f} med {np.median(pos):.3f} | neg med {np.median(neg):.3f} "
              f"max {max(neg):.3f} | hard max {max(hard):.3f} | gap {min(pos) - max(neg):+.3f} | AUC {auc:.3f}")


if __name__ == "__main__":
    main()
