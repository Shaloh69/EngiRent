"""
Tests for Wi-Fi setup mode's captive portal (D-76 follow-up, 2026-09-13).

What these prove: a phone's captive-portal probe gets redirected to the setup
page, the portal's own page and form are untouched, and the wildcard DNS rule
is written and removed where NetworkManager's hotspot dnsmasq reads it.

What they cannot prove: that a real phone opens the page. That depends on the
phone's OS and needs a phone on the live hotspot — iOS opens its captive sheet
automatically, most Android builds show a tap-to-sign-in notification.

    python -m pytest tests/test_setup_mode.py -q
"""

import os

import pytest
from flask import Flask

from provisioning import setup_mode as sm

IP = "192.168.4.1"
PORTAL = f"http://{IP}/"


def fresh_app():
    """Stands in for ap_portal's app: its own `/` page and `/connect` form."""
    app = Flask("fake_portal")

    @app.route("/")
    def index():
        return "SETUP PAGE", 200

    @app.route("/connect", methods=["POST"])
    def connect():
        return "SAVED", 200

    sm.install_captive_routes(app, IP)
    return app.test_client()


# ── HTTP: probes land on the setup page ─────────────────────────────────────

@pytest.mark.parametrize("path", sm.CAPTIVE_PROBE_PATHS)
def test_every_platform_probe_redirects_to_the_setup_page(path):
    r = fresh_app().get(path)
    assert r.status_code == 302
    assert r.headers["Location"] == PORTAL


def test_android_probe_is_not_answered_with_204():
    """A 204 is exactly what tells Android 'internet works, no sign-in needed'.
    If this ever returns 204 the phone will never surface the page."""
    assert fresh_app().get("/generate_204").status_code != 204


def test_apple_probe_on_apples_hostname_redirects():
    """DNS sends captive.apple.com here; the Host header stays Apple's."""
    r = fresh_app().get("/hotspot-detect.html", headers={"Host": "captive.apple.com"})
    assert r.status_code == 302 and r.headers["Location"] == PORTAL
    assert b"Success" not in r.data


def test_any_unknown_path_on_any_host_redirects():
    r = fresh_app().get("/some/random/page", headers={"Host": "example.com"})
    assert r.status_code == 302 and r.headers["Location"] == PORTAL


def test_the_setup_page_itself_is_not_redirected():
    """A redirect loop here would make the portal unusable."""
    r = fresh_app().get("/")
    assert r.status_code == 200 and r.data == b"SETUP PAGE"


def test_the_form_still_posts():
    r = fresh_app().post("/connect", data={"ssid": "x", "password": "y"})
    assert r.status_code == 200 and r.data == b"SAVED"


def test_installing_routes_twice_is_harmless():
    app = Flask("twice")
    sm.install_captive_routes(app, IP)
    sm.install_captive_routes(app, IP)       # would raise on a duplicate endpoint
    assert app.test_client().get("/generate_204").status_code == 302


def test_real_portal_app_gets_the_probe_routes():
    """The actual app from ap_portal, not a stand-in."""
    from provisioning.ap_portal import portal
    sm.install_captive_routes(portal, IP)
    r = portal.test_client().get("/generate_204")
    assert r.status_code == 302 and r.headers["Location"] == PORTAL


# ── DNS: the wildcard rule dnsmasq needs ────────────────────────────────────

def test_dns_rule_resolves_every_name_to_the_kiosk():
    assert f"address=/#/{IP}" in sm.captive_dns_conf(IP).splitlines()


def test_dns_rule_is_written_and_removed(tmp_path):
    path = sm.install_dns_hijack(IP, directory=str(tmp_path))
    assert path and os.path.isfile(path)
    assert f"address=/#/{IP}" in open(path, encoding="utf-8").read()
    assert sm.remove_dns_hijack(directory=str(tmp_path)) is True
    assert not os.path.exists(path)
    assert sm.remove_dns_hijack(directory=str(tmp_path)) is False   # idempotent


def test_missing_dnsmasq_dir_degrades_instead_of_crashing(tmp_path):
    """Setup mode must still start; the phone just won't auto-open."""
    assert sm.install_dns_hijack(IP, directory=str(tmp_path / "nope")) is None
