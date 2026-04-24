"""
Local Flask server driving the HDMI kiosk display.
Port UI_PORT (default 8080).

Routes:
  GET  /                     → Kiosk UI HTML
  GET  /api/state            → current kiosk state
  POST /api/ui               → push state from socket_client
  GET  /camera/face/stream   → MJPEG stream (face / QR camera)
"""

import logging
import threading
import time

from flask import Flask, Response, jsonify, render_template, request
from flask_socketio import SocketIO, emit

from config import UI_PORT, FACE_CAMERA_INDEX, MOCK_CAMERA

log = logging.getLogger("kiosk.ui")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = "kiosk-local-ui-secret"
local_sio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── Shared camera state ────────────────────────────────────────────────────────
_frame_lock   = threading.Lock()
_latest_jpeg: bytes | None = None
_qr_active    = False
_qr_cooldown  = 3.0   # seconds between consecutive QR detections


def _get_face_cam_path() -> str:
    """Map FACE_CAMERA_INDEX to a /dev/videoN path (USB cameras enumerate
    as pairs — video0/1, video2/3, … so physical index N → /dev/video(N*2))."""
    candidates = [
        f"/dev/video{FACE_CAMERA_INDEX * 2}",
        f"/dev/video{FACE_CAMERA_INDEX * 2 + 1}",
        "/dev/video10",
        "/dev/video8",
    ]
    return candidates  # caller tries each


def _placeholder_jpeg() -> bytes:
    """Return a tiny 1×1 dark JPEG for MOCK_CAMERA mode."""
    try:
        import cv2, numpy as np
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(img, "MOCK CAMERA", (160, 240),
                    cv2.FONT_HERSHEY_SIMPLEX, 2, (80, 80, 80), 3)
        _, buf = cv2.imencode(".jpg", img)
        return buf.tobytes()
    except Exception:
        # Minimal valid JPEG (black 1×1)
        return (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
            b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
            b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
            b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\x1e\x1f\x00\x00\x00'
            b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00'
            b'\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00'
            b'\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b'
            b'\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01}'
            b'\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07"q\x142\x81\x91\xa1\x08#B\xb1'
            b'\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a%&\'()*456789:CDEFGHIJ'
            b'STUVWXYZ cdefghijstuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97'
            b'\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9'
            b'\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda'
            b'\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa'
            b'\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd8\xff\xd9'
        )


# ── Camera / QR worker ─────────────────────────────────────────────────────────

def _camera_worker():
    """Single thread owns the face camera — serves MJPEG frames and runs QR scan."""
    global _latest_jpeg, _qr_active

    if MOCK_CAMERA:
        placeholder = _placeholder_jpeg()
        with _frame_lock:
            _latest_jpeg = placeholder
        log.info("Mock camera active — serving placeholder frame")
        while True:
            time.sleep(1)
        return

    import cv2

    cap = None
    for path in _get_face_cam_path():
        try:
            c = cv2.VideoCapture(path, cv2.CAP_V4L2)
            if c.isOpened():
                cap = c
                log.info("Face camera opened: %s", path)
                break
            c.release()
        except Exception:
            continue

    if cap is None:
        log.warning("V4L2 open failed — falling back to index %s", FACE_CAMERA_INDEX)
        cap = cv2.VideoCapture(FACE_CAMERA_INDEX)

    if not cap.isOpened():
        log.error("Could not open face camera — MJPEG stream will be blank")
        with _frame_lock:
            _latest_jpeg = _placeholder_jpeg()
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)

    qr_detector  = cv2.QRCodeDetector()
    last_qr_time = 0.0

    log.info("Camera worker running")
    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.05)
            continue

        _, jpeg_buf = cv2.imencode(".jpg", frame,
                                   [cv2.IMWRITE_JPEG_QUALITY, 75])
        with _frame_lock:
            _latest_jpeg = jpeg_buf.tobytes()

        now = time.monotonic()
        if _qr_active and (now - last_qr_time) > _qr_cooldown:
            try:
                qr_data, _, _ = qr_detector.detectAndDecode(frame)
                if qr_data:
                    last_qr_time = now
                    log.info("QR detected: %s", qr_data)
                    _handle_qr(qr_data.strip())
            except Exception as exc:
                log.debug("QR detection error: %s", exc)

        time.sleep(0.033)   # ~30 fps cap

    cap.release()


def _handle_qr(rental_id: str):
    """Request rental info from Node.js via socket (no HTTP needed).
    The result comes back through socket_client's on_rental_info → _qr_result_cb."""
    from services.socket_client import emit_rental_lookup, get_main_loop
    import asyncio
    loop = get_main_loop()
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(emit_rental_lookup(rental_id), loop)
    else:
        # Loop not ready yet — push minimal info so UI can still proceed
        log.warning("Asyncio loop unavailable — pushing bare rental_id")
        local_sio.emit("qr_scanned", {"rental_id": rental_id, "rental_info": {"id": rental_id}})


def _qr_result_cb(data: dict):
    """Called by socket_client when kiosk:rental_info comes back from Node.js."""
    local_sio.emit("qr_scanned", data)


# ── MJPEG generator ────────────────────────────────────────────────────────────

def _mjpeg_gen():
    while True:
        with _frame_lock:
            frame = _latest_jpeg
        if frame is None:
            time.sleep(0.05)
            continue
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + frame
            + b"\r\n"
        )
        time.sleep(0.033)


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def api_state():
    from services.socket_client import get_ui_state
    return jsonify(get_ui_state())


@app.route("/api/ui", methods=["POST"])
def update_ui():
    data = request.get_json(force=True)
    local_sio.emit("state_update", data)
    return jsonify({"ok": True})


@app.route("/camera/face/stream")
def face_stream():
    return Response(
        _mjpeg_gen(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


# ── Local Socket.io events ─────────────────────────────────────────────────────

@local_sio.on("connect")
def on_browser_connect():
    from services.socket_client import get_ui_state
    emit("state_update", get_ui_state())


@local_sio.on("set_qr_mode")
def on_set_qr_mode(data):
    global _qr_active
    _qr_active = bool(data.get("active", False))
    log.info("QR scan mode: %s", "ON" if _qr_active else "OFF")


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
    from services.socket_client import register_qr_callback
    register_qr_callback(_qr_result_cb)

    cam_t = threading.Thread(target=_camera_worker, daemon=True, name="cam-worker")
    cam_t.start()
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
