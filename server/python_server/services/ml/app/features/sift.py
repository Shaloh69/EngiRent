"""
Phase 2: SIFT Keypoint Feature Extraction (IMPROVED).

Changes from v1:
- P1: RANSAC homography verification after Lowe's ratio test
- P0: Background removal before keypoint detection
- P0: White balance + CLAHE preprocessing

SIFT detects unique visual "landmarks" robust to scale, rotation,
and moderate lighting changes. RANSAC ensures matched keypoints
are geometrically consistent (not random false positives).
"""

import cv2
import numpy as np

from ..config import settings
from ..utils.background import get_item_crop, remove_background_grabcut
from ..utils.image import preprocess


class SIFTFeatureExtractor:
    """SIFT-based keypoint detection and matching with RANSAC verification."""

    def __init__(self):
        self.sift = cv2.SIFT_create()
        self.ratio_threshold = settings.sift_ratio_threshold

        # FLANN matcher for fast approximate nearest neighbor search
        index_params = dict(algorithm=1, trees=5)  # FLANN_INDEX_KDTREE
        search_params = dict(checks=50)
        self.flann = cv2.FlannBasedMatcher(index_params, search_params)

    def _preprocess_for_sift(
        self, source: str | bytes | np.ndarray, normalize_light: bool, remove_bg: bool
    ) -> np.ndarray:
        """Load, normalize, optionally remove background, convert to grayscale."""
        img = preprocess(source, normalize=normalize_light)

        if remove_bg:
            img, fg_mask = remove_background_grabcut(img)
            crop = get_item_crop(img, fg_mask)
            if crop.shape[0] > 10 and crop.shape[1] > 10:
                img = crop

        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    def detect_keypoints(
        self,
        source: str | bytes | np.ndarray,
        normalize_light: bool = True,
        remove_bg: bool = True,
    ) -> tuple[list[cv2.KeyPoint], np.ndarray | None]:
        """Detect SIFT keypoints and compute descriptors."""
        gray = self._preprocess_for_sift(source, normalize_light, remove_bg)
        keypoints, descriptors = self.sift.detectAndCompute(gray, None)
        return keypoints, descriptors

    def match(
        self,
        source1: str | bytes | np.ndarray,
        source2: str | bytes | np.ndarray,
        normalize_light: bool = True,
        remove_bg: bool = True,
    ) -> dict:
        """
        Match keypoints between two images with RANSAC geometric verification.

        Steps:
        1. Detect SIFT keypoints in both images.
        2. Find candidate matches via FLANN.
        3. Filter with Lowe's ratio test.
        4. Verify geometric consistency with RANSAC homography.

        Returns:
            Dict with match_ratio, inlier_ratio, and keypoint counts.
        """
        kp1, des1 = self.detect_keypoints(source1, normalize_light, remove_bg)
        kp2, des2 = self.detect_keypoints(source2, normalize_light, remove_bg)

        if des1 is None or des2 is None or len(des1) < 2 or len(des2) < 2:
            return {
                "match_ratio": 0.0,
                "inlier_ratio": 0.0,
                "good_matches": 0,
                "inlier_count": 0,
                "total_keypoints_img1": len(kp1) if kp1 else 0,
                "total_keypoints_img2": len(kp2) if kp2 else 0,
            }

        # knnMatch with k=2 for Lowe's ratio test
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

        # P1: RANSAC homography — verify geometric consistency
        inlier_count = 0
        inlier_ratio = 0.0

        if len(good_matches) >= 4:
            src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
            dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

            _, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)

            if mask is not None:
                inlier_count = int(mask.sum())
                inlier_ratio = inlier_count / len(good_matches)

        return {
            "match_ratio": match_ratio * 100,
            "inlier_ratio": inlier_ratio * 100,
            "good_matches": len(good_matches),
            "inlier_count": inlier_count,
            "total_keypoints_img1": len(kp1),
            "total_keypoints_img2": len(kp2),
        }

    def match_multi(
        self,
        original_images: list[str | bytes | np.ndarray],
        kiosk_images: list[str | bytes | np.ndarray],
        normalize_light: bool = True,
        remove_bg: bool = True,
    ) -> dict:
        """
        Match multiple original images against multiple kiosk images.

        Returns:
            Best match ratio, best inlier ratio, and all pairwise results.
        """
        all_match_ratios = []
        all_inlier_ratios = []

        for orig in original_images:
            for kiosk in kiosk_images:
                result = self.match(orig, kiosk, normalize_light, remove_bg)
                all_match_ratios.append(result["match_ratio"])
                all_inlier_ratios.append(result["inlier_ratio"])

        if not all_match_ratios:
            return {
                "best_ratio": 0.0,
                "avg_ratio": 0.0,
                "best_inlier_ratio": 0.0,
                "all_ratios": [],
                "all_inlier_ratios": [],
            }

        return {
            "best_ratio": float(max(all_match_ratios)),
            "avg_ratio": float(np.mean(all_match_ratios)),
            "best_inlier_ratio": float(max(all_inlier_ratios)),
            "all_ratios": all_match_ratios,
            "all_inlier_ratios": all_inlier_ratios,
        }
