"""
Stage 7: calibrated fusion, added ONE stage at a time.

Fits a regularised logistic regression over the raw stage evidence dumped by
eval/v2_features.py and maps the probability to the 0-100 the system reads:

    score = 5 + 90 * p

so the scale tops out at 95 (the check never claims certainty) and bottoms out
at 5. With this map, "correct >= 75" means p >= 0.78 and "wrong <= 40" means
p <= 0.39.

Reported three ways, because 108 pairs is a small set:
  fitted   trained and scored on everything (optimistic)
  LOCO     leave-one-capture-out: every capture scored by a model that never saw it
  LOIO     leave-one-ITEM-out: all pairs involving an item (its captures, and
           its listing) scored by a model trained on the other items only.
           The honest number for "a listing we have never seen".

    python -m eval.fit_fusion --tier fast [--save]
"""

from __future__ import annotations

import argparse
import glob
import json

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from pathlib import Path

from eval.harness import ML_ROOT, RUNS

STAGE_ORDER = [
    ("S1 localise+DINOv2", ["dino_max"]),
    ("S2 +semantic(CLIP agreement)", ["dino_max", "sem_bc"]),
    ("S3 +colour", ["dino_max", "sem_bc", "colour"]),
    ("S4 +CLIP image", ["dino_max", "sem_bc", "colour", "clip_max"]),
    ("S5 S2+LightGlue", ["dino_max", "sem_bc", "lg_inliers"]),
]
ITEMS = ["hand-rivets", "little-hammer", "phillip-screw-driver"]
C = 1.0


def to_score(p: np.ndarray) -> np.ndarray:
    return 5.0 + 90.0 * p


def fit(X, y):
    sc = StandardScaler().fit(X)
    m = LogisticRegression(C=C, class_weight="balanced", max_iter=1000).fit(sc.transform(X), y)
    return sc, m


def predict(model, X):
    sc, m = model
    return m.predict_proba(sc.transform(X))[:, 1]


def report(name, rows, s):
    y = np.array([r["kind"] == "pos" for r in rows])
    kinds = np.array([r["kind"] for r in rows])
    wp, bn = s[y].min(), s[~y].max()
    hard = s[kinds == "neg_hard"].max()
    live = [s[i] for i, r in enumerate(rows) if "1125ad66" in r["capture"] and r["listing"] == "phillip-screw-driver"]
    return (f"  {name:<7} worst correct {wp:5.1f} | best wrong {bn:5.1f} | SEP {wp - bn:+6.1f} | "
            f"hard max {hard:5.1f} | live rivet-as-screwdriver {max(live):5.1f} | "
            f"correct>=75: {int((s[y] >= 75).sum())}/{y.sum()}  wrong<=40: {int((s[~y] <= 40).sum())}/{(~y).sum()}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", default="fast")
    ap.add_argument("--save", action="store_true")
    ap.add_argument("--run", default="")
    a = ap.parse_args()
    path = a.run or sorted(glob.glob(str(RUNS / f"v2feats_{a.tier}_*.jsonl")))[-1]
    rows = [json.loads(l) for l in open(path)]
    y = np.array([r["kind"] == "pos" for r in rows]).astype(int)
    print(f"{path}\n{len(rows)} pairs, {y.sum()} correct")

    for r in rows:
        r.setdefault("lg_inliers", 0.0)  # empty captures carry no stage-4 value
    for name, cols in STAGE_ORDER:
        if name.startswith("S5") and not any(r["lg_inliers"] for r in rows):
            continue
        X = np.array([[r[c] for c in cols] for r in rows], dtype=float)
        print(name)
        s_fit = to_score(predict(fit(X, y), X))
        print(report("fitted", rows, s_fit))

        s = np.zeros(len(rows))
        caps = sorted({r["capture"] for r in rows})
        for c in caps:
            te = np.array([r["capture"] == c for r in rows])
            s[te] = to_score(predict(fit(X[~te], y[~te]), X[te]))
        print(report("LOCO", rows, s))

        s = np.zeros(len(rows))
        done = np.zeros(len(rows), bool)
        for it in ITEMS:
            te = np.array([r["truth"] == it or r["listing"] == it for r in rows]) & ~done
            s[te] = to_score(predict(fit(X[~te], y[~te]), X[te]))
            done |= te
        rest = ~done
        if rest.any():
            s[rest] = to_score(predict(fit(X[done], y[done]), X[rest]))
        print(report("LOIO", rows, s))

    if a.save:
        # Every stage set is saved, so the service can fall back to a smaller
        # one when the time budget skips an optional stage (D-87 semantics).
        dest = ML_ROOT / "app" / "v2" / "fusion_params.json"
        allp = json.loads(dest.read_text()) if dest.exists() else {}
        allp[a.tier] = {}
        for name, cols in STAGE_ORDER:
            if name.startswith("S5") and not any(r["lg_inliers"] for r in rows):
                continue
            X = np.array([[r[c] for c in cols] for r in rows], dtype=float)
            sc, m = fit(X, y)
            allp[a.tier][name.split()[0]] = {
                "features": cols, "mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(),
                "coef": m.coef_[0].tolist(), "intercept": float(m.intercept_[0]),
            }
        allp[a.tier]["_fitted_on"] = Path(path).name + f" ({len(rows)} pairs, {int(y.sum())} correct; LOIO numbers in PROGRESS.md)"
        allp["_map"] = "score = 5 + 90 * sigmoid(intercept + coef . (x - mean) / scale)"
        dest.write_text(json.dumps(allp, indent=1))
        print(f"saved -> {dest}")

if __name__ == "__main__":
    main()
