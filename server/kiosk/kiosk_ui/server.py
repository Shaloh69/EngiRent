"""
Local Flask server that drives the HDMI kiosk display.

Runs on port UI_PORT (default 8080).
Chromium is launched in kiosk mode pointing at http://localhost:8080

Routes:
  GET  /            → Kiosk UI HTML
  GET  /api/state   → current kiosk state (polled by UI)
  POST /api/ui      → update UI state from socket_client

Socket.io (local only) for real-time UI pushes.
"""

import logging
import threading

from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO, emit

from config import UI_PORT
from services.socket_client import get_ui_state

log = logging.getLogger("kiosk.ui")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = "kiosk-local-ui-secret"
local_sio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

_last_state: dict = {}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def api_state():
    return jsonify(get_ui_state())


@app.route("/api/ui", methods=["POST"])
def update_ui():
    """Called by socket_client to push state changes to the browser."""
    data = request.get_json(force=True)
    local_sio.emit("state_update", data)
    return jsonify({"ok": True})


@local_sio.on("connect")
def on_browser_connect():
    emit("state_update", get_ui_state())


def run_ui_server():
    log.info("Kiosk UI server starting on port %s", UI_PORT)
    local_sio.run(app, host="0.0.0.0", port=UI_PORT, use_reloader=False, log_output=False)


def start_ui_server_thread():
    t = threading.Thread(target=run_ui_server, daemon=True)
    t.start()
    return t
