"""
Upload captured JPEG bytes to Supabase Storage.
Returns public URLs for the Node.js backend to store in MySQL.
"""

import logging
import time
import uuid
from io import BytesIO

from config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, SUPABASE_URL

log = logging.getLogger(__name__)


def _get_client():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def upload_locker_images(locker_id: int, jpeg_frames: list[bytes]) -> list[str]:
    """
    Upload item verification images.
    Returns list of public URLs.
    Path: kiosk-captures/locker-{id}/{timestamp}-{n}.jpg
    """
    if not jpeg_frames:
        return []

    client = _get_client()
    urls = []
    ts = int(time.time())

    for i, frame in enumerate(jpeg_frames):
        path = f"kiosk-captures/locker-{locker_id}/{ts}-{i}.jpg"
        try:
            client.storage.from_(SUPABASE_STORAGE_BUCKET).upload(
                path,
                frame,
                {"content-type": "image/jpeg", "upsert": "true"},
            )
            url = (
                client.storage.from_(SUPABASE_STORAGE_BUCKET).get_public_url(path)
            )
            urls.append(url)
            log.info("Uploaded locker=%s frame=%s → %s", locker_id, i, path)
        except Exception as e:
            log.error("Upload failed locker=%s frame=%s: %s", locker_id, i, e)

    return urls


def upload_face_image(jpeg_bytes: bytes) -> str | None:
    """
    Upload a face capture image.
    Returns public URL or None on failure.
    Path: face-captures/{uuid}.jpg
    """
    client = _get_client()
    path = f"face-captures/{uuid.uuid4()}.jpg"
    try:
        client.storage.from_(SUPABASE_STORAGE_BUCKET).upload(
            path,
            jpeg_bytes,
            {"content-type": "image/jpeg", "upsert": "true"},
        )
        url = client.storage.from_(SUPABASE_STORAGE_BUCKET).get_public_url(path)
        log.info("Uploaded face image → %s", path)
        return url
    except Exception as e:
        log.error("Face image upload failed: %s", e)
        return None
