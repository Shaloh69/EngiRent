"""
Stage 7: calibrated fusion of the stage evidence into the 0-100 score.

Parameters are fitted offline on the labelled real captures by
eval/fit_fusion.py and stored in fusion_params.json, one model per tier and per
stage set, so a check that had to skip an optional stage is scored by the
model that never used it, rather than by one that reads the missing stage as 0.

    score = 5 + 90 * p

tops out at 95 (the check never claims certainty) and bottoms out at 5.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

_PARAMS = json.loads((Path(__file__).with_name("fusion_params.json")).read_text())

# Which stage set each tier uses when every stage ran (chosen on the harness;
# see PROGRESS.md "ML run log"), and the fallback when an optional stage was
# skipped for time.
CHOSEN = {"fast": "S2", "full": "S2"}
FALLBACK = "S1"


def score(tier: str, feats: dict, stage_set: str | None = None) -> tuple[float, str]:
    tp = _PARAMS.get(tier) or _PARAMS["fast"]
    name = stage_set or CHOSEN[tier]
    if name not in tp or any(f not in feats for f in tp[name]["features"]):
        name = FALLBACK
    m = tp[name]
    z = m["intercept"] + sum(
        c * (feats[f] - mu) / sd for f, c, mu, sd in zip(m["features"], m["coef"], m["mean"], m["scale"])
    )
    p = 1.0 / (1.0 + math.exp(-z))
    return 5.0 + 90.0 * p, name
