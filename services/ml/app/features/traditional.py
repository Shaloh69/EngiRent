"""
Phase 1: Traditional Computer Vision Feature Extraction.

Extracts four types of features from item images:
- Color histograms (what colors, where?)
- Shape descriptors via Hu moments (round? rectangular? with buttons?)
- Texture patterns via LBP (smooth? rough? has text?)
- ORB keypoints (visual "fingerprints")
"""

import cv2
import numpy as np
from skimage.feature import local_binary_pattern

from ..config import settings
from ..utils.image import preprocess


class TraditionalFeatureExtractor:
    """Extract traditional CV features from item images."""

    def __init__(self):
        self.orb = cv2.ORB_create(nfeatures=settings.orb_features_count)
        self.color_bins = settings.color_hist_bins
        self.lbp_points = settings.lbp_points
        self.lbp_radius = settings.lbp_radius

    def extract(self, source: str | bytes | np.ndarray, normalize_light: bool = True) -> dict:
        """
        Extract all traditional features from a single image.

        Args:
            source: File path, raw bytes, or numpy array.
            normalize_light: Apply CLAHE lighting normalization.

        Returns:
            Dict with 'color' (96-d), 'shape' (7-d), 'texture' (59-d), 'orb' (32-d).
        """
        img = preprocess(source, normalize=normalize_light)
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        return {
            "color": self._color_histogram(img_rgb),
            "shape": self._shape_descriptors(gray),
            "texture": self._texture_lbp(gray),
            "orb": self._orb_features(gray),
        }

    def _color_histogram(self, img_rgb: np.ndarray) -> np.ndarray:
        """
        Color distribution across R, G, B channels.

        Each channel produces a histogram with `color_bins` bins,
        concatenated into a single normalized vector.
        """
        histograms = []
        for channel in range(3):
            hist = cv2.calcHist([img_rgb], [channel], None, [self.color_bins], [0, 256])
            histograms.append(hist)

        color_hist = np.concatenate(histograms).flatten()
        total = color_hist.sum()
        if total > 0:
            color_hist = color_hist / total
        return color_hist  # 96-dimensional (32 * 3)

    def _shape_descriptors(self, gray: np.ndarray) -> np.ndarray:
        """
        Object geometry via Hu moments (rotation-invariant).

        Finds the largest contour and computes 7 Hu moment values,
        log-transformed for numerical stability.
        """
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return np.zeros(7)

        largest = max(contours, key=cv2.contourArea)
        moments = cv2.moments(largest)
        hu = cv2.HuMoments(moments).flatten()

        # Log transform to make values comparable
        return -np.sign(hu) * np.log10(np.abs(hu) + 1e-10)  # 7-dimensional

    def _texture_lbp(self, gray: np.ndarray) -> np.ndarray:
        """
        Surface texture via Local Binary Patterns.

        Captures micro-patterns like smooth/rough/text.
        """
        lbp = local_binary_pattern(gray, P=self.lbp_points, R=self.lbp_radius, method="uniform")
        n_bins = self.lbp_points + 2  # uniform LBP produces P+2 unique values
        hist, _ = np.histogram(lbp.ravel(), bins=n_bins, range=(0, n_bins))
        total = hist.sum()
        if total > 0:
            hist = hist / total
        return hist.astype(np.float64)  # 10-dimensional (P+2)

    def _orb_features(self, gray: np.ndarray) -> np.ndarray:
        """
        ORB keypoint descriptors aggregated into a single vector.

        Scale/rotation invariant "fingerprint" of visual landmarks.
        """
        _, descriptors = self.orb.detectAndCompute(gray, None)

        if descriptors is not None and len(descriptors) > 0:
            return np.mean(descriptors, axis=0).astype(np.float64)  # 32-dimensional

        return np.zeros(32)

    def extract_batch(
        self, sources: list[str | bytes | np.ndarray], normalize_light: bool = True
    ) -> list[dict]:
        """Extract features from multiple images."""
        return [self.extract(src, normalize_light) for src in sources]
