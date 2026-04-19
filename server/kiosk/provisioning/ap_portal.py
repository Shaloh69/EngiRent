"""
Captive-portal Flask app for first-boot WiFi provisioning.

Flow:
  1. Pi boots without WiFi → main.py calls start_ap_mode() (creates hotspot via nmcli)
  2. Admin connects phone/laptop to "EngiRent-Kiosk-Setup" AP
  3. Browser opens 192.168.4.1 → shows available networks + credential form
  4. On submit → connect_wifi() → reboot on success
"""

import logging
import subprocess
import threading

from flask import Flask, jsonify, redirect, render_template_string, request, url_for

from .wifi_manager import connect_wifi, get_available_networks, reboot

log = logging.getLogger(__name__)

AP_SSID     = "EngiRent-Kiosk-Setup"
AP_PASSWORD = "engirent123"   # env-override in main.py
AP_IP       = "192.168.4.1"

# ── HTML template (self-contained, no external deps) ──────────────────────────
_PORTAL_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>EngiRent – WiFi Setup</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0a0f1e;color:#f1f5f9;
         min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
    .card{background:#111827;border:1px solid #1e2d45;border-radius:14px;
          padding:32px;width:100%;max-width:420px}
    h1{font-size:22px;font-weight:700;margin-bottom:4px}
    p.sub{font-size:13px;color:#64748b;margin-bottom:24px}
    label{font-size:13px;color:#94a3b8;display:block;margin-bottom:4px}
    select,input{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #1e2d45;
                 background:#0a0f1e;color:#f1f5f9;font-size:15px;margin-bottom:16px}
    button{width:100%;padding:12px;border-radius:8px;border:none;
           background:#2563eb;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
    button:active{opacity:.85}
    .msg{margin-top:16px;padding:12px;border-radius:8px;font-size:14px;text-align:center}
    .msg.ok {background:rgba(16,185,129,.2);color:#10b981;border:1px solid #10b981}
    .msg.err{background:rgba(239,68,68,.2); color:#ef4444;border:1px solid #ef4444}
    .nets{margin-bottom:8px}
    .net-btn{width:100%;text-align:left;padding:10px 14px;margin-bottom:6px;
             border-radius:8px;border:1px solid #1e2d45;background:#0a0f1e;
             color:#f1f5f9;cursor:pointer;font-size:14px;display:flex;
             justify-content:space-between;align-items:center}
    .net-btn:hover{border-color:#2563eb}
    .sig{font-size:12px;color:#64748b}
    .sec{font-size:11px;background:#1e2d45;border-radius:4px;padding:2px 6px;color:#94a3b8}
  </style>
</head>
<body>
<div class="card">
  <h1>EngiRent Hub</h1>
  <p class="sub">Connect this kiosk to your WiFi network</p>

  {% if message %}
  <div class="msg {{ 'ok' if success else 'err' }}">{{ message }}</div>
  {% endif %}

  {% if not success %}
  <form method="POST" action="/connect">
    <label>Select Network</label>
    <div class="nets">
      {% for n in networks %}
      <button type="button" class="net-btn" onclick="selectNet(this,'{{ n.ssid }}')">
        <span>{{ n.ssid }}</span>
        <span>
          <span class="sec">{{ n.security }}</span>
          &nbsp;<span class="sig">{{ n.signal }}%</span>
        </span>
      </button>
      {% endfor %}
    </div>

    <label>SSID</label>
    <input type="text" name="ssid" id="ssid" placeholder="Network name" required
           value="{{ prefill_ssid or '' }}"/>

    <label>Password</label>
    <input type="password" name="password" id="password" placeholder="Leave blank if open"/>

    <button type="submit">Connect &amp; Reboot</button>
  </form>
  {% else %}
  <p style="text-align:center;color:#10b981;margin-top:12px">
    Rebooting in a few seconds…
  </p>
  {% endif %}
</div>

<script>
function selectNet(btn, ssid) {
  document.getElementById('ssid').value = ssid;
  document.getElementById('password').value = '';
  document.getElementById('password').focus();
}
</script>
</body>
</html>"""


# ── Flask app ──────────────────────────────────────────────────────────────────
portal = Flask(__name__)
portal.secret_key = "engirent-provisioning"


@portal.route("/", methods=["GET"])
def index():
    networks = get_available_networks()
    return render_template_string(_PORTAL_HTML, networks=networks,
                                  message=None, success=False, prefill_ssid=None)


@portal.route("/connect", methods=["POST"])
def connect():
    ssid     = request.form.get("ssid", "").strip()
    password = request.form.get("password", "").strip()

    if not ssid:
        networks = get_available_networks()
        return render_template_string(_PORTAL_HTML, networks=networks,
                                      message="SSID is required.", success=False,
                                      prefill_ssid=None)

    ok, msg = connect_wifi(ssid, password)
    networks = get_available_networks()

    if ok:
        # Reboot in background so Flask can return the response first
        threading.Thread(target=reboot, args=(3,), daemon=True).start()
        return render_template_string(_PORTAL_HTML, networks=networks,
                                      message=f"Connected to {ssid}! Rebooting…",
                                      success=True, prefill_ssid=ssid)
    else:
        return render_template_string(_PORTAL_HTML, networks=networks,
                                      message=f"Failed: {msg}",
                                      success=False, prefill_ssid=ssid)


@portal.route("/api/networks")
def api_networks():
    return jsonify(get_available_networks())


@portal.route("/api/connect", methods=["POST"])
def api_connect():
    data     = request.get_json(force=True) or {}
    ssid     = data.get("ssid", "").strip()
    password = data.get("password", "").strip()
    if not ssid:
        return jsonify({"ok": False, "message": "SSID required"}), 400
    ok, msg = connect_wifi(ssid, password)
    if ok:
        threading.Thread(target=reboot, args=(3,), daemon=True).start()
    return jsonify({"ok": ok, "message": msg})


# ── AP helpers ─────────────────────────────────────────────────────────────────

def start_ap_mode(ssid: str = AP_SSID, password: str = AP_PASSWORD,
                  ip: str = AP_IP) -> bool:
    """
    Create a WiFi hotspot using nmcli so the admin can connect and provision.
    Returns True if hotspot started successfully.
    """
    try:
        # Delete any leftover hotspot profile
        subprocess.run(["nmcli", "con", "delete", ssid],
                       capture_output=True, timeout=5)
    except Exception:
        pass

    try:
        result = subprocess.run(
            [
                "nmcli", "dev", "wifi", "hotspot",
                "ifname", "wlan0",
                "ssid",   ssid,
                "password", password,
            ],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            log.error("AP hotspot failed: %s", result.stderr.strip())
            return False

        # Set static IP on the hotspot interface
        subprocess.run(
            ["nmcli", "con", "modify", ssid,
             "ipv4.addresses", f"{ip}/24",
             "ipv4.method", "manual"],
            capture_output=True, timeout=5,
        )
        subprocess.run(["nmcli", "con", "up", ssid],
                       capture_output=True, timeout=10)
        log.info("AP hotspot started: SSID=%s  IP=%s", ssid, ip)
        return True
    except Exception as e:
        log.error("start_ap_mode error: %s", e)
        return False


def stop_ap_mode(ssid: str = AP_SSID):
    try:
        subprocess.run(["nmcli", "con", "delete", ssid],
                       capture_output=True, timeout=5)
        log.info("AP hotspot stopped.")
    except Exception as e:
        log.error("stop_ap_mode error: %s", e)


def run_portal(host: str = "0.0.0.0", port: int = 80):
    """Block and serve the captive portal (call from main provisioning thread)."""
    log.info("Captive portal listening on %s:%s", host, port)
    portal.run(host=host, port=port, debug=False, use_reloader=False)
