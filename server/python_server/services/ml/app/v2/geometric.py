"""
Stage 4 (full tier only): is it the same physical object, not just the same kind?

DISK keypoints + LightGlue matching + a RANSAC homography between the two
crops; the evidence is the inlier count. DISK is not rotation-invariant, so the
locker crop is tried at 4 rotations and the best is kept.

Kept only if the harness shows it improves separation (PROGRESS.md, ML phase).
"""

from __future__ import annotations

import threading

import cv2
import numpy as np
import torch

_lock = threading.Lock()
_m: dict = {}
N_KP = 1024


def _models():
    with _lock:
        if not _m:
            import kornia.feature as KF

            _m["disk"] = KF.DISK.from_pretrained("depth").eval()
            _m["lg"] = KF.LightGlueMatcher("disk").eval()
        return _m["disk"], _m["lg"]


@torch.inference_mode()
def disk_features(rgb: np.ndarray) -> dict:
    disk, _ = _models()
    t = torch.from_numpy(rgb).permute(2, 0, 1).float()[None] / 255.0
    f = disk(t, n=N_KP, pad_if_not_divisible=True)[0]
    return {"kp": f.keypoints, "desc": f.descriptors, "hw": rgb.shape[:2]}


@torch.inference_mode()
def inliers(a: dict, b: dict) -> int:
    import kornia.feature as KF

    _, lg = _models()
    if len(a["kp"]) < 8 or len(b["kp"]) < 8:
        return 0
    lafa = KF.laf_from_center_scale_ori(a["kp"][None], torch.ones(1, len(a["kp"]), 1, 1))
    lafb = KF.laf_from_center_scale_ori(b["kp"][None], torch.ones(1, len(b["kp"]), 1, 1))
    hw_a = torch.tensor(a["hw"])[None]
    hw_b = torch.tensor(b["hw"])[None]
    _, idx = lg(a["desc"], b["desc"], lafa, lafb, hw1=hw_a, hw2=hw_b)
    if idx.shape[0] < 8:
        return 0
    pa = a["kp"][idx[:, 0]].numpy()
    pb = b["kp"][idx[:, 1]].numpy()
    H, m = cv2.findHomography(pa, pb, cv2.USAC_MAGSAC, 6.0)
    return int(m.sum()) if m is not None else 0
