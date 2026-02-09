"""
Similarity calculation between feature vectors.

Supports Phase 1 (traditional CV) and Phase 3 (deep learning) features.
"""

import numpy as np
from scipy.spatial.distance import cosine
from scipy.stats import pearsonr

from ..config import settings


class SimilarityCalculator:
    """Calculate similarity scores between extracted feature sets."""

    def __init__(self):
        self.weight_color = settings.weight_color
        self.weight_shape = settings.weight_shape
        self.weight_texture = settings.weight_texture
        self.weight_orb = settings.weight_orb

    def compare_traditional(self, features_a: dict, features_b: dict) -> dict:
        """
        Compare two traditional feature sets.

        Args:
            features_a: Features from image A (e.g., owner upload).
            features_b: Features from image B (e.g., kiosk capture).

        Returns:
            Dict with per-feature scores and weighted overall confidence.
        """
        color_sim = self._cosine_similarity(features_a["color"], features_b["color"])
        shape_sim = self._shape_similarity(features_a["shape"], features_b["shape"])
        texture_sim = self._correlation_similarity(features_a["texture"], features_b["texture"])
        orb_sim = self._cosine_similarity(features_a["orb"], features_b["orb"])

        overall = (
            color_sim * self.weight_color
            + shape_sim * self.weight_shape
            + texture_sim * self.weight_texture
            + orb_sim * self.weight_orb
        )

        return {
            "color_similarity": round(color_sim * 100, 2),
            "shape_similarity": round(shape_sim * 100, 2),
            "texture_similarity": round(texture_sim * 100, 2),
            "orb_similarity": round(orb_sim * 100, 2),
            "overall_confidence": round(overall * 100, 2),
        }

    def compare_deep(self, features_a: np.ndarray, features_b: np.ndarray) -> float:
        """
        Compare two deep feature vectors (ResNet50 2048-d).

        Returns:
            Similarity score as percentage (0-100).
        """
        return round(self._cosine_similarity(features_a, features_b) * 100, 2)

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Cosine similarity clamped to [0, 1]."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        sim = 1 - cosine(a, b)
        return max(0.0, min(1.0, sim))

    def _shape_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Shape similarity via inverse distance of Hu moments."""
        diff = np.sum(np.abs(a - b))
        return 1.0 / (1.0 + diff)

    def _correlation_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Pearson correlation mapped to [0, 1]."""
        if np.std(a) == 0 or np.std(b) == 0:
            return 0.0
        corr, _ = pearsonr(a, b)
        return (corr + 1) / 2  # Map [-1, 1] to [0, 1]
