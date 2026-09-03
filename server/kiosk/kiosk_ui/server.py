"""
Local Flask server driving the HDMI kiosk display.
Port UI_PORT (default 8080).

The frontend itself is the React/Vite app in ../kiosk_ui_react (built to
dist/, served as static files below) — this module is now purely the
backend half: state/session REST endpoints, the MJPEG camera stream, and
the local Socket.IO channel the frontend uses for real-time state pushes.

Routes:
  GET  /                     → Kiosk UI (React build's index.html)
  GET  /api/state            → current kiosk state
  POST /api/ui               → push state from socket_client

(The /camera/face/stream MJPEG route was removed 2026-09-03 along with the
face camera it served — verification moved to the user's phone, design
mandate §2.13.)
"""

import hashlib
import logging
import os
import threading
import time
import uuid

from flask import Flask, jsonify, request, send_from_directory
from flask_socketio import SocketIO, emit

from config import UI_PORT, SERVER_URL

log = logging.getLogger("kiosk.ui")

# Serves the built React/Vite frontend (server/kiosk/kiosk_ui_react/dist) —
# migrated from the prior Flask-templates + vanilla-JS UI (design mandate,
# docs/planning/02-design-mandate.md, resolved 2026-08-06: React/Vite so the
# kiosk shares the same Framer Motion/animation stack as the other surfaces).
# `npm run build` in kiosk_ui_react/ regenerates dist/ after any UI change.
_REACT_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "kiosk_ui_react",
    "dist",
)

app = Flask(__name__, static_folder=_REACT_DIST, static_url_path="")
app.config["SECRET_KEY"] = "kiosk-local-ui-secret"
local_sio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# The face camera, its MJPEG worker thread, and the QR-decode-from-camera
# loop that used to live here were removed 2026-09-03. They existed to
# support the kiosk scanning a QR shown on the user's phone — the reversed
# direction from how hand-off actually works (the kiosk displays its own
# code via /api/qr-token below; the phone scans it with mobile_scanner). The
# only camera that fed this was the face camera, which no longer exists —
# see design mandate §2.13 and camera_manager.py's header comment. Removing
# it here rather than leaving it in place avoids a thread that spins forever
# trying to open hardware that's gone.


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(_REACT_DIST, "index.html")


@app.route("/api/state")
def api_state():
    from services.socket_client import get_ui_state
    return jsonify(get_ui_state())


@app.route("/api/ui", methods=["POST"])
def update_ui():
    data = request.get_json(force=True)
    local_sio.emit("state_update", data)
    return jsonify({"ok": True})


# ── QR session token ──────────────────────────────────────────────────────────

_active_qr_token: str | None = None
_qr_token_expiry: float = 0.0
_QR_TTL = 90.0  # seconds

_KIOSK_SECRET = os.getenv("KIOSK_SECRET", "engirent-kiosk-secret")


def _make_session_token() -> str:
    """Generate a signed, time-limited session token the app will scan."""
    token_id = uuid.uuid4().hex
    ts = str(int(time.time()))
    kiosk_id = os.getenv("KIOSK_ID", "kiosk-1")
    payload = f"{kiosk_id}:{token_id}:{ts}"
    sig = hashlib.sha256(f"{payload}:{_KIOSK_SECRET}".encode()).hexdigest()[:16]
    return f"{payload}:{sig}"


@app.route("/api/qr-token", methods=["GET"])
def get_qr_token():
    """
    Return current session token (generate new one if expired).
    The kiosk display JS polls this to render the QR code image.
    """
    global _active_qr_token, _qr_token_expiry
    now = time.monotonic()
    if _active_qr_token is None or now >= _qr_token_expiry:
        _active_qr_token = _make_session_token()
        _qr_token_expiry = now + _QR_TTL
        log.debug("New kiosk QR token generated")
    remaining = max(0, int(_qr_token_expiry - now))
    return jsonify({
        "token": _active_qr_token,
        "expires_in": remaining,
        "ttl": int(_QR_TTL),
        "ttl_seconds": remaining,
    })


def validate_qr_token_internal(token: str) -> bool:
    """
    Pure-Python helper used by socket_client.py to validate a session token
    without going through HTTP.  Returns True if the token is valid and not expired.
    Invalidates the token on success (single-use).
    """
    global _active_qr_token
    now = time.monotonic()
    if (
        token
        and _active_qr_token is not None
        and token == _active_qr_token
        and now < _qr_token_expiry
    ):
        _active_qr_token = None  # invalidate — single use
        return True
    return False


# Cached catalogue, so the kiosk's "Browse gear" screen doesn't hit the API
# on every open and doesn't stall the UI when the network is down.
_catalogue_cache: dict | None = None
_catalogue_expiry: float = 0.0
_CATALOGUE_TTL = 120.0


@app.route("/api/catalogue", methods=["GET"])
def get_catalogue():
    """
    Proxy a trimmed, public view of available listings for the kiosk's
    promotional catalogue screen (design mandate S4 - the kiosk is also a
    promotional surface, not only a transaction terminal).

    Proxied rather than called from the browser for two reasons: the kiosk UI
    is served from a different origin than the Node API, and this is the only
    layer that knows SERVER_URL. Nothing user-specific is returned, so no auth
    token is involved.
    """
    global _catalogue_cache, _catalogue_expiry
    now = time.monotonic()
    if _catalogue_cache is not None and now < _catalogue_expiry:
        return jsonify(_catalogue_cache)

    try:
        import urllib.request
        import json as _json

        url = f"{SERVER_URL}/api/v1/items?limit=12&isAvailable=true"
        with urllib.request.urlopen(url, timeout=4) as resp:
            payload = _json.loads(resp.read().decode("utf-8"))

        rows = (payload.get("data") or {}).get("items") or []
        items = [
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "category": r.get("category"),
                "pricePerDay": r.get("pricePerDay"),
                "securityDeposit": r.get("securityDeposit"),
                "images": r.get("images") or [],
                "isAvailable": r.get("isAvailable", True),
            }
            for r in rows
        ]
        _catalogue_cache = {"items": items}
        _catalogue_expiry = now + _CATALOGUE_TTL
        return jsonify(_catalogue_cache)
    except Exception as exc:  # noqa: BLE001 - kiosk must never 500 on this
        log.warning("Catalogue fetch failed: %s", exc)
        # Serve stale rather than nothing: an outdated shelf still tells a
        # passer-by what this machine is for.
        if _catalogue_cache is not None:
            return jsonify(_catalogue_cache)
        return jsonify({"items": [], "error": "unavailable"}), 200


@app.route("/api/qr-validate", methods=["POST"])
def validate_qr_token():
    """
    Called by Node.js (via socket or REST) after the app sends the scanned token.
    Returns ok=True if the token matches the active session and hasn't expired.
    """
    data = request.get_json(force=True) or {}
    token = data.get("token", "")
    now = time.monotonic()
    if validate_qr_token_internal(token):
        kiosk_id = os.getenv("KIOSK_ID", "kiosk-1")
        user_info = data.get("user") or {}
        local_sio.emit("kiosk_session_started", {
            "kioskId": kiosk_id,
            "userId": data.get("userId", ""),
            "firstName": user_info.get("firstName", ""),
            "lastName": user_info.get("lastName", ""),
        })
        log.info("Kiosk session started for user %s", data.get("userId", "unknown"))
        return jsonify({"ok": True, "kiosk_id": kiosk_id})
    return jsonify({"ok": False, "message": "Token invalid or expired"}), 400


# ── Local Socket.io events ─────────────────────────────────────────────────────

@local_sio.on("connect")
def on_browser_connect():
    from services.socket_client import get_ui_state
    emit("state_update", get_ui_state())


# set_qr_mode: still emitted by the React frontend's dead "qr" screen (see
# useKioskState.ts) but has had no camera to toggle since 2026-09-03. No
# handler is registered for it any more — a silently-ignored socket event,
# not an error.


@local_sio.on("user_confirm")
def on_user_confirm(data):
    """Browser confirmed rental — schedule initiate_rental_flow on the asyncio loop."""
    rental_id = (data or {}).get("rental_id", "")
    if not rental_id:
        return
    try:
        import asyncio
        from services.socket_client import initiate_rental_flow, get_main_loop
        loop = get_main_loop()
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(initiate_rental_flow(rental_id), loop)
            log.info("Rental flow started: %s", rental_id)
        else:
            log.error("Asyncio loop not available — cannot start rental flow")
    except Exception as exc:
        log.error("user_confirm error: %s", exc)


# ── Server startup ─────────────────────────────────────────────────────────────

def run_ui_server():
    log.info("Kiosk UI server starting on port %s", UI_PORT)
    local_sio.run(
        app,
        host="0.0.0.0",
        port=UI_PORT,
        use_reloader=False,
        log_output=False,
        allow_unsafe_werkzeug=True,
    )


def start_ui_server_thread():
    t = threading.Thread(target=run_ui_server, daemon=True, name="ui-server")
    t.start()
    return t
