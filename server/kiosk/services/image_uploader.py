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

import asyncio
import logging

import aiohttp

from config import KIOSK_SHARED_SECRET, SERVER_URL

log = logging.getLogger("kiosk.uploader")

_UPLOAD_URL = f"{SERVER_URL}/api/v1/kiosk/upload"

_ATTEMPTS = 3
_ATTEMPT_TIMEOUT_S = 25
_BACKOFF_S = (1.0, 3.0)


def _form(jpeg_frames: list[bytes], rental_id: str | None) -> aiohttp.FormData:
    """A fresh FormData per attempt: aiohttp cannot send the same one twice."""
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
    return data


async def _upload(jpeg_frames: list[bytes], rental_id: str | None) -> list[str]:
    if not jpeg_frames:
        return []

    # 2026-10-12 (found live, deposit of "Long Sleeve", 21:53): the Pi is on 2.4 GHz
    # Wi-Fi with packet loss, one upload hit the 20 s limit, the single attempt
    # was never repeated, and the server received ZERO kiosk images, so the AI
    # check could not run ("kiosk_images_unavailable") for an item that was in
    # the locker and captured fine. A transport failure is now retried, and the
    # failure is logged with its type (a timeout's own message is empty).
    last_error = "no attempt made"
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    _UPLOAD_URL,
                    data=_form(jpeg_frames, rental_id),
                    headers={"X-Kiosk-Secret": KIOSK_SHARED_SECRET},
                    timeout=aiohttp.ClientTimeout(total=_ATTEMPT_TIMEOUT_S),
                ) as resp:
                    if resp.status >= 400:
                        # The server answered and said no: repeating will not help.
                        body = await resp.text()
                        log.error("Upload failed (%d): %s", resp.status, body[:300])
                        return []
                    result = await resp.json()
                    urls = result.get("urls", [])
                    if attempt > 1:
                        log.info("Upload succeeded on attempt %d/%d", attempt, _ATTEMPTS)
                    return urls
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}".rstrip(": ")
            log.error("Upload attempt %d/%d failed: %s", attempt, _ATTEMPTS, last_error)
            if attempt < _ATTEMPTS:
                await asyncio.sleep(_BACKOFF_S[attempt - 1])
    log.error("Upload gave up after %d attempts (%s)", _ATTEMPTS, last_error)
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
