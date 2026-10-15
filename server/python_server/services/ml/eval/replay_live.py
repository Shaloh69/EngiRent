"""
Replay the frames the face check captured on the server (tests/fixtures/faces/_live/<attempt>/,
GITIGNORED: real faces) through the CURRENT code and print every measurement.

    python eval/replay_live.py            # per-frame table
    python eval/replay_live.py --verdict  # also run check_liveness on each attempt, with mirrored false AND true

Used to tune thresholds from what real phones actually send instead of guessing.
"""

import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.face.backend import decode_frame, load_backend  # noqa: E402
from app.face.covering import assess_covering  # noqa: E402
from app.face.geometry import head_pose, mean_ear  # noqa: E402
from app.face.liveness import Thresholds, check_liveness  # noqa: E402
from app.routers.face_liveness import _model_paths  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "fixtures", "faces", "_live")
KEYS = ["centre", "blink", "blink2", "blink3", "turn_left", "turn_right"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verdict", action="store_true")
    a = ap.parse_args()
    b = load_backend(*_model_paths())
    t = Thresholds.from_settings(settings)
    for name in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, name)
        if not os.path.isdir(d):
            continue
        v = json.load(open(os.path.join(d, "verdict.json")))
        print(f"\n== {name}  (server said {v['reason'] or 'PASS'}, mirrored={v.get('mirrored')})")
        frames = {}
        for k in KEYS:
            p = os.path.join(d, k + ".jpg")
            if not os.path.isfile(p):
                continue
            rgb = decode_frame(open(p, "rb").read(), settings.face_max_image_side)
            frames[k.upper() if k.startswith("blink") and k != "blink" else k.upper()] = rgb
            boxes = b.faces(rgb)
            line = f"  {k:10s} {rgb.shape[1]}x{rgb.shape[0]} faces={len(boxes)}"
            if len(boxes) == 1:
                lm = b.landmarks(rgb, boxes[0])
                h, w = rgb.shape[:2]
                yaw, pitch = head_pose(lm, (w, h))
                line += f" ear={mean_ear(lm):.3f} yaw={yaw:6.1f} pitch={pitch:6.1f}"
                if k == "centre":
                    mask, cl = b.parse(rgb, boxes[0])
                    c = assess_covering(mask, cl, hat_min_share=t.hat_min_share, forehead_min_skin=t.forehead_min_skin,
                                        forehead_band=t.forehead_band, frame_min_share=t.frame_min_share)
                    line += f" hat={c.hat_share:.3f} forehead={c.forehead_skin:.2f} frames={int(c.frames_face)} REFUSED={int(c.refused)}"
                line += f" spoof={b.spoof_margin(rgb, lm):6.2f}"
            elif len(boxes) > 1:
                line += " boxes=" + str([(x[3], x[0], x[1] - x[3]) for x in boxes])
            print(line)
        if a.verdict and {"CENTRE", "BLINK", "TURN_LEFT", "TURN_RIGHT"} <= {k.upper() for k in frames}:
            fr = {k.upper(): v2 for k, v2 in frames.items()}
            for m in (False, True):
                r = check_liveness(fr, b, t, mirrored=m)
                print(f"  -> mirrored={m!s:5}: live={r.live} reason={r.reason}")


if __name__ == "__main__":
    main()
