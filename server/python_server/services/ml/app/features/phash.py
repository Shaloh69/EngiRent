"""
P3: Perceptual hashing — fast pre-filter.

Generates a compact "fingerprint" of the image that's robust to
minor changes in size, compression, and brightness. Used as a
cheap first pass to eliminate obvious non-matches before running
the expensive feature pipeline.

pHash (perceptual hash): Uses DCT to capture dominant frequencies.
dHash (difference hash): Uses horizontal gradient patterns.
"""

import cv2
import numpy as np

from ..utils.image import load_image


def compute_phash(source: str | bytes | np.ndarray, hash_size: int = 16) -> np.ndarray:
    """
    Compute perceptual hash using DCT (Discrete Cosine Transform).

    Args:
        source: Image source.
        hash_size: Size of the hash (hash_size x hash_size bits).

    Returns:
        Binary hash as numpy array of 0s and 1s.
    """
    img = load_image(source)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Resize to slightly larger than hash_size for DCT
    resized = cv2.resize(gray, (hash_size * 2, hash_size * 2), interpolation=cv2.INTER_AREA)
    resized = resized.astype(np.float32)

    # Apply DCT
    dct = cv2.dct(resized)

    # Keep top-left low-frequency block
    dct_low = dct[:hash_size, :hash_size]

    # Threshold by median
    median = np.median(dct_low)
    return (dct_low > median).astype(np.uint8).flatten()


def compute_dhash(source: str | bytes | np.ndarray, hash_size: int = 16) -> np.ndarray:
    """
    Compute difference hash using horizontal gradients.

    Args:
        source: Image source.
        hash_size: Width of hash (produces hash_size * hash_size bits).

    Returns:
        Binary hash as numpy array of 0s and 1s.
    """
    img = load_image(source)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)

    # Compare adjacent pixels (left vs right)
    return (resized[:, 1:] > resized[:, :-1]).astype(np.uint8).flatten()


def hamming_distance(hash1: np.ndarray, hash2: np.ndarray) -> int:
    """Count differing bits between two hashes."""
    return int(np.sum(hash1 != hash2))


def phash_similarity(
    source1: str | bytes | np.ndarray,
    source2: str | bytes | np.ndarray,
    hash_size: int = 16,
) -> float:
    """
    Compare two images using perceptual hash.

    Returns:
        Similarity percentage (0-100). Higher = more similar.
    """
    h1 = compute_phash(source1, hash_size)
    h2 = compute_phash(source2, hash_size)

    total_bits = len(h1)
    dist = hamming_distance(h1, h2)

    return (1 - dist / total_bits) * 100


def is_obvious_mismatch(
    source1: str | bytes | np.ndarray,
    source2: str | bytes | np.ndarray,
    threshold: float = 40.0,
) -> bool:
    """
    Quick check: are these images obviously different items?

    Used as a fast pre-filter before running the expensive pipeline.
    Only rejects images that are CLEARLY different (low threshold).

    Args:
        threshold: Below this similarity = obvious mismatch.

    Returns:
        True if the images are obviously different items.
    """
    sim = phash_similarity(source1, source2)
    return sim < threshold
