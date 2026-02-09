"""
P1: Image quality gate.

Rejects images that are too blurry, too dark, too bright, or where
the item covers too little of the frame. Garbage inputs produce
garbage features — better to reject early and ask for a retake.
"""

import cv2
import numpy as np

from .image import load_image


class QualityCheckResult:
    """Result of an image quality check."""

    def __init__(self):
        self.passed = True
        self.blur_score: float = 0.0
        self.brightness: float = 0.0
        self.coverage: float = 0.0
        self.issues: list[str] = []

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "blur_score": round(self.blur_score, 2),
            "brightness": round(self.brightness, 2),
            "coverage_percent": round(self.coverage * 100, 2),
            "issues": self.issues,
        }


def check_quality(
    source: str | bytes | np.ndarray,
    fg_mask: np.ndarray | None = None,
    min_blur_score: float = 50.0,
    min_brightness: float = 40.0,
    max_brightness: float = 240.0,
    min_coverage: float = 0.05,
) -> QualityCheckResult:
    """
    Run all quality checks on an image.

    Args:
        source: Image file path, bytes, or numpy array.
        fg_mask: Optional foreground mask (for coverage check).
        min_blur_score: Minimum Laplacian variance (below = blurry).
        min_brightness: Minimum mean brightness (below = too dark).
        max_brightness: Maximum mean brightness (above = overexposed).
        min_coverage: Minimum foreground coverage ratio (below = item too small).

    Returns:
        QualityCheckResult with pass/fail and details.
    """
    img = load_image(source)
    result = QualityCheckResult()

    # --- Blur detection (Laplacian variance) ---
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    result.blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()

    if result.blur_score < min_blur_score:
        result.passed = False
        result.issues.append(
            f"Image too blurry (score {result.blur_score:.1f}, need >={min_blur_score})"
        )

    # --- Brightness check ---
    result.brightness = float(gray.mean())

    if result.brightness < min_brightness:
        result.passed = False
        result.issues.append(
            f"Image too dark (brightness {result.brightness:.1f}, need >={min_brightness})"
        )
    elif result.brightness > max_brightness:
        result.passed = False
        result.issues.append(
            f"Image overexposed (brightness {result.brightness:.1f}, need <={max_brightness})"
        )

    # --- Item coverage check ---
    if fg_mask is not None:
        total_pixels = fg_mask.shape[0] * fg_mask.shape[1]
        fg_pixels = np.count_nonzero(fg_mask)
        result.coverage = fg_pixels / total_pixels if total_pixels > 0 else 0.0

        if result.coverage < min_coverage:
            result.passed = False
            result.issues.append(
                f"Item too small in frame ({result.coverage * 100:.1f}%, need >={min_coverage * 100:.0f}%)"
            )
    else:
        result.coverage = -1.0  # Not checked

    return result
