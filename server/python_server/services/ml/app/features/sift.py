"""
Phase 2: SIFT Keypoint Feature Extraction.

SIFT (Scale-Invariant Feature Transform) detects unique visual
"landmarks" in images that are robust to:
- Scale changes (item closer/farther from camera)
- Rotation (item placed sideways)
- Moderate lighting changes

Used for direct image-to-image matching (not feature vector comparison).
"""

import cv2
import numpy as np

from ..config import settings
from ..utils.image import preprocess


class SIFTFeatureExtractor:
    """SIFT-based keypoint detection and matching."""

    def __init__(self):
        self.sift = cv2.SIFT_create()
        self.ratio_threshold = settings.sift_ratio_threshold

        # FLANN matcher for fast approximate nearest neighbor search
        index_params = dict(algorithm=1, trees=5)  # FLANN_INDEX_KDTREE
        search_params = dict(checks=50)
        self.flann = cv2.FlannBasedMatcher(index_params, search_params)

    def detect_keypoints(
        self, source: str | bytes | np.ndarray, normalize_light: bool = True
    ) -> tuple[list[cv2.KeyPoint], np.ndarray | None]:
        """
        Detect SIFT keypoints and compute descriptors.

        Returns:
            Tuple of (keypoints list, descriptors array or None).
        """
        img = preprocess(source, normalize=normalize_light)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        keypoints, descriptors = self.sift.detectAndCompute(gray, None)
        return keypoints, descriptors

    def match(
        self,
        source1: str | bytes | np.ndarray,
        source2: str | bytes | np.ndarray,
        normalize_light: bool = True,
    ) -> dict:
        """
        Match keypoints between two images using Lowe's ratio test.

        Args:
            source1: First image (e.g., owner's uploaded photo).
            source2: Second image (e.g., kiosk camera capture).

        Returns:
            Dict with match_ratio, good_matches count, and keypoint counts.
        """
        kp1, des1 = self.detect_keypoints(source1, normalize_light)
        kp2, des2 = self.detect_keypoints(source2, normalize_light)

        if des1 is None or des2 is None or len(des1) < 2 or len(des2) < 2:
            return {
                "match_ratio": 0.0,
                "good_matches": 0,
                "total_keypoints_img1": len(kp1) if kp1 else 0,
                "total_keypoints_img2": len(kp2) if kp2 else 0,
            }

        # knnMatch with k=2 for ratio test
        matches = self.flann.knnMatch(des1, des2, k=2)

        # Lowe's ratio test: keep only distinctive matches
        good_matches = []
        for pair in matches:
            if len(pair) == 2:
                m, n = pair
                if m.distance < self.ratio_threshold * n.distance:
                    good_matches.append(m)

        min_kp = min(len(kp1), len(kp2))
        match_ratio = len(good_matches) / min_kp if min_kp > 0 else 0.0

        return {
            "match_ratio": match_ratio * 100,
            "good_matches": len(good_matches),
            "total_keypoints_img1": len(kp1),
            "total_keypoints_img2": len(kp2),
        }

    def match_multi(
        self,
        original_images: list[str | bytes | np.ndarray],
        kiosk_images: list[str | bytes | np.ndarray],
        normalize_light: bool = True,
    ) -> dict:
        """
        Match multiple original images against multiple kiosk images.

        Returns the best match ratio and aggregated statistics.
        """
        all_ratios = []

        for orig in original_images:
            for kiosk in kiosk_images:
                result = self.match(orig, kiosk, normalize_light)
                all_ratios.append(result["match_ratio"])

        if not all_ratios:
            return {"best_ratio": 0.0, "avg_ratio": 0.0, "all_ratios": []}

        return {
            "best_ratio": float(max(all_ratios)),
            "avg_ratio": float(np.mean(all_ratios)),
            "all_ratios": all_ratios,
        }
