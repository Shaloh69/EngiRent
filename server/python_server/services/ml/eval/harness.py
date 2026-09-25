"""
Offline evaluation harness for item verification (ML phase, 2026-09-25).

Runs a verification pipeline over every (kiosk capture x listing) pair in the
labelled real dataset and reports what the user's ruling asks for:

  - correct item:           fast >= 75, full 80-95
  - wrong item / empty bay: low (<= 40), with a clear gap

so the headline number is the SEPARATION per tier: the worst correct score
against the best wrong/empty score. The HARD set (the rivet tool vs the
screwdriver, both black-and-yellow hand tools, the pair that failed live on
2026-09-25) is reported on its own.

Usage (from services/ml):
    python -m eval.harness --pipeline baseline --tier full
    python -m eval.harness --pipeline baseline --tier fast --threads 6

Images live in eval/data/ (gitignored: the repo is public). Labels are in
eval/labels_real_2026-09-24.csv (tracked: paths and labels only).
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ML_ROOT = HERE.parent
sys.path.insert(0, str(ML_ROOT))

DATA = HERE / "data" / "real_2026-09-24"
LABELS = HERE / "labels_real_2026-09-24.csv"
RUNS = HERE / "runs"

# The listings a capture is checked against. `_unmapped/` holds more photos of
# the multimeter already covered by `tester`, so it adds nothing but duplicates.
LISTINGS = ["hand-rivets", "little-hammer", "phillip-screw-driver", "tester"]
LISTING_TITLES = {
    "hand-rivets": "Hand Rivets",
    "little-hammer": "Little Hammer",
    "phillip-screw-driver": "Phillip Screw Driver",
    "tester": "Tester",
}
HARD = {("hand-rivets", "phillip-screw-driver"), ("phillip-screw-driver", "hand-rivets")}

TARGET = {"fast": (75.0, None), "full": (80.0, 95.0)}
NEG_CEILING = 40.0


def load_captures() -> list[dict]:
    rows = list(csv.DictReader(open(LABELS, newline="", encoding="utf-8")))
    for r in rows:
        r["frames"] = sorted(glob.glob(str(DATA / r["capture"] / "frame-*.jpg")))
        if not r["frames"]:
            raise SystemExit(f"no frames for {r['capture']}")
    return rows


def listing_photos(slug: str) -> list[str]:
    return sorted(glob.glob(str(DATA / "listings" / slug / "*.jpg")))


def pair_kind(capture: dict, listing: str) -> str:
    if capture["kind"] == "empty":
        return "neg_empty"
    if capture["kind"] == "other":
        return "neg_other"
    if capture["truth"] == listing:
        return "pos"
    if (capture["truth"], listing) in HARD:
        return "neg_hard"
    return "neg_item"


# --------------------------------------------------------------------------
# Pipelines
# --------------------------------------------------------------------------


class StageTimer:
    """Accumulates wall time per named stage by wrapping callables."""

    def __init__(self):
        self.t: dict[str, float] = defaultdict(float)

    def wrap(self, obj, attr: str, stage: str):
        fn = getattr(obj, attr)

        def timed(*a, **k):
            s = time.perf_counter()
            try:
                return fn(*a, **k)
            finally:
                self.t[stage] += time.perf_counter() - s

        setattr(obj, attr, timed)

    def take(self) -> dict[str, float]:
        out = {k: round(v, 3) for k, v in self.t.items()}
        self.t.clear()
        return out


class BaselinePipeline:
    """The pipeline deployed today: app/comparison/hybrid.py, unchanged."""

    name = "baseline"

    def __init__(self):
        from app.comparison import hybrid

        self.timer = StageTimer()
        # Wrap the module-level names hybrid.py resolved at import, and the
        # extractors on the instance, so per-stage time is measured without
        # touching the service code.
        for attr, stage in [
            ("check_quality", "quality"),
            ("isolate_item", "isolate"),
            ("phash_similarity", "phash"),
            ("is_obvious_mismatch", "phash"),
            ("extract_text", "ocr"),
        ]:
            self.timer.wrap(hybrid, attr, stage)
        self.v = hybrid.HybridVerifier()
        self.timer.wrap(self.v.traditional, "extract_batch", "traditional")
        self.timer.wrap(self.v.sift, "match_multi", "sift")
        self.timer.wrap(self.v.similarity, "compare_ssim", "ssim")
        self.timer.wrap(self.v.deep, "extract_batch", "deep")

    def score(self, listing: str, photos: list[str], capture: dict, tier: str) -> dict:
        r = self.v.verify(photos, capture["frames"], attempt_number=1, mode=tier)
        return {
            "score": r["confidence"],
            "decision": r["decision"],
            "stages": self.timer.take(),
            "detail": r.get("method_scores", {}),
            "skipped": r.get("skipped_stages", []),
        }


def make_pipeline(name: str):
    if name == "baseline":
        return BaselinePipeline()
    if name == "v2":
        from eval.v2_adapter import V2Pipeline

        return V2Pipeline()
    raise SystemExit(f"unknown pipeline {name}")


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------


def summarise(results: list[dict], tier: str) -> str:
    pos = [r for r in results if r["kind"] == "pos"]
    neg = [r for r in results if r["kind"] != "pos"]
    lines = []
    lo, hi = TARGET[tier]

    def fmt(r):
        return f"{r['score']:6.2f}  {r['capture'].split('/', 1)[1]:<58} vs {r['listing']}"

    worst_pos = min(pos, key=lambda r: r["score"])
    best_neg = max(neg, key=lambda r: r["score"])
    gap = worst_pos["score"] - best_neg["score"]
    lines.append(f"== {tier.upper()}  n_pos={len(pos)} n_neg={len(neg)}")
    lines.append(f"worst correct : {fmt(worst_pos)}")
    lines.append(f"best wrong    : {fmt(best_neg)}  [{best_neg['kind']}]")
    lines.append(f"SEPARATION    : {gap:+.2f}  (positive = a clean threshold exists)")
    in_band = sum(1 for r in pos if r["score"] >= lo and (hi is None or r["score"] <= hi))
    lines.append(
        f"correct in target band ({lo}-{hi or 100}): {in_band}/{len(pos)}   "
        f"negatives <= {NEG_CEILING}: {sum(1 for r in neg if r['score'] <= NEG_CEILING)}/{len(neg)}"
    )
    by = defaultdict(list)
    for r in results:
        by[r["kind"]].append(r["score"])
    for k in ["pos", "neg_hard", "neg_item", "neg_empty", "neg_other"]:
        v = sorted(by.get(k, []))
        if v:
            lines.append(f"  {k:<10} n={len(v):3d}  min {v[0]:6.2f}  median {v[len(v) // 2]:6.2f}  max {v[-1]:6.2f}")
    hard = [r for r in results if r["kind"] == "neg_hard"]
    if hard:
        hp = [r for r in pos if r["listing"] in ("hand-rivets", "phillip-screw-driver")]
        lines.append(
            f"HARD set: worst correct rivet/screwdriver {min(r['score'] for r in hp):.2f} "
            f"vs best hard wrong {max(r['score'] for r in hard):.2f}"
        )
    live = [r for r in results if "1125ad66" in r["capture"] and r["listing"] == "phillip-screw-driver"]
    for r in live:
        lines.append(f"  live incident (rivet deposited as screwdriver): {fmt(r)}")
    st = defaultdict(list)
    for r in results:
        for k, v in r["stages"].items():
            st[k].append(v)
        st["_total"].append(r["elapsed"])
    lines.append("latency per pair (s): " + ", ".join(
        f"{k} {sum(v) / len(v):.2f}" for k, v in sorted(st.items())))
    lines.append(f"max total per pair: {max(st['_total']):.2f}s")
    dec = defaultdict(lambda: defaultdict(int))
    for r in results:
        dec["pos" if r["kind"] == "pos" else "neg"][r["decision"]] += 1
    lines.append("decisions: " + json.dumps({k: dict(v) for k, v in dec.items()}))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pipeline", default="baseline")
    ap.add_argument("--tier", choices=["fast", "full"], default="full")
    ap.add_argument("--threads", type=int, default=0, help="torch threads (server: 6)")
    ap.add_argument("--only", default="", help="substring filter on capture path")
    ap.add_argument("--tag", default="")
    a = ap.parse_args()

    import logging

    logging.basicConfig(level=logging.ERROR)
    if a.threads:
        import torch

        torch.set_num_threads(a.threads)

    caps = [c for c in load_captures() if a.only in c["capture"]]
    t0 = time.perf_counter()
    pipe = make_pipeline(a.pipeline)
    load_s = time.perf_counter() - t0
    print(f"pipeline {a.pipeline} loaded in {load_s:.1f}s; {len(caps)} captures x {len(LISTINGS)} listings")

    results = []
    for c in caps:
        for li in LISTINGS:
            s = time.perf_counter()
            out = pipe.score(li, listing_photos(li), c, a.tier) if not hasattr(pipe, "score_titled") \
                else pipe.score_titled(li, LISTING_TITLES[li], listing_photos(li), c, a.tier)
            el = time.perf_counter() - s
            r = {"capture": c["capture"], "listing": li, "kind": pair_kind(c, li), "bay": c["bay"],
                 "placement": c["placement"], "elapsed": round(el, 3), **out}
            results.append(r)
            print(f"{r['kind']:<9} {r['score']:6.2f} {r['decision']:<9} {el:5.1f}s  "
                  f"{c['capture'].split('/', 1)[1]} vs {li}", flush=True)

    RUNS.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out = RUNS / f"{a.pipeline}_{a.tier}{('_' + a.tag) if a.tag else ''}_{stamp}.jsonl"
    with open(out, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, default=str) + "\n")
    print()
    print(summarise(results, a.tier))
    print(f"(model load {load_s:.1f}s; results -> {out.relative_to(ML_ROOT)})")


if __name__ == "__main__":
    main()
