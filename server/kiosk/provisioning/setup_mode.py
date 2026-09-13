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

import atexit
import logging
import os
import sys
import threading

from dotenv import load_dotenv

load_dotenv()

from .ap_portal import AP_IP, AP_SSID, portal, run_portal  # noqa: E402
# NOT ap_portal.start_ap_mode: it could never set the address and ran no DHCP (D-77).
from .hotspot import HotspotError, start_hotspot, stop_hotspot  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s")
log = logging.getLogger("kiosk.setup_mode")


# ── Captive portal: make the phone open the setup page by itself ──────────────
#
# Asked for by the user 2026-09-13 after typing http://192.168.4.1 by hand.
# Phones decide whether a network needs a sign-in page by fetching a known URL
# right after joining and checking for an exact answer (Android: HTTP 204 from
# generate_204; Apple: a page whose body is "Success"). Anything else means
# "captive portal", and the phone surfaces the page. Two parts:
#
#   1. DNS — every name must resolve to this kiosk, or the probe never reaches
#      us. NetworkManager's shared (hotspot) mode runs dnsmasq and reads
#      /etc/NetworkManager/dnsmasq-shared.d/ at start, so a wildcard `address=`
#      line goes there BEFORE the hotspot is raised.
#   2. HTTP — the probe paths, and any unknown path on any Host, redirect to the
#      setup page.
#
# Honest limits: iOS opens its captive sheet automatically; most Android builds
# show a "Sign in to Wi-Fi network" notification the user taps. HTTPS probes
# cannot be answered without a certificate warning, which is why phones use
# plain-HTTP ones for exactly this.

DNSMASQ_SHARED_DIR = "/etc/NetworkManager/dnsmasq-shared.d"
DNS_HIJACK_NAME = "engirent-captive-portal.conf"

#: Probe paths used by the major platforms' captive-portal checks.
CAPTIVE_PROBE_PATHS = (
    "/generate_204", "/gen_204",                       # Android / Chrome
    "/hotspot-detect.html", "/library/test/success.html",  # Apple
    "/connecttest.txt", "/ncsi.txt", "/redirect",      # Windows
    "/success.txt", "/canonical.html",                 # Firefox
)


def captive_dns_conf(ip: str) -> str:
    return (
        "# Written by EngiRent provisioning/setup_mode.py while in Wi-Fi setup mode.\n"
        "# Resolves EVERY name to the kiosk so phones find the setup page (captive portal).\n"
        "# Removed when setup mode ends; a stale copy only affects NetworkManager hotspots.\n"
        f"address=/#/{ip}\n"
    )


def install_dns_hijack(ip: str, directory: str = DNSMASQ_SHARED_DIR) -> str | None:
    """Write the wildcard DNS rule. Returns the path, or None if the directory
    does not exist (setup mode still works; the phone just won't auto-open)."""
    if not os.path.isdir(directory):
        log.warning("%s missing — captive auto-open disabled, portal still at http://%s", directory, ip)
        return None
    path = os.path.join(directory, DNS_HIJACK_NAME)
    with open(path, "w", encoding="utf-8") as f:
        f.write(captive_dns_conf(ip))
    return path


def remove_dns_hijack(directory: str = DNSMASQ_SHARED_DIR) -> bool:
    path = os.path.join(directory, DNS_HIJACK_NAME)
    try:
        os.remove(path)
        return True
    except FileNotFoundError:
        return False


def install_captive_routes(app, ip: str) -> None:
    """Probe paths and unknown paths redirect to the setup page. The portal's own
    routes (`/`, `/connect`, `/api/*`) are untouched, so the page itself and its
    form still work. Idempotent per app."""
    from flask import redirect

    if getattr(app, "_engirent_captive", False):
        return
    target = f"http://{ip}/"

    def _to_portal(**_kwargs):
        return redirect(target, code=302)

    for i, path in enumerate(CAPTIVE_PROBE_PATHS):
        app.add_url_rule(path, endpoint=f"captive_probe_{i}", view_func=_to_portal)

    @app.errorhandler(404)
    def _unknown_path_to_portal(_e):
        return redirect(target, code=302)

    app._engirent_captive = True


def teardown_hotspot(ssid: str) -> None:
    """Remove the hotspot profile so NetworkManager falls back to saved client
    networks, and the captive DNS rule with it. Best-effort: every step is
    harmless if it is already gone."""
    # By the hotspot's EXPLICIT connection id. The first version deleted by SSID,
    # but the old code's connection was named "Hotspot", so the 20-minute
    # give-up could not bring it down (D-77).
    stop_hotspot(ssid)
    remove_dns_hijack()


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

    # Captive portal: DNS rule must exist BEFORE the hotspot starts, because
    # NetworkManager's dnsmasq reads its config directory at launch.
    remove_dns_hijack()                       # clear any stale copy first
    dns_path = install_dns_hijack(ip)
    if dns_path:
        atexit.register(remove_dns_hijack)

    try:
        actual_ip = start_hotspot(ssid=ssid, psk=password, ip=ip)
    except HotspotError as e:
        log.error("hotspot failed to start: %s", e)
        remove_dns_hijack()
        return 4
    # If the process dies any way other than a reboot, do not leave the kiosk
    # stranded on its own hotspot.
    atexit.register(teardown_hotspot, ssid)
    # Redirect to the address that is REALLY on wlan0, not the one requested.
    install_captive_routes(portal, actual_ip)

    def _give_up():
        log.warning("no network chosen within %d min — removing hotspot, reconnecting to saved Wi-Fi", timeout_min)
        teardown_hotspot(ssid)
        os._exit(0)

    timer = threading.Timer(timeout_min * 60, _give_up)
    timer.daemon = True
    timer.start()

    log.info("SETUP MODE: join Wi-Fi '%s' — the setup page should open by itself (captive portal %s); "
             "if not, open http://%s  (gives up in %d min)",
             ssid, "on" if dns_path else "OFF", actual_ip, timeout_min)
    run_portal(host="0.0.0.0", port=80)   # blocks; a successful save reboots the Pi
    return 0


if __name__ == "__main__":
    sys.exit(main())
