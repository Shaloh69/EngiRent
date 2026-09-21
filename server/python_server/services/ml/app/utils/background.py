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

# D-87: the longest side GrabCut itself works at. The mask is coarse and gets
# morphologically smoothed straight afterwards, so a bigger canvas costs time
# without buying accuracy.
_GRABCUT_MAX_DIM = 480


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

    # D-87 (2026-09-18): GrabCut is what made a deposit check take minutes.
    # Measured on the live server: the traditional-CV stage alone ran ~100s for
    # 5 images, and this is ~20s of it per image — 5 iterations of GrabCut over
    # the full working image. The mask it produces is coarse (it is immediately
    # smoothed by a 7x7 morphological close/open), so computing it at full size
    # buys nothing. Compute it small and scale the mask back: the cost falls
    # with the square of the side length, and the smoothed mask is
    # indistinguishable in practice.
    scale = 1.0
    small = image
    if max(h, w) > _GRABCUT_MAX_DIM:
        scale = _GRABCUT_MAX_DIM / max(h, w)
        small = cv2.resize(image, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)

    sh, sw = small.shape[:2]

    # Initial rectangle: center 70% of the image
    margin_x = int(sw * 0.15)
    margin_y = int(sh * 0.15)
    rect = (margin_x, margin_y, sw - 2 * margin_x, sh - 2 * margin_y)

    mask = np.zeros((sh, sw), np.uint8)
    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)

    cv2.grabCut(small, mask, rect, bg_model, fg_model, iterations, cv2.GC_INIT_WITH_RECT)

    # 0=bg, 1=fg, 2=probable_bg, 3=probable_fg
    fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # Back to the caller's resolution, since callers mask the ORIGINAL image
    # with this and every downstream stage expects matching shapes.
    if fg_mask.shape[:2] != (h, w):
        fg_mask = cv2.resize(fg_mask, (w, h), interpolation=cv2.INTER_NEAREST)

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


def isolate_item(image: np.ndarray, fill: int = 255) -> np.ndarray:
    """
    D-89 — cut the item out of its background BEFORE any comparison runs.

    Why: the second physical test put a correct glue gun in the locker and it
    scored ~53. Only SIFT and the colour/texture channel removed the background;
    SSIM, pHash and the deep model compared the raw photos, so they mostly
    measured how unlike the owner's beige bedsheet the white locker looked
    (SSIM scored 17). Every stage now compares item against item.

    How:
      1. GrabCut with its centre prior (the item is roughly centred in both
         owner photos and locker captures).
      2. Keep only the LARGEST connected region. The locker has a red strip down
         one edge and GrabCut can keep it; it is a separate region from the
         item, and smaller, so it goes. Specks go with it.
      3. Paint everything else a flat fill (white by default) and crop to the
         item. Both sides of every comparison then show item-on-white, so no
         stage can be scoring the background — and white matches the locker's
         own interior and the "light background" the app now asks owners for.

    Falls back to the original image when the mask is implausible (almost
    nothing, or almost everything): a bad cut-out is worse than none, because
    it would compare a fragment of one item against the whole of another.
    """
    h, w = image.shape[:2]
    _, mask = remove_background_grabcut(image)

    # Largest connected foreground region only.
    n, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), connectivity=8)
    if n <= 1:
        return image
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    item_mask = (labels == largest).astype(np.uint8) * 255

    coverage = float(item_mask.mean()) / 255.0
    if coverage < 0.02 or coverage > 0.95:
        return image

    out = image.copy()
    out[item_mask == 0] = fill
    return get_item_crop(out, item_mask, padding=12)


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
