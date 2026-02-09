"""
Hybrid Verification Engine - Combines all three phases.

Phase 1: Traditional CV (color + shape + texture + ORB)
Phase 2: SIFT keypoint matching
Phase 3: Deep learning (ResNet50) + OCR serial number check

The hybrid scorer combines results from all methods with configurable
weights to produce a final verification decision.
"""

import logging

import numpy as np

from ..config import settings
from ..features.deep import DeepFeatureExtractor
from ..features.sift import SIFTFeatureExtractor
from ..features.traditional import TraditionalFeatureExtractor
from ..utils.ocr import extract_text, match_serial_numbers
from .similarity import SimilarityCalculator

logger = logging.getLogger(__name__)


class HybridVerifier:
    """
    Multi-method item verification engine.

    Workflow:
        1. Owner uploads 3+ images -> extract & store features.
        2. Kiosk captures 3-5 images -> extract features.
        3. Compare all pairs -> hybrid weighted score -> decision.
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

        Returns:
            Dict containing all extracted features for storage.
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
    ) -> dict:
        """
        Full hybrid verification: compare original images with kiosk images.

        Args:
            original_sources: Owner's uploaded images (or paths).
            kiosk_sources: Kiosk camera captures.
            attempt_number: Current retry attempt (1-10).
            reference_features: Pre-extracted features (optional, saves recomputing).

        Returns:
            Complete verification result with decision.
        """
        # --- Phase 1: Traditional CV ---
        logger.info("Running Phase 1: Traditional CV comparison")
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

        traditional_best = max(traditional_scores) if traditional_scores else 0.0
        traditional_avg = float(np.mean(traditional_scores)) if traditional_scores else 0.0

        # --- Phase 2: SIFT Matching ---
        logger.info("Running Phase 2: SIFT keypoint matching")
        sift_result = self.sift.match_multi(original_sources, kiosk_sources)
        sift_best = sift_result["best_ratio"]

        # --- Phase 3: Deep Learning ---
        deep_best = 0.0
        if settings.enable_deep_learning:
            logger.info("Running Phase 3: Deep learning comparison")
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

            deep_best = max(deep_scores) if deep_scores else 0.0

        # --- OCR Serial Number Check (bonus) ---
        ocr_match = False
        ocr_details = None
        if settings.enable_ocr:
            logger.info("Running OCR serial number check")
            orig_texts = (
                reference_features.get("ocr_texts", [])
                if reference_features
                else [extract_text(s) for s in original_sources]
            )
            kiosk_texts = [extract_text(s) for s in kiosk_sources]
            ocr_match, ocr_details = match_serial_numbers(orig_texts, kiosk_texts)

        # --- Hybrid Score ---
        if settings.enable_deep_learning:
            final_score = (
                traditional_best * settings.weight_traditional
                + deep_best * settings.weight_deep_learning
                + sift_best * settings.weight_sift
            )
        else:
            # Without deep learning, reweight traditional + SIFT
            final_score = traditional_best * 0.65 + sift_best * 0.35

        # OCR bonus: if serial numbers match, boost confidence
        if ocr_match:
            final_score = min(100.0, final_score + 10.0)

        # --- Decision ---
        decision, message = self._make_decision(final_score, attempt_number)

        return {
            "verified": decision == "APPROVED",
            "decision": decision,
            "message": message,
            "confidence": round(final_score, 2),
            "attempt_number": attempt_number,
            "method_scores": {
                "traditional_best": round(traditional_best, 2),
                "traditional_avg": round(traditional_avg, 2),
                "sift_best": round(sift_best, 2),
                "deep_learning_best": round(deep_best, 2),
            },
            "ocr": {
                "match": ocr_match,
                "details": ocr_details,
            },
            "all_traditional_scores": [round(s, 2) for s in traditional_scores],
            "sift_all_ratios": sift_result.get("all_ratios", []),
        }

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
