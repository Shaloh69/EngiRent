"""
Phase 1: Traditional Computer Vision Feature Extraction (IMPROVED).

Changes from v1:
- P0: HSV color space (lighting-robust) instead of RGB
- P1: Raw ORB descriptors for proper descriptor-to-descriptor matching
- P2: HOG (Histogram of Oriented Gradients) for edge/structure features
- P2: Spatial pyramid for color + texture (captures WHERE features are)
- P2: Multi-scale LBP for texture at different scales
- P0: Background removal before feature extraction

Extracts six types of features from item images:
- Color histograms in HSV (what colors, independent of brightness)
- Spatial color pyramid (where are the colors located?)
- Shape descriptors via Hu moments (round? rectangular?)
- Texture patterns via multi-scale LBP (smooth? rough? has text?)
- HOG edge gradients (buttons? ports? structural details?)
- ORB keypoint descriptors (for proper matching, not aggregation)
"""

import cv2
import numpy as np
from skimage.feature import local_binary_pattern

from ..config import settings
from ..utils.background import get_item_crop, remove_background_grabcut
from ..utils.image import preprocess


class TraditionalFeatureExtractor:
    """Extract traditional CV features from item images."""

    def __init__(self):
        self.orb = cv2.ORB_create(nfeatures=settings.orb_features_count)
        self.color_bins = settings.color_hist_bins
        self.lbp_points = settings.lbp_points
        self.lbp_radius = settings.lbp_radius

    def extract(
        self,
        source: str | bytes | np.ndarray,
        normalize_light: bool = True,
        remove_bg: bool = True,
    ) -> dict:
        """
        Extract all traditional features from a single image.

        Args:
            source: File path, raw bytes, or numpy array.
            normalize_light: Apply CLAHE lighting normalization.
            remove_bg: Remove background before feature extraction.

        Returns:
            Dict with all feature vectors + raw ORB descriptors.
        """
        img = preprocess(source, normalize=normalize_light)

        # P0: Remove background to isolate the item
        fg_mask = None
        if remove_bg:
            img, fg_mask = remove_background_grabcut(img)
            crop = get_item_crop(img, fg_mask)
            if crop.shape[0] > 10 and crop.shape[1] > 10:
                img = crop

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

        return {
            "color": self._color_histogram_hsv(hsv),
            "color_spatial": self._spatial_color_pyramid(hsv),
            "shape": self._shape_descriptors(gray),
            "texture": self._texture_lbp_multiscale(gray),
            "hog": self._hog_features(gray),
            "orb_descriptors": self._orb_raw_descriptors(gray),
        }

    def _color_histogram_hsv(self, hsv: np.ndarray) -> np.ndarray:
        """
        P0: Color distribution in HSV space.

        H (hue) captures actual color independent of brightness.
        S (saturation) captures color intensity.
        V (value) captures brightness — least useful for cross-lighting
        matching, but still included with fewer bins.
        """
        # H: 0-179 in OpenCV, 36 bins (5-degree resolution)
        hist_h = cv2.calcHist([hsv], [0], None, [36], [0, 180])
        # S: 0-255, 32 bins
        hist_s = cv2.calcHist([hsv], [1], None, [self.color_bins], [0, 256])
        # V: 0-255, 16 bins (less weight on brightness)
        hist_v = cv2.calcHist([hsv], [2], None, [16], [0, 256])

        color_hist = np.concatenate([hist_h, hist_s, hist_v]).flatten()
        total = color_hist.sum()
        if total > 0:
            color_hist = color_hist / total
        return color_hist  # 84-dimensional (36 + 32 + 16)

    def _spatial_color_pyramid(self, hsv: np.ndarray, grid_size: int = 3) -> np.ndarray:
        """
        P2: Spatial pyramid — captures WHERE colors are located.

        Divides the image into a grid and computes a color histogram
        for each cell. A blue-top/black-bottom item won't match a
        black-top/blue-bottom item anymore.
        """
        h, w = hsv.shape[:2]
        cell_h = max(1, h // grid_size)
        cell_w = max(1, w // grid_size)

        spatial_features = []
        for row in range(grid_size):
            for col in range(grid_size):
                y1, y2 = row * cell_h, min((row + 1) * cell_h, h)
                x1, x2 = col * cell_w, min((col + 1) * cell_w, w)
                cell = hsv[y1:y2, x1:x2]

                if cell.size == 0:
                    spatial_features.append(np.zeros(12))
                    continue

                # Compact histogram per cell: just H channel, 12 bins
                hist = cv2.calcHist([cell], [0], None, [12], [0, 180]).flatten()
                total = hist.sum()
                if total > 0:
                    hist = hist / total
                spatial_features.append(hist)

        return np.concatenate(spatial_features)  # 108-d (3x3 grid * 12 bins)

    def _shape_descriptors(self, gray: np.ndarray) -> np.ndarray:
        """
        Object geometry via Hu moments (rotation-invariant).

        Uses Canny edge detection (more robust than Otsu threshold).
        """
        edges = cv2.Canny(gray, 50, 150)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return np.zeros(7)

        largest = max(contours, key=cv2.contourArea)
        moments = cv2.moments(largest)
        hu = cv2.HuMoments(moments).flatten()

        return -np.sign(hu) * np.log10(np.abs(hu) + 1e-10)  # 7-dimensional

    def _texture_lbp_multiscale(self, gray: np.ndarray) -> np.ndarray:
        """
        P2: Multi-scale LBP — captures texture at different scales.

        Single-scale (R=1) only sees micro-texture. Multiple radii
        capture patterns at small, medium, and large scales.
        """
        all_hists = []
        for radius in [1, 2, 4]:
            points = 8 * radius
            lbp = local_binary_pattern(gray, P=points, R=radius, method="uniform")
            n_bins = points + 2
            hist, _ = np.histogram(lbp.ravel(), bins=n_bins, range=(0, n_bins))
            total = hist.sum()
            if total > 0:
                hist = hist / total
            all_hists.append(hist.astype(np.float64))

        return np.concatenate(all_hists)  # 10 + 18 + 34 = 62-dimensional

    def _hog_features(self, gray: np.ndarray) -> np.ndarray:
        """
        P2: Histogram of Oriented Gradients — edge structure features.

        Captures structural details like buttons, ports, screen bezels,
        and brand logos. Lighting-invariant because it uses gradients,
        not absolute pixel values.
        """
        resized = cv2.resize(gray, (128, 128))

        win_size = (128, 128)
        block_size = (32, 32)
        block_stride = (16, 16)
        cell_size = (16, 16)
        n_bins = 9

        hog = cv2.HOGDescriptor(win_size, block_size, block_stride, cell_size, n_bins)
        features = hog.compute(resized).flatten()

        norm = np.linalg.norm(features)
        if norm > 0:
            features = features / norm

        return features

    def _orb_raw_descriptors(self, gray: np.ndarray) -> np.ndarray | None:
        """
        P1: Return raw ORB descriptors for proper matching.

        Instead of averaging all descriptors into a single vector,
        return the full descriptor matrix so the comparison layer can do
        proper descriptor-to-descriptor matching with BFMatcher.
        """
        _, descriptors = self.orb.detectAndCompute(gray, None)
        return descriptors  # shape (N, 32) or None

    def extract_batch(
        self,
        sources: list[str | bytes | np.ndarray],
        normalize_light: bool = True,
        remove_bg: bool = True,
    ) -> list[dict]:
        """Extract features from multiple images."""
        return [self.extract(src, normalize_light, remove_bg) for src in sources]
