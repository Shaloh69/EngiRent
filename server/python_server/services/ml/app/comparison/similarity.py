"""
Similarity calculation between feature vectors (IMPROVED).

Changes from v1:
- P1: Proper ORB descriptor matching with BFMatcher (Hamming distance)
- P2: SSIM (Structural Similarity Index) comparison
- P2: Spatial pyramid comparison
- P2: HOG similarity
- Handles new feature types from improved traditional extractor
"""

import cv2
import numpy as np
from scipy.spatial.distance import cosine
from scipy.stats import pearsonr

from ..config import settings
from ..utils.image import load_image, preprocess


class SimilarityCalculator:
    """Calculate similarity scores between extracted feature sets."""

    def __init__(self):
        self.weight_color = settings.weight_color
        self.weight_shape = settings.weight_shape
        self.weight_texture = settings.weight_texture
        self.weight_orb = settings.weight_orb
        self.weight_hog = settings.weight_hog
        self.weight_spatial = settings.weight_spatial
        self.weight_ssim = settings.weight_ssim

        # ORB uses Hamming distance (binary descriptors)
        self.bf_matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)

    def compare_traditional(self, features_a: dict, features_b: dict) -> dict:
        """
        Compare two traditional feature sets (improved version).

        Now includes HSV color, spatial pyramid, HOG, SSIM,
        and proper ORB descriptor matching.
        """
        color_sim = self._cosine_similarity(features_a["color"], features_b["color"])
        spatial_sim = self._cosine_similarity(features_a["color_spatial"], features_b["color_spatial"])
        shape_sim = self._shape_similarity(features_a["shape"], features_b["shape"])
        texture_sim = self._correlation_similarity(features_a["texture"], features_b["texture"])
        hog_sim = self._cosine_similarity(features_a["hog"], features_b["hog"])
        orb_sim = self._orb_descriptor_match(
            features_a["orb_descriptors"], features_b["orb_descriptors"]
        )

        overall = (
            color_sim * self.weight_color
            + spatial_sim * self.weight_spatial
            + shape_sim * self.weight_shape
            + texture_sim * self.weight_texture
            + hog_sim * self.weight_hog
            + orb_sim * self.weight_orb
        )

        return {
            "color_similarity": round(color_sim * 100, 2),
            "spatial_similarity": round(spatial_sim * 100, 2),
            "shape_similarity": round(shape_sim * 100, 2),
            "texture_similarity": round(texture_sim * 100, 2),
            "hog_similarity": round(hog_sim * 100, 2),
            "orb_similarity": round(orb_sim * 100, 2),
            "overall_confidence": round(overall * 100, 2),
        }

    def compare_deep(self, features_a: np.ndarray, features_b: np.ndarray) -> float:
        """Compare two deep feature vectors (ResNet50 2048-d)."""
        return round(self._cosine_similarity(features_a, features_b) * 100, 2)

    def compare_ssim(
        self,
        source_a: str | bytes | np.ndarray,
        source_b: str | bytes | np.ndarray,
    ) -> float:
        """
        P2: Structural Similarity Index (SSIM).

        Compares luminance, contrast, and structure patterns.
        Designed to measure "do these look like the same thing to a human?"
        """
        img_a = preprocess(source_a)
        img_b = preprocess(source_b)

        # Resize both to same dimensions
        target = (256, 256)
        img_a = cv2.resize(img_a, target)
        img_b = cv2.resize(img_b, target)

        gray_a = cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY)
        gray_b = cv2.cvtColor(img_b, cv2.COLOR_BGR2GRAY)

        score = self._compute_ssim(gray_a, gray_b)
        return round(max(0.0, score) * 100, 2)

    def _compute_ssim(
        self, img1: np.ndarray, img2: np.ndarray, k1: float = 0.01, k2: float = 0.03
    ) -> float:
        """
        Compute SSIM between two grayscale images.

        Implementation follows Wang et al. (2004).
        """
        c1 = (k1 * 255) ** 2
        c2 = (k2 * 255) ** 2

        img1 = img1.astype(np.float64)
        img2 = img2.astype(np.float64)

        mu1 = cv2.GaussianBlur(img1, (11, 11), 1.5)
        mu2 = cv2.GaussianBlur(img2, (11, 11), 1.5)

        mu1_sq = mu1 ** 2
        mu2_sq = mu2 ** 2
        mu1_mu2 = mu1 * mu2

        sigma1_sq = cv2.GaussianBlur(img1 ** 2, (11, 11), 1.5) - mu1_sq
        sigma2_sq = cv2.GaussianBlur(img2 ** 2, (11, 11), 1.5) - mu2_sq
        sigma12 = cv2.GaussianBlur(img1 * img2, (11, 11), 1.5) - mu1_mu2

        numerator = (2 * mu1_mu2 + c1) * (2 * sigma12 + c2)
        denominator = (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)

        ssim_map = numerator / denominator
        return float(ssim_map.mean())

    def _orb_descriptor_match(
        self, desc_a: np.ndarray | None, desc_b: np.ndarray | None
    ) -> float:
        """
        P1: Proper ORB descriptor-to-descriptor matching.

        Uses BFMatcher with Hamming distance and Lowe's ratio test,
        instead of averaging descriptors into a single meaningless vector.
        """
        if desc_a is None or desc_b is None:
            return 0.0
        if len(desc_a) < 2 or len(desc_b) < 2:
            return 0.0

        # kNN match with k=2 for ratio test
        matches = self.bf_matcher.knnMatch(desc_a, desc_b, k=2)

        good = 0
        for pair in matches:
            if len(pair) == 2:
                m, n = pair
                if m.distance < 0.75 * n.distance:
                    good += 1

        min_desc = min(len(desc_a), len(desc_b))
        return good / min_desc if min_desc > 0 else 0.0

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
        return (corr + 1) / 2
