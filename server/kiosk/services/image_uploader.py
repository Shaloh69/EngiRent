"""
Upload captured JPEG bytes to the Node backend (POST /kiosk/upload), which
stores them on the PC's local filesystem and returns short-lived signed URLs.

This used to upload straight to Supabase Storage from the Pi. Once storage
moved to the PC's local filesystem (Phase 0.5 — Supabase dropped entirely),
the Pi can no longer write to it directly: they're different physical
machines connected over Tailscale, not a shared filesystem. Uploading through
the Node API instead is simpler and more secure than attempting a network
filesystem mount, and reuses the same authenticated channel (the kiosk shared
secret) already trusted for everything else.
"""

import logging

import aiohttp

from config import KIOSK_SHARED_SECRET, SERVER_URL

log = logging.getLogger("kiosk.uploader")

_UPLOAD_URL = f"{SERVER_URL}/api/v1/kiosk/upload"


async def _upload(jpeg_frames: list[bytes], rental_id: str | None) -> list[str]:
    if not jpeg_frames:
        return []

    data = aiohttp.FormData()
    if rental_id:
        data.add_field("rentalId", rental_id)
    for i, frame in enumerate(jpeg_frames):
        data.add_field(
            "files",
            frame,
            filename=f"capture-{i}.jpg",
            content_type="image/jpeg",
        )

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                _UPLOAD_URL,
                data=data,
                headers={"X-Kiosk-Secret": KIOSK_SHARED_SECRET},
                timeout=aiohttp.ClientTimeout(total=20),
            ) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    log.error("Upload failed (%d): %s", resp.status, body[:300])
                    return []
                result = await resp.json()
                return result.get("urls", [])
    except Exception as e:
        log.error("Upload request failed: %s", e)
        return []


async def upload_locker_images(
    locker_id: int, jpeg_frames: list[bytes], rental_id: str | None = None
) -> list[str]:
    """Upload item verification images captured from a locker camera.
    Returns a list of short-lived signed URLs (empty list on failure)."""
    urls = await _upload(jpeg_frames, rental_id)
    log.info(
        "Uploaded locker=%s frames=%d → %d URL(s)",
        locker_id, len(jpeg_frames), len(urls),
    )
    return urls


async def upload_face_image(jpeg_bytes: bytes, rental_id: str | None = None) -> str | None:
    """Upload a single face-capture image. Returns a short-lived signed URL,
    or None on failure."""
    urls = await _upload([jpeg_bytes], rental_id)
    if urls:
        log.info("Uploaded face image → %s", urls[0])
        return urls[0]
    log.error("Face image upload failed")
    return None
