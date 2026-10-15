"""
Per-group measurements of the face-liveness components on single photos, to
choose the thresholds in app/config.py from numbers.

    python eval/wild_faces_report.py [fixtures/_wild]  [--csv out.csv]

For every photo with exactly one face it records: eye aspect ratio (EAR),
head yaw/pitch (solvePnP), the head-covering numbers (hat share, forehead
skin, covering frames the face, REFUSED by the current rule) and the
anti-spoof margin. Groups come from the folder names (bare, glasses, cap,
hood, hijab, closed_eyes, turned), so the folder name is the expectation.
The groups are search results, so a few photos will not show what their group
says: use `--list group` to print one group's rows and look at the outliers.
"""

import argparse
import csv
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.face.backend import decode_frame, load_backend  # noqa: E402
from app.face.covering import assess_covering  # noqa: E402
from app.face.geometry import head_pose, mean_ear  # noqa: E402
from app.routers.face_liveness import _model_paths  # noqa: E402


def measure(backend, path):
    rgb = decode_frame(open(path, "rb").read(), settings.face_max_image_side)
    boxes = backend.faces(rgb)
    if len(boxes) != 1:
        return {"faces": len(boxes)}
    box = boxes[0]
    lm = backend.landmarks(rgb, box)
    h, w = rgb.shape[:2]
    yaw, pitch = head_pose(lm, (w, h))
    mask, crop_lm = backend.parse(rgb, box)
    cov = assess_covering(
        mask, crop_lm,
        hat_min_share=settings.face_hat_min_share,
        forehead_min_skin=settings.face_forehead_min_skin,
        forehead_band=settings.face_forehead_band,
        frame_min_share=settings.face_frame_min_share,
    )
    return {
        "faces": 1,
        "ear": round(mean_ear(lm), 3),
        "yaw": round(yaw, 1),
        "pitch": round(pitch, 1),
        "hat_share": round(cov.hat_share, 3),
        "forehead_skin": round(cov.forehead_skin, 3),
        "frames_face": int(cov.frames_face),
        "refused": int(cov.refused),
        "spoof": round(backend.spoof_margin(rgb, lm), 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default=os.path.join("tests", "fixtures", "faces", "_wild"))
    ap.add_argument("--csv")
    ap.add_argument("--list")
    ap.add_argument("--max-yaw", type=float, default=None, help="keep only photos with |yaw| at or below this (the centre frame must face the camera)")
    a = ap.parse_args()

    backend = load_backend(*_model_paths())
    rows = []
    for group in sorted(os.listdir(a.root)):
        gdir = os.path.join(a.root, group)
        if not os.path.isdir(gdir):
            continue
        for name in sorted(os.listdir(gdir)):
            if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            try:
                m = measure(backend, os.path.join(gdir, name))
            except Exception as e:  # a bad file must not stop the run
                m = {"faces": -1, "error": str(e)[:60]}
            if a.max_yaw is not None and m.get("faces") == 1 and abs(m["yaw"]) > a.max_yaw:
                continue
            rows.append({"group": group, "file": name, **m})

    print(f"{'group':12} {'n':>3} {'1face':>5} | {'EAR med [min..max]':>22} | {'|yaw| med [min..max]':>22} | {'hat>=.04':>8} {'refused':>7} | spoof<0")
    for group in sorted({r["group"] for r in rows}):
        g = [r for r in rows if r["group"] == group]
        one = [r for r in g if r.get("faces") == 1]
        if not one:
            print(f"{group:12} {len(g):>3} {0:>5}")
            continue
        ear = np.array([r["ear"] for r in one])
        yaw = np.abs([r["yaw"] for r in one])
        hat = sum(r["hat_share"] >= settings.face_hat_min_share for r in one)
        ref = sum(r["refused"] for r in one)
        sp = sum(r["spoof"] < settings.face_spoof_min_margin for r in one)
        print(
            f"{group:12} {len(g):>3} {len(one):>5} | {np.median(ear):6.3f} [{ear.min():.3f}..{ear.max():.3f}] | "
            f"{np.median(yaw):6.1f} [{yaw.min():4.1f}..{yaw.max():4.1f}] | {hat:>3}/{len(one):<4} {ref:>3}/{len(one):<3} | {sp}/{len(one)}"
        )
    if a.list:
        print()
        for r in rows:
            if r["group"] == a.list:
                print({k: v for k, v in r.items() if k != "group"})
    if a.csv:
        keys = sorted({k for r in rows for k in r})
        with open(a.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader()
            w.writerows(rows)


if __name__ == "__main__":
    main()
