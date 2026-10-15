"""
Head-covering rule over a face-parsing mask (user ruling 2026-10-15, spec §7.2).

    Caps, hats and hoods are refused. Glasses are fine. A head covering that
    leaves the whole face visible, forehead to chin (for example a hijab),
    must pass.

The mask comes from BiSeNet trained on CelebAMask-HQ (`yakhyo/face-parsing`).
Its label order, read from that repo's `utils/common.py` (ATTRIBUTES, argmax
index = position + 1, 0 = background), is fixed below. `eye_g` (6) is never
looked at, which is what "glasses are fine" means here.

The rule, in the order it is applied:
  1. hardly any `hat` pixels in the head region          -> pass
  2. otherwise the forehead must be visible skin AND the covering must frame
     the face (reach below the eyes on BOTH sides, as a hijab does; a cap or
     a brimmed hat sits above the ears)                   -> pass
  3. anything else                                        -> refuse (HAT)

Every number is a setting (`face_hat_*`, `face_forehead_*`) to be tuned on
real captures; none of them is a guess presented as a measurement.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SKIN, L_BROW, R_BROW, L_EYE, R_EYE, EYE_G = 1, 2, 3, 4, 5, 6
L_EAR, R_EAR, EAR_R, NOSE, MOUTH, U_LIP, L_LIP = 7, 8, 9, 10, 11, 12, 13
NECK, NECK_L, CLOTH, HAIR, HAT = 14, 15, 16, 17, 18

_HEAD_CLASSES = (SKIN, L_BROW, R_BROW, L_EYE, R_EYE, EYE_G, L_EAR, R_EAR, EAR_R,
                 NOSE, MOUTH, U_LIP, L_LIP, HAIR, HAT)


@dataclass(frozen=True)
class CoveringResult:
    refused: bool
    hat_share: float  # hat pixels / head-region pixels
    forehead_skin: float  # skin share of the forehead band (1.0 when no hat)
    frames_face: bool  # covering reaches below the eyes on both sides


def assess_covering(
    mask: np.ndarray,
    landmarks: np.ndarray,
    *,
    hat_min_share: float,
    forehead_min_skin: float,
    forehead_band: float,
    frame_min_share: float,
) -> CoveringResult:
    """Apply the rule. `mask` and `landmarks` share one coordinate frame.

    `forehead_band` is the band's height above the brows, as a fraction of
    the brow-to-chin distance. `frame_min_share` is how much covering (as a
    share of the head region) each side needs below the eyes to count as
    framing the face, so a few stray pixels never do.
    """
    m = np.asarray(mask)
    lm = np.asarray(landmarks, dtype=np.float64)
    h, w = m.shape[:2]

    head = np.isin(m, _HEAD_CLASSES)
    hat = m == HAT
    head_px = int(head.sum())
    hat_share = float(hat.sum()) / head_px if head_px else 0.0
    if hat_share < hat_min_share:
        return CoveringResult(False, hat_share, 1.0, False)

    brow_top = float(lm[17:27, 1].min())
    chin = float(lm[8, 1])
    face_h = max(chin - brow_top, 1.0)
    x0 = int(max(0, np.floor(lm[17, 0])))
    x1 = int(min(w, np.ceil(lm[26, 0])))
    y1 = int(max(0, np.floor(brow_top)))
    y0 = int(max(0, np.floor(brow_top - forehead_band * face_h)))
    band = m[y0:y1, x0:x1]
    forehead_skin = float((band == SKIN).mean()) if band.size else 0.0

    # Below the eye line, outside the jaw on each side.
    eye_y = int(min(h, np.ceil(lm[36:48, 1].mean())))
    jaw_left = int(max(0, np.floor(lm[0:3, 0].min())))
    jaw_right = int(min(w, np.ceil(lm[14:17, 0].max())))
    below = hat[eye_y:, :]
    need = max(1.0, frame_min_share * head_px)
    frames_face = bool(below[:, :jaw_left].sum() >= need and below[:, jaw_right:].sum() >= need)

    refused = not (forehead_skin >= forehead_min_skin and frames_face)
    return CoveringResult(refused, hat_share, forehead_skin, frames_face)
