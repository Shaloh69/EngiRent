"""
Restore the frames the first dataset copy lost.

`manifest.csv` maps 84 source files to frame paths, but in 13 places two sources
were given the same `frame-N.jpg`, so only 71 files survived. Given the
originals (eval/pull_originals.sh puts them in `_orig_verifications/`), this
rewrites every capture folder with one frame per source, named in source order
(`frame-1..N`, the source filename starts with epoch ms), and rewrites
`manifest.csv` to match. Captures and labels (labels_real_*.csv) are keyed by
capture folder, so they stay valid.

    python -m eval.rebuild_dataset            # dry run: what would change
    python -m eval.rebuild_dataset --apply
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "real_2026-09-24"
ORIG = DATA / "_orig_verifications"
PREFIX = "storage/verifications/"


def plan(data: Path = DATA, orig: Path = ORIG) -> tuple[list[dict], dict[str, list[dict]]]:
    rows = list(csv.DictReader(open(data / "manifest.csv", newline="", encoding="utf-8")))
    by_cap: dict[str, list[dict]] = defaultdict(list)
    seen = set()
    for r in rows:
        src = r["source"]
        if not src.startswith(PREFIX) or ".." in src:
            raise SystemExit(f"unexpected source path: {src}")
        if src in seen:
            continue  # the same source listed twice is one frame, not two
        seen.add(src)
        by_cap[os.path.dirname(r["frame"])].append(r)
    missing = [r["source"] for rs in by_cap.values() for r in rs if not (orig / r["source"][len(PREFIX):]).exists()]
    if missing:
        raise SystemExit(f"{len(missing)} originals missing under {orig}, e.g. {missing[0]}")
    for cap in by_cap:
        by_cap[cap].sort(key=lambda r: os.path.basename(r["source"]))
    return rows, by_cap


def apply(data: Path = DATA, orig: Path = ORIG) -> int:
    rows, by_cap = plan(data, orig)
    out_rows = []
    for cap, rs in sorted(by_cap.items()):
        d = data / cap
        for old in d.glob("frame-*.jpg"):
            old.unlink()
        d.mkdir(parents=True, exist_ok=True)
        for k, r in enumerate(rs, 1):
            frame = f"{cap}/frame-{k}.jpg"
            shutil.copy2(orig / r["source"][len(PREFIX):], data / frame)
            out_rows.append({**r, "frame": frame})
    with open(data / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    return len(out_rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    rows, by_cap = plan()
    n_now = sum(1 for _ in DATA.glob("kiosk/*/cap_*/frame-*.jpg"))
    n_new = sum(len(v) for v in by_cap.values())
    print(f"manifest rows {len(rows)}, unique sources {n_new}, frames on disk now {n_now}")
    for cap, rs in sorted(by_cap.items()):
        have = len(list((DATA / cap).glob("frame-*.jpg")))
        if have != len(rs):
            print(f"  {cap}: {have} -> {len(rs)} frames")
    if a.apply:
        print(f"wrote {apply()} frames; manifest.csv rewritten")


if __name__ == "__main__":
    main()
