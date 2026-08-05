"""
Shared auth dependency for the verification router.

Deliberately has no dependency on the CV/deep-learning stack (cv2, torch,
skimage, ...) — router.py imports the whole hybrid verification pipeline at
module load time, so anything importable independently of that (like this
gate) can be unit-tested without installing multi-GB ML dependencies first.
"""

from fastapi import Header, HTTPException

from .config import settings


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Reject requests without a matching X-API-Key when an api_key is configured.

    The Node backend sends its ML_SERVICE_API_KEY as the X-API-Key header; set
    ML_API_KEY on this service to the same value. When ML_API_KEY is empty (local
    dev) the check is skipped.
    """
    expected = settings.api_key
    if not expected:
        return
    if not x_api_key or x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
