"""
OCR utility for serial number / text extraction (Phase 3).

Uses pytesseract to detect text on items (serial numbers, brand names,
model numbers) for additional verification confidence.
"""

import logging
import re

import cv2
import numpy as np

from .image import load_image

logger = logging.getLogger(__name__)


def extract_text(source: str | bytes | np.ndarray) -> str:
    """
    Extract text from an image using Tesseract OCR.

    Returns:
        Extracted text string (may be empty if no text found).
    """
    try:
        import pytesseract
    except ImportError:
        logger.warning("pytesseract not installed, skipping OCR")
        return ""

    try:
        img = load_image(source)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Enhance for OCR: threshold + denoise
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        gray = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)

        text = pytesseract.image_to_string(gray, config="--psm 6")
        return text.strip()
    except Exception as e:
        logger.warning("OCR extraction failed: %s", e)
        return ""


def find_serial_numbers(text: str) -> list[str]:
    """
    Find potential serial numbers in extracted text.

    Looks for patterns like:
    - S/N: ABC123
    - Serial: XYZ-456-789
    - Alphanumeric strings 6+ chars long
    """
    patterns = [
        r"(?:S/?N|Serial|SN)[:\s]*([A-Z0-9][\w-]{4,})",
        r"(?:Model|MDL)[:\s]*([A-Z0-9][\w-]{3,})",
        r"\b([A-Z]{2,}[\d-]{3,}[\w-]*)\b",
        r"\b([\d]{3,}[A-Z-][\w-]{2,})\b",
    ]

    serials = []
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        serials.extend(matches)

    # Deduplicate and filter noise
    seen = set()
    result = []
    for s in serials:
        normalized = s.upper().strip()
        if normalized not in seen and len(normalized) >= 4:
            seen.add(normalized)
            result.append(normalized)

    return result


def match_serial_numbers(
    original_texts: list[str], kiosk_texts: list[str]
) -> tuple[bool, dict]:
    """
    Check if any serial numbers from original images match kiosk images.

    Returns:
        Tuple of (match_found, details_dict).
    """
    orig_serials = set()
    for text in original_texts:
        orig_serials.update(find_serial_numbers(text))

    kiosk_serials = set()
    for text in kiosk_texts:
        kiosk_serials.update(find_serial_numbers(text))

    common = orig_serials & kiosk_serials

    return bool(common), {
        "original_serials": sorted(orig_serials),
        "kiosk_serials": sorted(kiosk_serials),
        "matched_serials": sorted(common),
    }
