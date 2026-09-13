"""
Captive-portal Flask app for first-boot WiFi provisioning.

Flow:
  1. Pi boots without WiFi → main.py calls start_ap_mode() (creates hotspot via nmcli)
  2. Admin connects phone/laptop to "EngiRent-Kiosk-Setup" AP
  3. Browser opens 192.168.4.1 → shows available networks + credential form
  4. On submit → connect_wifi() → reboot on success
"""

import logging
import threading

from flask import Flask, jsonify, redirect, render_template_string, request, url_for

from .hotspot import HotspotError, start_hotspot, stop_hotspot, validate_psk
from .wifi_manager import connect_wifi, get_available_networks, reboot

log = logging.getLogger("kiosk.ap")

AP_SSID     = "EngiRent-Kiosk-Setup"
AP_PASSWORD = ""   # deliberately empty: a default in a public repo IS a
                   # published credential (S-10). Set AP_PASSWORD in the
                   # Pi's server/kiosk/.env; both callers refuse without it.
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
    Create a WiFi hotspot so whoever is provisioning can connect and choose a
    network. Returns True only if the hotspot is really up.

    D-77: this used to drive nmcli itself and got four things wrong, all
    silently, because every return code was discarded. It addressed the profile
    by SSID when `nmcli dev wifi hotspot` names it `Hotspot`, so the static
    address was never applied and the log claimed 192.168.4.1 while the radio
    sat on 10.42.0.1; it set `ipv4.method manual`, so no DHCP or DNS ran and no
    phone could get an address; it tore down by SSID, so it could not remove
    what it had made and stranded the kiosk on its own hotspot until someone
    power-cycled it; and it passed the PSK on nmcli's argv, which is readable
    by any local process through /proc. `hotspot.start_hotspot` fixes all four
    and reads the address back off the interface, so this delegates to it
    rather than keeping a second, worse implementation alive.
    """
    try:
        validate_psk(password)
    except HotspotError as exc:
        # S-10: there is no default PSK any more. Refusing is better than
        # raising a hotspot whose password is published in a public repo --
        # joining it means choosing which network this kiosk trusts, over a
        # plain-http SERVER_URL.
        log.error("refusing to start the setup hotspot: %s", exc)
        return False

    try:
        start_hotspot(ssid, password, ip)
        return True
    except HotspotError as exc:
        log.error("AP hotspot failed: %s", exc)
        return False


def stop_ap_mode(ssid: str = AP_SSID) -> None:
    """Take the hotspot down so NetworkManager rejoins saved client networks.

    D-77 again: deleting by SSID could never remove the profile, because it is
    named `engirent-setup-hotspot` (or, for anything older, `Hotspot`).
    `stop_hotspot` targets the explicit id, deletes the keyfile, and removes a
    legacy `Hotspot` profile only when its SSID is ours.
    """
    try:
        stop_hotspot(ssid)
    except Exception as exc:                      # pragma: no cover - defensive
        log.error("stop_ap_mode error: %s", exc)


def run_portal(host: str = "0.0.0.0", port: int = 80):
    """Block and serve the captive portal (call from main provisioning thread)."""
    log.info("Captive portal listening on %s:%s", host, port)
    portal.run(host=host, port=port, debug=False, use_reloader=False)
