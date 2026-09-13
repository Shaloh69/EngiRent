"""
Standalone Wi-Fi setup mode (D-76) — hotspot + captive portal, as root.

Why this exists: the setup portal only ever ran inside `main.py`'s startup, as
the service user `engirent`, and measured on the live Pi 2026-09-13 that user
can do none of what it needs:

    bind port 80 for the portal        -> [Errno 13] Permission denied
    wifi.share.protected (the hotspot) -> no
    settings.modify.system (save SSID) -> auth, with no agent to answer

So first-boot provisioning could never have worked on the deployed kiosk; it
went unnoticed only because the kiosk always had Wi-Fi at boot. This module is
the same hotspot and the same portal, run as a separate root process.

Run (on the Pi, from server/kiosk):
    sudo systemd-run --unit=engirent-wifi-setup --collect \
        -p EnvironmentFile=$PWD/.env -p WorkingDirectory=$PWD \
        $PWD/venv/bin/python -m provisioning.setup_mode

**It gives up on its own.** If nobody completes setup within
SETUP_MODE_TIMEOUT_MIN (default 20), it removes the hotspot and exits, and
NetworkManager reconnects to the saved networks. An unattended kiosk must never
be left hiding behind its own hotspot because nobody came.

It holds no GPIO and imports nothing from hardware/. The controller keeps
running beside it with every relay claimed at the locked level.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading

from dotenv import load_dotenv

load_dotenv()

from .ap_portal import AP_IP, AP_SSID, run_portal, start_ap_mode  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s")
log = logging.getLogger("kiosk.setup_mode")


def teardown_hotspot(ssid: str) -> None:
    """Remove the hotspot profile so NetworkManager falls back to saved client
    networks. Best-effort: both commands are harmless if it is already gone."""
    for args in (["nmcli", "con", "down", ssid], ["nmcli", "con", "delete", ssid]):
        subprocess.run(args, capture_output=True, text=True, timeout=15)


def main() -> int:
    if os.geteuid() != 0:
        log.error("setup mode must run as root (the service user cannot bind :80 or create a hotspot — D-76)")
        return 2

    ssid = os.getenv("AP_SSID", AP_SSID)
    ip = os.getenv("AP_IP", AP_IP)
    password = os.getenv("AP_PASSWORD", "")
    if len(password) < 8:
        # WPA2 requires 8+. Refusing is better than raising an open hotspot that
        # lets anyone choose which network this kiosk trusts.
        log.error("AP_PASSWORD missing or shorter than 8 characters — refusing to start an open hotspot")
        return 3

    timeout_min = max(1, int(os.getenv("SETUP_MODE_TIMEOUT_MIN", "20")))

    if not start_ap_mode(ssid=ssid, password=password, ip=ip):
        log.error("hotspot failed to start")
        return 4

    def _give_up():
        log.warning("no network chosen within %d min — removing hotspot, reconnecting to saved Wi-Fi", timeout_min)
        teardown_hotspot(ssid)
        os._exit(0)

    timer = threading.Timer(timeout_min * 60, _give_up)
    timer.daemon = True
    timer.start()

    log.info("SETUP MODE: join Wi-Fi '%s' and open http://%s  (gives up in %d min)", ssid, ip, timeout_min)
    run_portal(host="0.0.0.0", port=80)   # blocks; a successful save reboots the Pi
    return 0


if __name__ == "__main__":
    sys.exit(main())
