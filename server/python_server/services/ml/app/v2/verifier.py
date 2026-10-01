"""
The v2 verifier: the service-facing wrapper around app/v2/pipeline.py.

It answers in the same shape as the v1 `HybridVerifier.verify`, so the Node
server that is deployed today keeps working unchanged, and adds:

  pipeline       "v2"
  placement      stage P's verdict for the capture, with the message to show
  reposition     true when the item must be moved rather than judged. The
                 decision is then RETRY (today's Node re-opens the door on a
                 RETRY), and a Node that knows this field keeps the attempt
                 out of the attempt-2 review escalation (closes D-104)
  evidence       the raw per-stage evidence, for the admin reviewer
  stage_seconds  where the time went

Placement policy (decided on the real captures, 2026-09-25):
  - EMPTY or MULTIPLE on most frames: always reposition. There is no item to
    judge, or no way to know which object is the item.
  - TRUNCATED or OFF_CENTER on most frames: reposition only when the score is
    below the auto-approve line. A cut-off item that is still recognised
    beyond doubt is not sent back; one that is not recognised gets a chance to
    be placed properly before anyone calls it the wrong item.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from typing import Callable

import cv2
import numpy as np

from ..config import settings
from ..utils.image import load_image
from . import fusion, pipeline

Progress = Callable[[str, float], None]

HARD_REPOSITION = {"EMPTY", "MULTIPLE"}
SOFT_REPOSITION = {"TRUNCATED", "OFF_CENTER"}

# Stage 0 on what the camera actually saw: a frame whose floor reads this dark
# was taken with the locker light off (the 2026-09-24 admin captures read ~28).
MIN_FLOOR_BRIGHTNESS = 60.0


def _floor_brightness(img_bgr: np.ndarray) -> float:
    g = cv2.cvtColor(cv2.resize(img_bgr, (320, 180)), cv2.COLOR_BGR2GRAY)
    return float(np.percentile(g, 75))


MODELS_READY = False


def warm() -> None:
    """Load every v2 model once (called in a thread at service startup)."""
    log = logging.getLogger(__name__)
    t = time.monotonic()
    try:
        from . import embed, listing

        embed._get("dino")
        embed._get("clip")
        listing._session()
        if pipeline.GEOMETRIC:
            from . import geometric

            geometric._models()
        global MODELS_READY
        MODELS_READY = True
        log.info("v2 models loaded in %.0fs", time.monotonic() - t)
    except Exception:
        log.exception("v2 model warm-up failed; the first verify will retry the load")


class V2Verifier:
    def verify(
        self,
        original_sources: list,
        kiosk_sources: list,
        attempt_number: int = 1,
        mode: str = "fast",
        progress: Progress | None = None,
        **_ignored,
    ) -> dict:
        full = mode == "full"
        budget = settings.verify_full_budget_seconds if full else settings.verify_time_budget_seconds
        t0 = time.monotonic()
        stage_s: dict[str, float] = {}

        def tick(stage: str, frac: float):
            if progress:
                try:
                    progress(stage, frac)
                except Exception:  # a progress listener must never break a verdict
                    pass

        # --- Stage 0: was the light on? ---
        tick("quality", 0.02)
        kiosk_imgs = [load_image(s) for s in kiosk_sources]
        quality_issues = []
        for i, img in enumerate(kiosk_imgs):
            b = _floor_brightness(img)
            if b < MIN_FLOOR_BRIGHTNESS:
                quality_issues.append({
                    "image_index": i, "passed": False, "blur_score": 0.0, "brightness": round(b, 2),
                    "coverage_percent": -100.0,
                    "issues": [f"Locker too dark to see the item (floor brightness {b:.0f}, need >= {MIN_FLOOR_BRIGHTNESS:.0f})"],
                })
        if len(quality_issues) == len(kiosk_imgs):
            return self._result(
                attempt_number, mode, t0, stage_s, decision="RETRY", confidence=0.0, reposition=False,
                message="The locker camera could not see: the light appears to be off. Please try again.",
                quality_issues=quality_issues, placement={"verdict": "UNSEEN", "message": ""}, evidence={},
                quality_blocked=True,
            )

        # --- Stage P + 1a + 2 + 3 on the locker frames ---
        tick("locating the item", 0.08)
        s = time.monotonic()
        frames = []
        for i, img in enumerate(kiosk_imgs):
            frames.append(pipeline.prepare_frame(img, full))
            tick("checking the item", 0.08 + 0.5 * (i + 1) / len(kiosk_imgs))
        stage_s["locker_frames"] = time.monotonic() - s
        for f in frames:
            for k, v in f["times"].items():
                stage_s[k] = stage_s.get(k, 0.0) + v

        verdicts = [f["placement"]["verdict"] for f in frames]
        common, n = Counter(verdicts).most_common(1)[0]
        majority = n * 2 >= len(verdicts)
        rep_frame = next(f for f in frames if f["placement"]["verdict"] == common)
        placement = {**rep_frame["placement"], "per_frame": verdicts}

        if majority and common in HARD_REPOSITION:
            return self._result(
                attempt_number, mode, t0, stage_s, decision="RETRY", confidence=0.0, reposition=True,
                message=placement["message"], placement=placement, evidence={"placements": verdicts},
                quality_issues=quality_issues,
            )

        # --- Stage 1b: the listing photos (cached by content) ---
        tick("reading the listing photos", 0.62)
        s = time.monotonic()
        listing = [pipeline.prepare_listing(load_image(src)) for src in original_sources]
        stage_s["listing_photos"] = time.monotonic() - s

        # --- Stages 2/3 evidence + Stage 7 fusion ---
        tick("comparing", 0.85)
        s = time.monotonic()
        feats = pipeline.pair_features(listing, frames, title=None)
        stage_s["compare"] = time.monotonic() - s
        # Every v2 stage has already run by this point, so running over the
        # budget costs no evidence: it is reported, never punished. (A first
        # version fell back to the smaller model here, which threw away
        # evidence already gathered and demoted a correct 94 to PENDING on a
        # cold start. Found by the end-to-end smoke run, 2026-09-25.)
        # `degraded` means a stage was really missing, e.g. no crop was usable
        # for the semantic stage; fusion then scores with the model that
        # never used it.
        over_budget = time.monotonic() - t0 > budget
        final, stage_set = fusion.score(mode, feats)
        degraded = stage_set != fusion.CHOSEN[mode]

        decision, message = self._decide(final, attempt_number)
        reposition = False
        if majority and common in SOFT_REPOSITION and decision != "APPROVED":
            reposition = True
            decision = "RETRY"
            message = placement["message"]
        elif degraded and decision == "APPROVED":
            decision, message = "PENDING", "Checked against part of the evidence only. Sent for a quick human check."

        tick("done", 1.0)
        evidence = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in feats.items()}
        evidence["stage_set"] = stage_set
        evidence["over_budget"] = over_budget
        return self._result(
            attempt_number, mode, t0, stage_s, decision=decision, confidence=round(final, 2),
            reposition=reposition, message=message, placement=placement, evidence=evidence,
            quality_issues=quality_issues, degraded=degraded,
            skipped=["semantic"] if degraded else [],
            deep=feats.get("dino_max", 0.0) * 100,
        )

    @staticmethod
    def _decide(conf: float, attempt: int) -> tuple[str, str]:
        if conf >= settings.threshold_verified:
            return "APPROVED", "Item verified successfully."
        if conf >= settings.threshold_manual_review:
            return "PENDING", "Manual review required by admin."
        if attempt < settings.max_retry_attempts:
            return "RETRY", f"Item did not match the listing. Attempt {attempt}/{settings.max_retry_attempts}."
        return "REJECTED", "Verification failed after max attempts."

    @staticmethod
    def _result(attempt, mode, t0, stage_s, *, decision, confidence, reposition, message, placement,
                evidence, quality_issues, degraded=False, skipped=None, deep=0.0, quality_blocked=False) -> dict:
        return {
            "verified": decision == "APPROVED",
            "decision": decision,
            "message": message,
            "confidence": confidence,
            "attempt_number": attempt,
            "elapsed_seconds": round(time.monotonic() - t0, 2),
            "degraded": degraded,
            "skipped_stages": skipped or [],
            "mode": mode,
            "method_scores": {
                "traditional_best": 0.0, "traditional_aggregated": 0.0, "sift_best_match": 0.0,
                "sift_best_inlier": 0.0, "sift_combined": 0.0, "ssim_aggregated": 0.0,
                "deep_learning_aggregated": round(deep, 2), "phash_best": 0.0,
            },
            "ocr": {"match": False, "details": None},
            "quality_issues": quality_issues,
            "good_pair_count": 0,
            "all_traditional_scores": [],
            "sift_all_ratios": [],
            "pipeline": "v2",
            "placement": placement,
            "reposition": reposition,
            "quality_blocked": quality_blocked,
            "evidence": evidence,
            "stage_seconds": {k: round(v, 3) for k, v in stage_s.items()},
        }
