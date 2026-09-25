"""
Item verification v2: localise -> place -> crop -> semantic -> instance -> colour -> fuse.

Each stage reports its own raw evidence; stage 7 (fusion.py) turns that into
the 0-100 the rest of the system reads. The stages, and which tier runs them:

  P  placement           both   (kiosk frames only)
  1  localise            both   (kiosk: floor model; listing: ISNet, cached)
  2  semantic (CLIP)     both
  3  DINOv2 instance     both   (fast: 4 rotations; full: 8 incl. flips)
  5  colour in the mask  both
  4  LightGlue inliers   full   (if it earns its place: see PROGRESS.md)

A progress callback receives (stage, fraction_done) so the phone and kiosk can
show a real progress bar instead of a spinner.
"""

from __future__ import annotations

import hashlib
import pickle
import time
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from ..config import settings
from . import embed, geometric
from .crops import colour_hist, make_crop, rotations
from .listing import cut_listing
from .localise import localise_kiosk
from .placement import judge_placement
from .vocab import VOCAB, prompt

Progress = Callable[[str, float], None]

_listing_cache: dict[str, dict | None] = {}

# Stage 4 is loaded only when enabled (the harness decides whether it stays).
GEOMETRIC = False


def _sha(img: np.ndarray) -> str:
    return hashlib.sha1(img.tobytes()).hexdigest()


def _zeroshot(clip_vecs: np.ndarray, labels: list[str]) -> np.ndarray:
    t = embed.clip_text([prompt(x) for x in labels])
    logits = embed.CLIP_LOGIT_SCALE * clip_vecs @ t.T
    logits -= logits.max(1, keepdims=True)
    p = np.exp(logits)
    return p / p.sum(1, keepdims=True)


def _disk_path(key: str) -> Path | None:
    d = settings.v2_cache_dir
    return Path(d) / f"listing_{key}.pkl" if d else None


def _load_cached(key: str) -> tuple[bool, dict | None]:
    p = _disk_path(key)
    if p is None or not p.exists():
        return False, None
    try:
        with open(p, "rb") as f:
            v = pickle.load(f)
        if GEOMETRIC and v is not None and "disk" not in v:
            return False, None  # cached before stage 4 was enabled
        return True, v
    except Exception:
        return False, None


def _save_cached(key: str, v: dict | None) -> None:
    p = _disk_path(key)
    if p is None:
        return
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        slim = None if v is None else {k: v[k] for k in v if k != "crop"}
        tmp = p.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            pickle.dump(slim, f)
        tmp.replace(p)
    except Exception:
        pass  # a cache that cannot be written only costs time


def prepare_listing(img_bgr: np.ndarray) -> dict | None:
    """Cut out and embed one listing photo. Cached in memory and on disk by
    content hash: an owner's photo never changes, so a service restart must not
    make the first deposit afterwards pay ~5 s per photo again."""
    key = _sha(img_bgr)
    if key in _listing_cache:
        return _listing_cache[key]
    hit, v = _load_cached(key)
    if hit:
        _listing_cache[key] = v
        return v
    mask, bbox = cut_listing(img_bgr)
    out = None
    if bbox is not None:
        c = make_crop(img_bgr, mask)
        if c is not None:
            out = {
                "crop": c,
                "dino": embed.dino([c["rgb"]])[0],
                "clip": embed.clip_image([c["rgb"]])[0],
                "hist": colour_hist(c["rgb"], c["mask"]),
            }
            out["zs"] = _zeroshot(out["clip"][None], VOCAB)[0]
            if GEOMETRIC:
                out["disk"] = geometric.disk_features(c["rgb"])
    _listing_cache[key] = out
    _save_cached(key, out)
    return out


def prepare_frame(img_bgr: np.ndarray, full: bool) -> dict:
    t = {}
    s = time.perf_counter()
    loc = localise_kiosk(img_bgr)
    place = judge_placement(loc)
    t["localise+placement"] = time.perf_counter() - s
    out = {"placement": place, "times": t, "crop": None}
    if place["verdict"] == "EMPTY":
        return out
    big = cv2.resize(loc.mask, (img_bgr.shape[1], img_bgr.shape[0]), interpolation=cv2.INTER_NEAREST)
    floor = cv2.resize(loc.floor, (img_bgr.shape[1], img_bgr.shape[0]), interpolation=cv2.INTER_NEAREST)
    bg = cv2.bitwise_and(floor, cv2.bitwise_not(cv2.dilate(big, np.ones((25, 25), np.uint8))))
    c = make_crop(img_bgr, big, bg)
    if c is None:
        return out
    out["crop"] = c
    s = time.perf_counter()
    rots = rotations(c["rgb"], flips=full)
    out["dino"] = embed.dino(rots)
    t["dino"] = time.perf_counter() - s
    s = time.perf_counter()
    out["clip"] = embed.clip_image([c["rgb"]])[0]
    out["zs"] = _zeroshot(out["clip"][None], VOCAB)[0]
    t["clip"] = time.perf_counter() - s
    out["hist"] = colour_hist(c["rgb"], c["mask"])
    if full and GEOMETRIC:
        out["rots"] = rots  # stage 4 runs on the one rotation DINOv2 picks
        out["disk_cache"] = {}
    return out


def pair_features(listing: list[dict], frames: list[dict], title: str | None) -> dict:
    """Raw per-stage evidence for one (listing, capture) pair."""
    L = [x for x in listing if x is not None]
    F = [f for f in frames if f.get("crop") is not None]
    verdicts = [f["placement"]["verdict"] for f in frames]
    feats: dict = {"n_frames_with_item": len(F), "placements": verdicts}
    if not L or not F:
        feats.update(dino_max=0.0, dino_mean=0.0, clip_max=0.0, sem_bc=0.0, sem_title=0.0, colour=0.0)
        if GEOMETRIC:
            feats["lg_inliers"] = 0.0
        return feats

    Ld = np.stack([x["dino"] for x in L])
    # Stage 3: best rotation per (frame, listing photo), then best-of-N / mean of per-frame bests.
    per_frame = [float((f["dino"] @ Ld.T).max()) for f in F]
    feats["dino_max"] = max(per_frame)
    feats["dino_mean"] = float(np.mean(per_frame))

    Lc = np.stack([x["clip"] for x in L])
    feats["clip_max"] = float(max((f["clip"] @ Lc.T).max() for f in F))

    # Stage 2a: do CLIP's readings of the two crops agree on WHAT it is?
    # Bhattacharyya coefficient between the zero-shot distributions.
    bc = [float(np.sqrt(f["zs"] * x["zs"]).sum()) for f in F for x in L]
    feats["sem_bc"] = max(bc)

    # Stage 2b: does the locker crop read as the listing's own title?
    if title:
        labels = VOCAB + [title]
        p = [_zeroshot(f["clip"][None], labels)[0][-1] for f in F]
        feats["sem_title"] = float(np.mean(p))
    else:
        feats["sem_title"] = 0.0

    # Stage 5: colour inside the masks (histogram intersection).
    feats["colour"] = float(max(np.minimum(f["hist"], x["hist"]).sum() for f in F for x in L))

    # Stage 4 (full tier): geometric inliers on the ONE alignment DINOv2 found
    # best for each frame (its rotation, its listing photo). Matching every
    # rotation x photo x frame was measured at 48 LightGlue runs per verify:
    # far outside any budget on this CPU. DINOv2 already knows which pairing
    # is the closest; LightGlue only has to confirm it is the same object.
    if all("rots" in f for f in F) and all("disk" in x for x in L):
        best = 0
        for f in F:
            sims = f["dino"] @ Ld.T  # (rotations, listing photos)
            r, j = np.unravel_index(int(np.argmax(sims)), sims.shape)
            if r not in f["disk_cache"]:
                f["disk_cache"][r] = geometric.disk_features(f["rots"][r])
            best = max(best, geometric.inliers(f["disk_cache"][r], L[j]["disk"]))
        feats["lg_inliers"] = float(np.log1p(best))
    return feats
