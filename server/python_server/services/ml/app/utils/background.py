"""
P0: Background removal / item segmentation.

The biggest source of error is background contamination:
- Owner photos: item on a wooden desk, colored tablecloth, etc.
- Kiosk photos: item on white locker interior with LED lighting.

Without isolating the item, color/shape/texture features are
comparing desks and lockers, not the actual items.

Two strategies:
1. GrabCut (general): Works on any image, semi-automatic.
2. Kiosk subtraction: Uses the known empty-locker background
   (white interior) for precise foreground extraction.
"""

import cv2
import numpy as np


def remove_background_grabcut(image: np.ndarray, iterations: int = 5) -> tuple[np.ndarray, np.ndarray]:
    """
    Isolate foreground item using GrabCut algorithm.

    Uses center-bias heuristic: assumes the item is roughly centered
    in the frame (true for both owner photos and kiosk captures).

    Args:
        image: BGR image.
        iterations: GrabCut iterations (more = slower but better).

    Returns:
        Tuple of (foreground_image, binary_mask).
        foreground_image has background set to black (0,0,0).
    """
    h, w = image.shape[:2]

    # Initial rectangle: center 70% of the image
    margin_x = int(w * 0.15)
    margin_y = int(h * 0.15)
    rect = (margin_x, margin_y, w - 2 * margin_x, h - 2 * margin_y)

    mask = np.zeros((h, w), np.uint8)
    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)

    cv2.grabCut(image, mask, rect, bg_model, fg_model, iterations, cv2.GC_INIT_WITH_RECT)

    # 0=bg, 1=fg, 2=probable_bg, 3=probable_fg
    fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # Clean up mask with morphological operations
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)

    foreground = cv2.bitwise_and(image, image, mask=fg_mask)
    return foreground, fg_mask


def remove_background_kiosk(
    image: np.ndarray,
    empty_locker_image: np.ndarray | None = None,
    white_threshold: int = 200,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Background removal optimized for kiosk locker cameras.

    The kiosk locker has a known white interior with controlled LED lighting.
    Two strategies:
    1. If empty_locker_image is provided: subtract it (best accuracy).
    2. Otherwise: threshold out the white background.

    Args:
        image: BGR kiosk capture.
        empty_locker_image: Optional reference of the empty locker.
        white_threshold: Brightness threshold for white background removal.

    Returns:
        Tuple of (foreground_image, binary_mask).
    """
    if empty_locker_image is not None:
        return _subtract_background(image, empty_locker_image)
    return _threshold_white_background(image, white_threshold)


def _subtract_background(image: np.ndarray, background: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Subtract known empty-locker background from kiosk capture."""
    # Ensure same size
    if image.shape != background.shape:
        background = cv2.resize(background, (image.shape[1], image.shape[0]))

    # Absolute difference
    diff = cv2.absdiff(image, background)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)

    # Threshold the difference
    _, fg_mask = cv2.threshold(gray_diff, 30, 255, cv2.THRESH_BINARY)

    # Clean up
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)

    foreground = cv2.bitwise_and(image, image, mask=fg_mask)
    return foreground, fg_mask


def _threshold_white_background(image: np.ndarray, threshold: int) -> tuple[np.ndarray, np.ndarray]:
    """Remove white/near-white background (kiosk locker interior)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # White areas are background
    _, bg_mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
    fg_mask = cv2.bitwise_not(bg_mask)

    # Clean up
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)

    foreground = cv2.bitwise_and(image, image, mask=fg_mask)
    return foreground, fg_mask


def get_item_crop(image: np.ndarray, mask: np.ndarray, padding: int = 10) -> np.ndarray:
    """
    Crop the image tightly around the detected foreground item.

    Args:
        image: Original BGR image.
        mask: Binary foreground mask.
        padding: Extra pixels around the bounding box.

    Returns:
        Cropped image containing just the item.
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image

    # Bounding box of all foreground contours
    all_points = np.vstack(contours)
    x, y, w, h = cv2.boundingRect(all_points)

    # Add padding
    img_h, img_w = image.shape[:2]
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(img_w, x + w + padding)
    y2 = min(img_h, y + h + padding)

    return image[y1:y2, x1:x2]
