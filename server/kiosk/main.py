"""
EngiRent Kiosk – main entry point.

Start order:
  1. Logging setup
  2. Load .env
  3. Check WiFi → if missing, run AP provisioning mode (blocks until reboot)
  4. Start local HDMI UI server (daemon thread)
  5. Start Socket.io client loop (blocks forever, reconnects on disconnect)
"""

import asyncio
import logging
import os
import sys
import time

from dotenv import load_dotenv

load_dotenv()

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s – %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("/var/log/engirent-kiosk.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("kiosk.main")

# ── Provisioning ───────────────────────────────────────────────────────────────
from provisioning.wifi_manager import is_wifi_connected
from provisioning.ap_portal import (
    AP_SSID, AP_PASSWORD, AP_IP,
    run_portal, start_ap_mode,
)


def maybe_provision():
    """If no WiFi, start hotspot + captive portal and block (Pi reboots after connect)."""
    if is_wifi_connected():
        log.info("WiFi connected – skipping provisioning.")
        return

    log.warning("No WiFi connection detected – entering provisioning mode.")

    ap_ssid = os.getenv("AP_SSID", AP_SSID)
    ap_pass = os.getenv("AP_PASSWORD", AP_PASSWORD)
    ap_ip   = os.getenv("AP_IP", AP_IP)

    if not start_ap_mode(ssid=ap_ssid, password=ap_pass, ip=ap_ip):
        log.error("Could not start AP hotspot – skipping provisioning (will retry next boot).")
        return

    log.info(
        "Hotspot active.  Connect to '%s' (pw: %s) and open http://%s",
        ap_ssid, ap_pass, ap_ip,
    )

    # This call blocks until the Pi reboots (reboot() is called inside the portal
    # after a successful WiFi connect, so this loop never returns normally).
    run_portal(host="0.0.0.0", port=80)

    # Fallback: if portal exits without rebooting, wait and retry
    log.error("Portal exited unexpectedly – sleeping 10 s then retrying.")
    time.sleep(10)
    maybe_provision()


# ── UI server ──────────────────────────────────────────────────────────────────
from kiosk_ui.server import start_ui_server_thread


# ── Socket.io client ───────────────────────────────────────────────────────────
from services.socket_client import KioskSocketClient


async def run_socket_client():
    server_url = os.getenv("SERVER_URL", "http://localhost:3001")
    kiosk_id   = os.getenv("KIOSK_ID", "kiosk-1")

    client = KioskSocketClient(server_url=server_url, kiosk_id=kiosk_id)

    backoff = 5
    while True:
        try:
            log.info("Connecting to server: %s", server_url)
            await client.connect()
            await client.wait()          # blocks until disconnect
            log.warning("Socket disconnected – reconnecting in %ss…", backoff)
        except Exception as exc:
            log.error("Socket error: %s", exc)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)   # exponential back-off, cap 60 s


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    log.info("EngiRent Kiosk starting…")

    # 1. WiFi check / provisioning (blocks if no WiFi)
    maybe_provision()

    # 2. Local HDMI UI (daemon thread – dies with main process)
    start_ui_server_thread()
    log.info("HDMI UI server started on port %s", os.getenv("UI_PORT", "8080"))

    # 3. Socket.io event loop (runs forever)
    try:
        asyncio.run(run_socket_client())
    except KeyboardInterrupt:
        log.info("Kiosk stopped by user.")


if __name__ == "__main__":
    main()
