"""Image preprocessing utilities."""

import cv2
import numpy as np


def load_image(source: str | bytes | np.ndarray) -> np.ndarray:
    """Load image from file path, bytes, or numpy array."""
    if isinstance(source, np.ndarray):
        return source
    if isinstance(source, bytes):
        arr = np.frombuffer(source, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    else:
        img = cv2.imread(source)

    if img is None:
        raise ValueError(f"Could not load image from: {source!r}")
    return img


def normalize_lighting(image: np.ndarray) -> np.ndarray:
    """
    Normalize brightness and contrast using CLAHE.

    Handles the difference between home lighting (owner photos)
    and kiosk LED lighting (locker camera photos).
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)

    normalized = cv2.merge([l_channel, a_channel, b_channel])
    return cv2.cvtColor(normalized, cv2.COLOR_LAB2BGR)


def white_balance(image: np.ndarray) -> np.ndarray:
    """
    P3: Gray-world white balance correction.

    Corrects color temperature shifts (warm home lamps vs cool kiosk LEDs)
    by assuming the average color in the scene should be neutral gray.
    """
    result = image.copy().astype(np.float64)
    avg_b = result[:, :, 0].mean()
    avg_g = result[:, :, 1].mean()
    avg_r = result[:, :, 2].mean()
    avg_all = (avg_b + avg_g + avg_r) / 3

    if avg_b > 0:
        result[:, :, 0] *= avg_all / avg_b
    if avg_g > 0:
        result[:, :, 1] *= avg_all / avg_g
    if avg_r > 0:
        result[:, :, 2] *= avg_all / avg_r

    return np.clip(result, 0, 255).astype(np.uint8)


def resize_image(image: np.ndarray, target_size: tuple[int, int] = (640, 640)) -> np.ndarray:
    """Resize image while maintaining aspect ratio with padding."""
    h, w = image.shape[:2]
    target_w, target_h = target_size

    scale = min(target_w / w, target_h / h)
    new_w, new_h = int(w * scale), int(h * scale)

    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)

    # Pad to target size
    canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
    x_offset = (target_w - new_w) // 2
    y_offset = (target_h - new_h) // 2
    canvas[y_offset : y_offset + new_h, x_offset : x_offset + new_w] = resized

    return canvas


def preprocess(
    source: str | bytes | np.ndarray,
    normalize: bool = True,
    apply_white_balance: bool = True,
    target_size: tuple[int, int] | None = None,
) -> np.ndarray:
    """Full preprocessing pipeline: load, white balance, normalize lighting, resize."""
    img = load_image(source)

    if apply_white_balance:
        img = white_balance(img)

    if normalize:
        img = normalize_lighting(img)

    if target_size:
        img = resize_image(img, target_size)

    return img
