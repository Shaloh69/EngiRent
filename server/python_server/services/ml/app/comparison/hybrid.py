"""
Hybrid Verification Engine (IMPROVED) - Combines all methods.

Changes from v1:
- P0: Background removal in all extraction paths
- P1: Image quality gate (reject blurry/dark/overexposed)
- P1: SIFT now uses RANSAC inlier ratio instead of raw match ratio
- P2: SSIM structural similarity as a separate scoring channel
- P2: Smarter score aggregation (trimmed mean, not just max)
- P2: Requires minimum N good pairs (not just 1 outlier)
- P3: Perceptual hash pre-filter for obvious mismatches

Pipeline:
  1. Quality gate → reject bad images early
  2. pHash pre-filter → reject obvious mismatches cheaply
  3. Traditional CV (HSV color, spatial pyramid, shape, texture, HOG, ORB)
  4. SIFT keypoint matching + RANSAC geometric verification
  5. SSIM structural similarity
  6. Deep learning (ResNet50) features
  7. OCR serial number check
  8. Hybrid weighted score with trimmed-mean aggregation → decision
"""

import logging
import time

import numpy as np

from ..config import settings
from ..features.deep import DeepFeatureExtractor
from ..features.phash import is_obvious_mismatch, phash_similarity
from ..features.sift import SIFTFeatureExtractor
from ..features.traditional import TraditionalFeatureExtractor
from ..utils.ocr import extract_text, match_serial_numbers
from ..utils.quality import check_quality
from .similarity import SimilarityCalculator

logger = logging.getLogger(__name__)


class HybridVerifier:
    """
    Multi-method item verification engine (v2).

    Workflow:
        1. Owner uploads 3+ images -> extract & store features.
        2. Kiosk captures 3-5 images -> extract features.
        3. Quality gate + pHash pre-filter.
        4. Compare all pairs with all methods.
        5. Trimmed-mean hybrid score -> decision.
    """

    def __init__(self):
        self.traditional = TraditionalFeatureExtractor()
        self.sift = SIFTFeatureExtractor()
        self.deep = DeepFeatureExtractor()
        self.similarity = SimilarityCalculator()

    def extract_reference_features(self, image_sources: list[str | bytes | np.ndarray]) -> dict:
        """
        Extract and store features from owner's uploaded reference images.

        Called once when the item listing is created.
        """
        traditional_features = self.traditional.extract_batch(image_sources)

        deep_features = []
        if settings.enable_deep_learning:
            deep_features = self.deep.extract_batch(image_sources)

        ocr_texts = []
        if settings.enable_ocr:
            for src in image_sources:
                ocr_texts.append(extract_text(src))

        return {
            "traditional": traditional_features,
            "deep": [f.tolist() for f in deep_features],
            "ocr_texts": ocr_texts,
            "image_count": len(image_sources),
        }

    def verify(
        self,
        original_sources: list[str | bytes | np.ndarray],
        kiosk_sources: list[str | bytes | np.ndarray],
        attempt_number: int = 1,
        reference_features: dict | None = None,
        mode: str = "fast",
    ) -> dict:
        """
        Full hybrid verification with all improvements.

        Args:
            mode: "fast" for the check a student is waiting on at the locker,
                "full" for the background re-run that assists a human reviewer.
                The pipeline is identical; only the time budget differs, so a
                full run is the same evidence the fast run would have gathered
                if it had been allowed to finish.

        Returns:
            Complete verification result with decision and diagnostics.
        """
        # D-87: a verify must ALWAYS answer. A deposit waits on this call, and
        # on 2026-09-18 one ran 7+ minutes with a bay reserved and an item
        # inside it. Past this deadline the optional stages are skipped rather
        # than the request being cut off — a real verdict from less evidence,
        # clearly marked, beats silence.
        #
        # D-87b: which deadline depends on who is waiting. See config.py.
        # NOTE deliberately: "full" does not raise `max_image_size`. The win is
        # that every stage RUNS, not that it sees more pixels — SIFT saturates
        # well below 1280, SSIM resizes to 640 and ResNet to 224. Keeping one
        # resolution also keeps the two tiers comparable: when the full run
        # disagrees with the fast one, it is because of the extra stages, not
        # because it was looking at a different image.
        full_run = mode == "full"
        budget = (
            settings.verify_full_budget_seconds
            if full_run
            else settings.verify_time_budget_seconds
        )
        started_at = time.monotonic()
        deadline = started_at + budget
        skipped_stages: list[str] = []

        def out_of_time() -> bool:
            return time.monotonic() > deadline

        # --- Step 1: Quality gate ---
        logger.info("Step 1: Image quality check")
        quality_issues = []
        for i, src in enumerate(kiosk_sources):
            qr = check_quality(
                src,
                min_blur_score=settings.quality_min_blur_score,
                min_brightness=settings.quality_min_brightness,
                max_brightness=settings.quality_max_brightness,
            )
            if not qr.passed:
                quality_issues.append({"image_index": i, **qr.to_dict()})

        if quality_issues and len(quality_issues) == len(kiosk_sources):
            # ALL kiosk images failed quality — ask for retake
            return {
                "verified": False,
                "decision": "RETRY",
                "message": (
                    f"All kiosk images failed quality check. "
                    f"Issues: {quality_issues[0]['issues']}. "
                    f"Attempt {attempt_number}/{settings.max_retry_attempts}."
                ),
                "confidence": 0.0,
                "attempt_number": attempt_number,
                "method_scores": self._empty_method_scores(),
                "ocr": {"match": False, "details": None},
                "quality_issues": quality_issues,
                "all_traditional_scores": [],
                "sift_all_ratios": [],
            }

        # --- Step 2: Perceptual hash pre-filter ---
        logger.info("Step 2: Perceptual hash pre-filter")
        phash_scores = []
        obvious_mismatch_count = 0
        for orig in original_sources:
            for kiosk in kiosk_sources:
                score = phash_similarity(orig, kiosk)
                phash_scores.append(score)
                if is_obvious_mismatch(orig, kiosk, settings.phash_obvious_mismatch_threshold):
                    obvious_mismatch_count += 1

        total_pairs = len(original_sources) * len(kiosk_sources)
        if total_pairs > 0 and obvious_mismatch_count == total_pairs:
            # ALL pairs are obvious mismatches — skip expensive pipeline
            return {
                "verified": False,
                "decision": "RETRY" if attempt_number < settings.max_retry_attempts else "REJECTED",
                "message": (
                    "Items appear to be completely different. "
                    f"Attempt {attempt_number}/{settings.max_retry_attempts}."
                ),
                "confidence": round(max(phash_scores) if phash_scores else 0.0, 2),
                "attempt_number": attempt_number,
                "method_scores": self._empty_method_scores(),
                "ocr": {"match": False, "details": None},
                "quality_issues": quality_issues,
                "all_traditional_scores": [],
                "sift_all_ratios": [],
            }

        phash_best = max(phash_scores) if phash_scores else 0.0

        # --- Step 3: Traditional CV ---
        logger.info("Step 3: Traditional CV comparison")
        if reference_features and "traditional" in reference_features:
            orig_traditional = reference_features["traditional"]
        else:
            orig_traditional = self.traditional.extract_batch(original_sources)

        kiosk_traditional = self.traditional.extract_batch(kiosk_sources)

        traditional_scores = []
        for kiosk_feat in kiosk_traditional:
            for orig_feat in orig_traditional:
                result = self.similarity.compare_traditional(orig_feat, kiosk_feat)
                traditional_scores.append(result["overall_confidence"])

        traditional_agg = self._aggregate_scores(traditional_scores)

        # --- Step 4: SIFT with RANSAC ---
        if out_of_time():
            skipped_stages.append("sift")
            logger.warning("Step 4 SKIPPED: over the %.0fs %s budget", budget, mode)
            sift_result = {"best_ratio": 0.0, "best_inlier_ratio": 0.0, "all_ratios": []}
            sift_best_inlier = 0.0
            sift_best_match = 0.0
            sift_score = 0.0
        else:
            logger.info("Step 4: SIFT keypoint matching + RANSAC")
            sift_result = self.sift.match_multi(original_sources, kiosk_sources)
            # Use inlier ratio (geometrically verified) instead of raw match ratio
            sift_best_inlier = sift_result.get("best_inlier_ratio", 0.0)
            sift_best_match = sift_result["best_ratio"]
            # Blend: 70% inlier ratio (more reliable) + 30% match ratio
            sift_score = sift_best_inlier * 0.7 + sift_best_match * 0.3

        # --- Step 5: SSIM ---
        ssim_scores = []
        if out_of_time():
            skipped_stages.append("ssim")
            logger.warning("Step 5 SKIPPED: over the %.0fs %s budget", budget, mode)
            ssim_agg = 0.0
        else:
            logger.info("Step 5: SSIM structural similarity")
            for orig in original_sources:
                for kiosk in kiosk_sources:
                    ssim = self.similarity.compare_ssim(orig, kiosk)
                    ssim_scores.append(ssim)
            ssim_agg = self._aggregate_scores(ssim_scores)

        # --- Step 6: Deep Learning ---
        deep_agg = 0.0
        deep_ran = False
        if settings.enable_deep_learning and out_of_time():
            skipped_stages.append("deep_learning")
            logger.warning("Step 6 SKIPPED: over the %.0fs %s budget", budget, mode)
        elif settings.enable_deep_learning:
            deep_ran = True
            logger.info("Step 6: Deep learning comparison")
            if reference_features and "deep" in reference_features and reference_features["deep"]:
                orig_deep = [np.array(f) for f in reference_features["deep"]]
            else:
                orig_deep = self.deep.extract_batch(original_sources)

            kiosk_deep = self.deep.extract_batch(kiosk_sources)

            deep_scores = []
            for kf in kiosk_deep:
                for of_ in orig_deep:
                    score = self.similarity.compare_deep(of_, kf)
                    deep_scores.append(score)

            deep_agg = self._aggregate_scores(deep_scores)

        # --- Step 7: OCR ---
        ocr_match = False
        ocr_details = None
        if settings.enable_ocr and out_of_time():
            skipped_stages.append("ocr")
            logger.warning("Step 7 SKIPPED: over the %.0fs %s budget", budget, mode)
        elif settings.enable_ocr:
            logger.info("Step 7: OCR serial number check")
            orig_texts = (
                reference_features.get("ocr_texts", [])
                if reference_features
                else [extract_text(s) for s in original_sources]
            )
            kiosk_texts = [extract_text(s) for s in kiosk_sources]
            ocr_match, ocr_details = match_serial_numbers(orig_texts, kiosk_texts)

        # --- Step 8: Hybrid score ---
        #
        # D-87: only the channels that actually RAN contribute, and their
        # weights are renormalised over those. Scoring a skipped stage as 0
        # would drag an honest match down and read as evidence against the
        # item, which is the opposite of the truth: we simply did not look.
        channels = [
            (traditional_agg, settings.weight_traditional, True),
            (deep_agg, settings.weight_deep_learning, settings.enable_deep_learning and deep_ran),
            (sift_score, settings.weight_sift, "sift" not in skipped_stages),
            (ssim_agg, settings.weight_ssim_hybrid, "ssim" not in skipped_stages),
            (phash_best, settings.weight_phash_hybrid, True),
        ]
        total_w = sum(w for _, w, ran in channels if ran)
        final_score = (
            sum(score * w for score, w, ran in channels if ran) / total_w if total_w > 0 else 0.0
        )

        # OCR bonus
        if ocr_match:
            final_score = min(100.0, final_score + 10.0)

        # P2: Check minimum good pairs — don't trust a single outlier
        good_pair_count = sum(1 for s in traditional_scores if s >= settings.threshold_manual_review)
        if good_pair_count < settings.min_good_pairs and final_score >= settings.threshold_verified:
            # Demote: only 1 good pair but score looks high — suspicious
            final_score = min(final_score, settings.threshold_verified - 1)
            logger.warning(
                "Score demoted: only %d good pairs (need %d)",
                good_pair_count,
                settings.min_good_pairs,
            )

        # --- Decision ---
        decision, message = self._make_decision(final_score, attempt_number)

        # D-87: a check that ran out of time looked at less than it should
        # have. It still answers — that is the whole point — but partial
        # evidence must never approve an item or reject it outright. Send it to
        # a human instead, the same rule the server already applies when this
        # service cannot be reached at all.
        elapsed = time.monotonic() - started_at
        degraded = bool(skipped_stages)
        if degraded:
            logger.warning(
                "Verify DEGRADED after %.1fs: skipped %s. Decision %s -> %s",
                elapsed,
                ", ".join(skipped_stages),
                decision,
                "PENDING" if decision == "APPROVED" else ("RETRY" if decision == "REJECTED" else decision),
            )
            if decision == "APPROVED":
                decision = "PENDING"
                message = (
                    "Checked against part of the evidence only (skipped: "
                    + ", ".join(skipped_stages)
                    + "). Sent for a quick human check."
                )
            elif decision == "REJECTED":
                decision = "RETRY" if attempt_number < settings.max_retry_attempts else "PENDING"
                message = (
                    "Could not finish the full check in time (skipped: "
                    + ", ".join(skipped_stages)
                    + "). Please try again."
                )

        return {
            "verified": decision == "APPROVED",
            "decision": decision,
            "message": message,
            "confidence": round(final_score, 2),
            "attempt_number": attempt_number,
            # D-87 diagnostics: how long the check took, and whether any stage
            # was skipped to keep the promise that this call always answers.
            "elapsed_seconds": round(elapsed, 2),
            "degraded": degraded,
            "skipped_stages": skipped_stages,
            # D-87b: which tier produced this verdict. A stored row without it
            # cannot be read later — an 81 from a fast run and an 81 from a full
            # run mean very different things about the item.
            "mode": mode,
            "method_scores": {
                "traditional_best": round(max(traditional_scores) if traditional_scores else 0.0, 2),
                "traditional_aggregated": round(traditional_agg, 2),
                "sift_best_match": round(sift_best_match, 2),
                "sift_best_inlier": round(sift_best_inlier, 2),
                "sift_combined": round(sift_score, 2),
                "ssim_aggregated": round(ssim_agg, 2),
                "deep_learning_aggregated": round(deep_agg, 2),
                "phash_best": round(phash_best, 2),
            },
            "ocr": {
                "match": ocr_match,
                "details": ocr_details,
            },
            "quality_issues": quality_issues,
            "good_pair_count": good_pair_count,
            "all_traditional_scores": [round(s, 2) for s in traditional_scores],
            "sift_all_ratios": sift_result.get("all_ratios", []),
        }

    def _aggregate_scores(self, scores: list[float]) -> float:
        """
        P2: Smart score aggregation.

        Instead of just taking max (which a single outlier can game):
        - "trimmed_mean": Drop lowest and highest, average the rest.
        - "median": Middle value, robust to outliers.
        - "max": Original behavior (kept as fallback).
        """
        if not scores:
            return 0.0

        method = settings.score_aggregation

        if len(scores) <= 2 or method == "max":
            return float(max(scores))

        if method == "median":
            return float(np.median(scores))

        # trimmed_mean: drop bottom 20% and top 10%, average rest
        sorted_scores = sorted(scores)
        n = len(sorted_scores)
        low_cut = max(1, int(n * 0.2))
        high_cut = max(low_cut + 1, n - max(1, int(n * 0.1)))
        trimmed = sorted_scores[low_cut:high_cut]
        return float(np.mean(trimmed)) if trimmed else float(max(scores))

    def _make_decision(self, confidence: float, attempt_number: int) -> tuple[str, str]:
        """
        Map confidence score to a verification decision.

        >= 85%: APPROVED (auto-approve, payment released)
        60-84%: PENDING  (manual admin review)
        < 60%:  RETRY or REJECTED
        """
        if confidence >= settings.threshold_verified:
            return "APPROVED", "Item verified successfully."

        if confidence >= settings.threshold_manual_review:
            return "PENDING", "Manual review required by admin."

        if attempt_number < settings.max_retry_attempts:
            return (
                "RETRY",
                f"Verification failed. Please reposition item. "
                f"Attempt {attempt_number}/{settings.max_retry_attempts}.",
            )

        return "REJECTED", "Verification failed after max attempts. Transaction cancelled."

    def _empty_method_scores(self) -> dict:
        return {
            "traditional_best": 0.0,
            "traditional_aggregated": 0.0,
            "sift_best_match": 0.0,
            "sift_best_inlier": 0.0,
            "sift_combined": 0.0,
            "ssim_aggregated": 0.0,
            "deep_learning_aggregated": 0.0,
            "phash_best": 0.0,
        }
