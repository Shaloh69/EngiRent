"""
Socket.io client – connects the Pi kiosk to the Node.js backend.

Events emitted TO server:
  kiosk:register        – announce this kiosk is online
  kiosk:status          – locker states update
  kiosk:images          – captured item images (URLs) for a rental
  kiosk:admin_snapshot  – captured images with no rental_id (admin preview only)
  kiosk:face            – face verification result
  kiosk:log             – Pi log lines forwarded to Render server logs
  kiosk:ack             – command execution result (ok / error)
  kiosk:rental_lookup   – ask Node.js for rental details by ID (QR scan flow)
  kiosk:flow_start      – user confirmed rental; Node.js sends capture_face command

Events received FROM server:
  kiosk:command         – action to perform (open_door, drop_item, capture_image, etc.)
  kiosk:config          – updated timing configuration
  kiosk:rental_info     – rental details in response to kiosk:rental_lookup

Offline queue:
  Critical outbound events are persisted to offline_queue.json when the socket is
  disconnected.  On reconnect the queue is flushed in order before normal operation.
  Non-critical volatile events (kiosk:status, kiosk:log) are dropped while offline.
"""

import asyncio
import json
import logging
import os
import time

import socketio

from config import (
    KIOSK_ID,
    KIOSK_SHARED_SECRET,
    SERVER_URL,
    load_timing_config,
    save_timing_config,
)
from hardware.gpio_controller import SolenoidController
from hardware.actuator_controller import ActuatorController
from hardware.camera_manager import CameraManager
from services.image_uploader import upload_locker_images
from services.face_service import verify_face

log = logging.getLogger("kiosk.socket")

sio = socketio.AsyncClient(reconnection=False, logger=False)

# ── Main asyncio loop reference (set on connect, used by Flask threads) ────────
_main_loop: asyncio.AbstractEventLoop | None = None


def get_main_loop() -> asyncio.AbstractEventLoop | None:
    return _main_loop


# ── Offline queue ──────────────────────────────────────────────────────────────
# Events in this set are persisted to disk and replayed on reconnect.
# Volatile events (kiosk:status, kiosk:log) are excluded — they carry live state
# that would be stale by the time the kiosk reconnects.
_QUEUED_EVENTS = {"kiosk:ack", "kiosk:face", "kiosk:images", "kiosk:admin_snapshot",
                  "kiosk:rental_lookup", "kiosk:flow_start"}

_QUEUE_FILE = os.path.join(os.path.dirname(__file__), "..", "offline_queue.json")
_QUEUE_MAX = 100  # hard cap — prevents unbounded growth if offline for a long time

_offline_queue: list[dict] = []
_queue_lock: asyncio.Lock | None = None  # created lazily on first async use


def _get_queue_lock() -> asyncio.Lock:
    global _queue_lock
    if _queue_lock is None:
        _queue_lock = asyncio.Lock()
    return _queue_lock


def _load_queue() -> None:
    """Load persisted queue from disk (called once at startup)."""
    global _offline_queue
    try:
        path = os.path.normpath(_QUEUE_FILE)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                _offline_queue = json.load(f)
            log.info("Offline queue loaded: %d item(s) pending", len(_offline_queue))
    except Exception as exc:
        log.warning("Could not load offline queue: %s", exc)
        _offline_queue = []


def _save_queue() -> None:
    """Persist current queue to disk (synchronous, called under the lock)."""
    try:
        path = os.path.normpath(_QUEUE_FILE)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_offline_queue, f)
    except Exception as exc:
        log.warning("Could not save offline queue: %s", exc)


async def safe_emit(event: str, data: dict) -> None:
    """Emit *event* immediately if connected; otherwise queue it if it's a
    critical event.  Volatile events are silently dropped when offline."""
    if sio.connected:
        await sio.emit(event, data)
        return

    if event not in _QUEUED_EVENTS:
        return  # drop volatile events while offline

    async with _get_queue_lock():
        if len(_offline_queue) >= _QUEUE_MAX:
            # Drop oldest entry to make room (FIFO eviction)
            _offline_queue.pop(0)
        _offline_queue.append({"event": event, "data": data, "ts": int(time.time())})
        _save_queue()
        log.info("Queued offline event %s (queue depth=%d)", event, len(_offline_queue))


async def _flush_offline_queue() -> None:
    """Replay queued events in order.  Called immediately after reconnect."""
    async with _get_queue_lock():
        if not _offline_queue:
            return
        log.info("Flushing %d offline event(s)…", len(_offline_queue))
        flushed = 0
        failed: list[dict] = []
        for entry in _offline_queue:
            try:
                await sio.emit(entry["event"], entry["data"])
                flushed += 1
                log.debug("Flushed queued %s (queued %ds ago)",
                          entry["event"], int(time.time()) - entry.get("ts", 0))
            except Exception as exc:
                log.error("Failed to flush queued %s: %s", entry["event"], exc)
                failed.append(entry)
        _offline_queue.clear()
        _offline_queue.extend(failed)
        _save_queue()
        log.info("Offline queue flush complete: sent=%d remaining=%d", flushed, len(failed))


# Load any events that were queued before the last shutdown
_load_queue()


# ── Socket log handler — forwards Pi logs to Render server logs ────────────────

_FORWARD_MODULES = {
    "kiosk.main", "kiosk.socket", "kiosk.gpio", "kiosk.actuator",
    "kiosk.camera", "kiosk.face", "kiosk.uploader", "kiosk.wifi", "kiosk.ui",
}


class _SocketLogHandler(logging.Handler):
    """Emits Pi log records to the server via kiosk:log so they appear in Render."""

    def emit(self, record: logging.LogRecord) -> None:
        if record.name not in _FORWARD_MODULES:
            return
        if record.levelno < logging.INFO:
            return
        if not sio.connected:
            return
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(sio.emit("kiosk:log", {
                    "kiosk_id": KIOSK_ID,
                    "level":    record.levelname,
                    "module":   record.name,
                    "message":  record.getMessage(),
                    "ts":       int(record.created * 1000),
                }))
        except Exception:
            pass


_socket_log_handler = _SocketLogHandler()
_socket_log_handler.setLevel(logging.INFO)
logging.getLogger().addHandler(_socket_log_handler)

# Shared hardware instances (injected by main.py)
_solenoid: SolenoidController | None = None
_actuator: ActuatorController | None = None
_camera: CameraManager | None = None

# Kiosk UI state – broadcast to local Flask UI
_ui_state: dict = {
    "status": "idle",
    "message": "Welcome to EngiRent Hub",
    "active_locker": None,
    "lockers": {str(i): {"main": "locked", "bottom": "locked"} for i in range(1, 5)},
}


def init_hardware(solenoid: SolenoidController, actuator: ActuatorController, camera: CameraManager):
    global _solenoid, _actuator, _camera
    _solenoid = solenoid
    _actuator = actuator
    _camera = camera


def get_ui_state() -> dict:
    return _ui_state


def _set_ui(status: str, message: str, active_locker: int | None = None):
    _ui_state["status"] = status
    _ui_state["message"] = message
    _ui_state["active_locker"] = active_locker


# ── Socket.io event handlers ───────────────────────────────────────────────────

@sio.event
async def connect():
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    log.info("Connected to server %s", SERVER_URL)
    # Flush any events queued while we were offline before registering
    await _flush_offline_queue()
    await sio.emit("kiosk:register", {
        "kiosk_id": KIOSK_ID,
        "locker_count": 4,
        "version": "1.0.0",
    })
    _set_ui("online", "Kiosk online – Ready")


@sio.event
async def disconnect():
    log.warning("Disconnected from server")
    _set_ui("offline", "Disconnected from server – retrying…")


@sio.event
async def connect_error(data):
    log.error("Connection error: %s", data)
    _set_ui("error", "Cannot reach server")


@sio.on("kiosk:config")
async def on_config(data: dict):
    """Server pushes updated timing config from admin panel."""
    log.info("Received config update: %s", json.dumps(data, indent=2))

    # Only save timing config if the server sends the expected lockers-based format.
    # Ignore pin overrides (solenoid_pins, actuator_pins) and camera_indices — those
    # are managed by local config.py so the Pi wiring is the source of truth.
    # Also ignore the legacy ms-based format (door_open_duration_ms etc.) which would
    # overwrite kiosk_config.json with keys the command handlers don't read.
    if "lockers" in data:
        timing_only = {
            k: v for k, v in data.items()
            if k not in ("solenoid_pins", "actuator_pins", "camera_indices")
        }
        save_timing_config(timing_only)
        log.info("Timing config saved from server ✓")
    else:
        log.info("Server config has no 'lockers' key — keeping local kiosk_config.json")

    await sio.emit("kiosk:status", _build_status())


@sio.on("kiosk:command")
async def on_command(data: dict):
    """Dispatch incoming command to the correct handler."""
    action = data.get("action")
    command_id = data.get("command_id", "")
    log.info("Command received: %s | data=%s", action, data)

    handlers = {
        "open_door":        _cmd_open_door,
        "drop_item":        _cmd_drop_item,
        "capture_image":    _cmd_capture_image,
        "capture_face":     _cmd_capture_face,
        "lock_all":         _cmd_lock_all,
        "actuator_extend":  _cmd_actuator_extend,
        "actuator_retract": _cmd_actuator_retract,
        "flow_error":       _cmd_flow_error,
        "self_test":        _cmd_self_test,
        "verification_done": _cmd_verification_done,
    }

    handler = handlers.get(action)
    if handler:
        asyncio.create_task(_run_with_ack(handler, action, command_id, data))
    else:
        log.warning("Unknown action: %s", action)
        await _emit_error(f"Unknown action: {action}")


async def _run_with_ack(handler, action: str, command_id: str, data: dict):
    """Wraps a command handler and emits kiosk:ack on success or failure.
    Uses safe_emit so the ack is queued if the connection drops mid-command."""
    try:
        await handler(data)
        await safe_emit("kiosk:ack", {
            "kiosk_id": KIOSK_ID,
            "command_id": command_id,
            "action": action,
            "status": "ok",
        })
    except Exception as exc:
        log.error("Command '%s' failed: %s", action, exc)
        await safe_emit("kiosk:ack", {
            "kiosk_id": KIOSK_ID,
            "command_id": command_id,
            "action": action,
            "status": "error",
            "message": str(exc),
        })


# ── Command handlers ───────────────────────────────────────────────────────────

async def _cmd_open_door(data: dict):
    locker_id = int(data["locker_id"])
    door = data["door"]                 # "main_door" | "bottom_door"
    cfg = load_timing_config()
    locker_cfg = cfg["lockers"][str(locker_id)]

    duration_map = {
        "main_door":   locker_cfg["main_door_open_seconds"],
        "bottom_door": locker_cfg["bottom_door_open_seconds"],
    }
    duration = data.get("duration_override") or duration_map.get(door, 15)

    _set_ui("door_open", f"Locker {locker_id} – {door.replace('_', ' ').title()} open", locker_id)
    _ui_state["lockers"][str(locker_id)][door.replace("_door", "")] = "unlocked"

    await _solenoid.unlock_for(locker_id, door, duration)

    _ui_state["lockers"][str(locker_id)][door.replace("_door", "")] = "locked"
    _set_ui("idle", "Ready")

    await sio.emit("kiosk:status", _build_status())


async def _cmd_drop_item(data: dict):
    """
    Actuator place sequence:
      1. Extend actuator (push item into locker)
      2. Retract actuator (return platform)
    """
    locker_id = int(data["locker_id"])
    cfg = load_timing_config()
    locker_cfg = cfg["lockers"][str(locker_id)]

    ext_s = data.get("extend_seconds") or locker_cfg["actuator_extend_seconds"]
    ret_s = data.get("retract_seconds") or locker_cfg["actuator_retract_seconds"]

    _set_ui("dropping", f"Locker {locker_id} – placing item…", locker_id)
    await _actuator.place_item(locker_id, ext_s, ret_s)
    _set_ui("idle", f"Locker {locker_id} – item placed.")
    await sio.emit("kiosk:status", _build_status())
    log.info("Place sequence complete locker=%s", locker_id)


async def _cmd_capture_image(data: dict):
    locker_id = int(data["locker_id"])
    rental_id = data.get("rental_id")
    num_frames = data.get("num_frames", 3)

    _set_ui("capturing", f"Capturing images from Locker {locker_id}…", locker_id)

    frames = _camera.capture_locker(locker_id, num_frames)
    urls = await upload_locker_images(locker_id, frames, rental_id)

    if rental_id:
        await safe_emit("kiosk:images", {
            "kiosk_id": KIOSK_ID,
            "locker_id": locker_id,
            "image_urls": urls,
            "rental_id": rental_id,
        })
        # The AI verification pipeline runs server-side on the Node backend
        # from here — it can take several seconds (8 stages incl. a ResNet50
        # pass). Previously the kiosk went straight back to "idle" the
        # instant it uploaded, before that decision ever came back. Now it
        # waits in a dedicated "do not leave" state until Node's
        # "verification_done" command arrives (_cmd_verification_done below).
        _set_ui("verifying_item", "Checking your item — this takes about 15 seconds…")
    else:
        # Admin snapshot — no ML, just relay the URL to admin dashboard
        await safe_emit("kiosk:admin_snapshot", {
            "kiosk_id": KIOSK_ID,
            "locker_id": locker_id,
            "image_urls": urls,
        })
        _set_ui("idle", "Ready")

    log.info("Images sent locker=%s count=%s rental=%s", locker_id, len(urls), rental_id)


async def _cmd_verification_done(data: dict):
    """
    Node sends this right after deciding a kiosk:images verification
    (APPROVED/PENDING/RETRY/REJECTED) — see the "verification_done"
    kiosk:command emissions in index.ts's kiosk:images handler. Moves the
    kiosk screen out of the "verifying_item" do-not-leave state and shows
    the actual outcome, rather than leaving the user staring at a spinner
    indefinitely or (worse) having the screen silently sit on "idle" while
    a check it was told to wait for was still running.
    """
    result = data.get("result", "pending")
    locker_id = data.get("locker_id")
    if result == "approved":
        _set_ui("item_verified", "Item verified ✓", locker_id)
    elif result == "pending":
        _set_ui("item_verified", "Item received — pending manual review", locker_id)
    elif result == "retry":
        _set_ui("item_retry", "Please reposition the item and try again", locker_id)
    else:  # rejected
        _set_ui("error", "Item verification failed. Please contact staff.")
    log.info("Verification result for command_id=%s: %s", data.get("command_id"), result)


async def _cmd_capture_face(data: dict):
    reference_url = data.get("reference_face_url", "")
    # Preferred over reference_url when present — the Node backend decrypts
    # User.faceEncoding and sends the raw floats directly, skipping a
    # reference-image download + re-encode on the ML service side. Falls back
    # to reference_url for accounts registered before encoding capture existed.
    stored_encoding = data.get("stored_encoding")
    rental_id = data.get("rental_id")
    _set_ui("face_scan", "Please look directly at the camera…")

    cfg = load_timing_config()
    face_cfg = cfg.get("face_recognition", {})
    attempts = face_cfg.get("capture_attempts", 3)

    result = {"detected": False, "verified": False, "confidence": 0.0}

    for attempt in range(1, attempts + 1):
        frames = _camera.capture_face(num_frames=1)
        if not frames:
            break

        _set_ui("face_scan", f"Verifying… (attempt {attempt}/{attempts})")
        result = await verify_face(frames[0], reference_url, stored_encoding, rental_id)

        if result["detected"] and result["verified"]:
            break
        if result["detected"] and not result["verified"]:
            _set_ui("face_scan", "Face not recognised – please try again")
            await asyncio.sleep(1.5)

    await safe_emit("kiosk:face", {
        "kiosk_id": KIOSK_ID,
        "rental_id": data.get("rental_id"),
        "user_id": data.get("user_id"),
        **result,
    })

    if result.get("verified"):
        _set_ui("verified", "Identity verified ✓")
    else:
        _set_ui("idle", "Verification failed – please contact staff")


async def _cmd_flow_error(data: dict):
    message = data.get("message", "An error occurred – please try again")
    _set_ui("error", message)
    log.error("Flow error from server: %s", message)


async def _cmd_self_test(data: dict):
    """
    Real hardware self-test, triggered remotely from the admin Health Check
    page (see adminController.sendKioskCommand's "self_test" action) — lets
    an admin verify kiosk hardware without needing physical/SSH access to
    the Pi. Pulses every solenoid and actuator briefly, tries to open every
    camera and capture one frame, and reports pass/fail per component.

    Emits kiosk:self_test_result directly (in addition to the generic
    kiosk:ack _run_with_ack always sends) so the admin console gets a
    structured, itemized result rather than a single flag.
    """
    command_id = data.get("command_id", "")
    components: list[dict] = []

    _set_ui("busy", "Running hardware self-test…")

    # Solenoids — brief pulse (unlock then immediately re-lock) on both doors
    # of every locker.
    for locker_id in range(1, 5):
        for door in ("main_door", "bottom_door"):
            name = f"solenoid_{locker_id}_{door}"
            try:
                await _solenoid.unlock_for(locker_id, door, 0.3)
                components.append({"component": name, "ok": True})
            except Exception as e:
                components.append({"component": name, "ok": False, "error": str(e)})

    # Actuators — brief extend/retract pulse per locker.
    for locker_id in range(1, 5):
        name = f"actuator_{locker_id}"
        try:
            await _actuator.manual_extend(locker_id, 0.3)
            await _actuator.manual_retract(locker_id, 0.3)
            components.append({"component": name, "ok": True})
        except Exception as e:
            components.append({"component": name, "ok": False, "error": str(e)})

    # Cameras — one locker camera per locker + the face camera.
    for locker_id in range(1, 5):
        name = f"camera_locker_{locker_id}"
        try:
            frames = _camera.capture_locker(locker_id, num_frames=1)
            components.append({"component": name, "ok": bool(frames)})
        except Exception as e:
            components.append({"component": name, "ok": False, "error": str(e)})

    try:
        face_frames = _camera.capture_face(num_frames=1)
        components.append({"component": "camera_face", "ok": bool(face_frames)})
    except Exception as e:
        components.append({"component": "camera_face", "ok": False, "error": str(e)})

    # Tailscale/network connectivity to the backend is implicitly confirmed
    # by the fact that this command was received at all (it arrived over
    # the same Socket.io connection) — recorded explicitly anyway so the
    # admin UI can show it alongside the other checks rather than needing to
    # infer it.
    components.append({"component": "backend_connectivity", "ok": sio.connected})

    overall = "ok" if all(c["ok"] for c in components) else "degraded"

    await safe_emit("kiosk:self_test_result", {
        "kiosk_id": KIOSK_ID,
        "command_id": command_id,
        "overall": overall,
        "components": components,
    })

    log.info("Self-test complete: overall=%s (%d components)", overall, len(components))
    _set_ui("idle", "Self-test complete")


async def _cmd_lock_all(_data: dict):
    _solenoid.lock_all()
    _actuator.stop_all()
    _set_ui("idle", "Emergency lock engaged")
    await sio.emit("kiosk:status", _build_status())


async def _cmd_actuator_extend(data: dict):
    locker_id = int(data["locker_id"])
    cfg = load_timing_config()
    seconds = data.get("seconds") or cfg["lockers"][str(locker_id)]["actuator_extend_seconds"]
    # No speed parameter — actuators are relay-driven on/off (no PWM speed
    # control circuit exists), so a "speed" was accepted but silently ignored.
    await _actuator.manual_extend(locker_id, seconds)
    await sio.emit("kiosk:status", _build_status())


async def _cmd_actuator_retract(data: dict):
    locker_id = int(data["locker_id"])
    cfg = load_timing_config()
    seconds = data.get("seconds") or cfg["lockers"][str(locker_id)]["actuator_retract_seconds"]
    await _actuator.manual_retract(locker_id, seconds)
    await sio.emit("kiosk:status", _build_status())


# ── QR callback (set by kiosk_ui.server to push rental info to browser) ───────
_qr_callback = None


def register_qr_callback(cb):
    global _qr_callback
    _qr_callback = cb


# ── Kiosk-initiated rental flow ───────────────────────────────────────────────

async def emit_rental_lookup(rental_id: str):
    """Ask Node.js for rental details via socket — response comes back in on_rental_info.
    If offline the lookup is queued; the UI receives the info once reconnected."""
    await safe_emit("kiosk:rental_lookup", {
        "kiosk_id": KIOSK_ID,
        "rental_id": rental_id,
    })
    if not sio.connected:
        log.warning("Rental lookup queued (offline): %s", rental_id)


@sio.on("kiosk:rental_info")
async def on_rental_info(data: dict):
    """Node.js sends rental details back after a kiosk:rental_lookup request."""
    if _qr_callback:
        _qr_callback({
            "rental_id": data.get("rental_id", ""),
            "rental_info": data.get("rental_info") or {"id": data.get("rental_id", "")},
        })
    else:
        log.warning("Received kiosk:rental_info but no QR callback registered")


@sio.on("kiosk:session_validate")
async def on_session_validate(data: dict):
    """
    Node.js relays the session token + rental context from the Flutter app.

    If the token is valid AND a rental_id is present (app-initiated flow),
    skip the 'choose action' screen and go straight to facial recognition.

    If no rental_id, fall back to the legacy 'welcome / choose action' screen
    so the kiosk UI buttons still work.
    """
    from kiosk_ui.server import validate_qr_token_internal

    token     = data.get("token", "")
    rental_id = data.get("rentalId", "")
    mode      = data.get("mode", "")

    if not token:
        log.warning("kiosk:session_validate received with no token")
        return

    ok = validate_qr_token_internal(token)
    if not ok:
        log.warning("kiosk:session_validate failed — invalid or expired token")
        await safe_emit("kiosk:scan_error_relay", {
            "userId":   data.get("userId", ""),
            "rentalId": rental_id,
            "message":  "QR code expired or invalid — please scan again",
        })
        return

    log.info(
        "Kiosk session validated for user %s (rental=%s mode=%s)",
        data.get("userId"), rental_id or "none", mode or "none",
    )

    if rental_id:
        # App-initiated flow: go directly to face verification
        _mode_label = {
            "place":    "Deposit item",
            "retrieve": "Pick up item",
            "return":   "Return item",
        }.get(mode, "Process rental")
        _set_ui("face_scan", f"{_mode_label} — identity verification in progress…")
        await initiate_rental_flow(rental_id)
    else:
        # Legacy kiosk-UI flow: show welcome screen, wait for button press
        from kiosk_ui.server import local_sio as ui_sio
        ui_sio.emit("kiosk_session_started", {
            "userId":    data.get("userId", ""),
            "firstName": data.get("firstName", ""),
            "lastName":  data.get("lastName", ""),
        })
        _set_ui("session_active",
                f"Welcome, {data.get('firstName', 'User')}! Please choose an action.")


async def initiate_rental_flow(rental_id: str):
    """Called by local browser confirm → emit kiosk:flow_start to Node.js.
    Node.js looks up the rental and sends back capture_face command."""
    await safe_emit("kiosk:flow_start", {
        "kiosk_id": KIOSK_ID,
        "rental_id": rental_id,
    })
    if sio.connected:
        _set_ui("face_scan", "Preparing identity verification…")
        log.info("Rental flow start emitted for %s", rental_id)
    else:
        _set_ui("error", "Not connected to server – flow will resume when online")
        log.warning("Rental flow queued (offline): %s", rental_id)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_status() -> dict:
    return {
        "kiosk_id": KIOSK_ID,
        "ui_state": _ui_state,
        "config": load_timing_config(),
    }


async def _emit_error(message: str):
    await sio.emit("kiosk:error", {"kiosk_id": KIOSK_ID, "message": message})


# ── Connection lifecycle ───────────────────────────────────────────────────────

async def connect_to_server():
    while True:
        try:
            if sio.connected:
                await sio.disconnect()
            log.info("Connecting to %s …", SERVER_URL)
            if not KIOSK_SHARED_SECRET:
                log.warning(
                    "KIOSK_SHARED_SECRET is empty — the backend will refuse all "
                    "kiosk hardware events. Set it in the Pi .env to match the backend."
                )
            await sio.connect(
                SERVER_URL,
                transports=["websocket"],
                auth={"kioskSecret": KIOSK_SHARED_SECRET, "kioskId": KIOSK_ID},
            )
            await sio.wait()
        except Exception as e:
            log.error("Socket error: %s – reconnecting in 5s", e)
            await asyncio.sleep(5)
