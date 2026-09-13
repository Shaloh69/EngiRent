"""S-10 / D-77 — `ap_portal`'s hotspot entry points.

Two things are under test, and neither is about Flask:

1. **There is no default AP password any more.** A literal in a public repo is
   a published credential: anyone who reads the source could join the setup
   hotspot of a kiosk deployed without its `.env`, and joining it means
   choosing which network that kiosk trusts over a plain-http `SERVER_URL`.
   Both entry points must refuse rather than fall back.

2. **`ap_portal` no longer drives nmcli itself** (D-77). Its own version got
   four things wrong silently — profile addressed by SSID so the static address
   was never applied, `ipv4.method manual` so no DHCP ran, teardown by SSID so
   it could not remove what it made, and the PSK on nmcli's argv where /proc
   exposes it. It delegates to `provisioning.hotspot` instead, so these tests
   assert the delegation rather than re-testing nmcli behaviour that
   `test_hotspot.py` already covers.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from provisioning import ap_portal  # noqa: E402
from provisioning.hotspot import HotspotError  # noqa: E402


@pytest.fixture
def calls(monkeypatch):
    """Record delegation instead of touching NetworkManager."""
    rec = {"start": [], "stop": []}

    def fake_start(ssid, psk, ip, *a, **kw):
        rec["start"].append({"ssid": ssid, "psk": psk, "ip": ip})
        return ip

    def fake_stop(ssid="", **kw):
        rec["stop"].append(ssid)

    monkeypatch.setattr(ap_portal, "start_hotspot", fake_start)
    monkeypatch.setattr(ap_portal, "stop_hotspot", fake_stop)
    return rec


# ── 1. no published default ───────────────────────────────────────────────────

def test_module_ships_no_default_password():
    assert ap_portal.AP_PASSWORD == "", (
        "a default AP password in a public repo is a published credential (S-10)"
    )


@pytest.mark.parametrize("psk", ["", "short", "engiren"])  # 0, 5, 7 chars
def test_refuses_a_missing_or_too_short_password(calls, psk):
    assert ap_portal.start_ap_mode(password=psk) is False
    assert calls["start"] == [], "no hotspot may be raised without a valid PSK"


def test_default_call_refuses_because_the_default_is_empty(calls):
    # The first-boot path in main.py calls this with whatever AP_PASSWORD holds.
    assert ap_portal.start_ap_mode() is False
    assert calls["start"] == []


@pytest.mark.parametrize("psk", ["with\nnewline!", "back\\slash1", " padded123 "])
def test_refuses_a_keyfile_breaking_password(calls, psk):
    assert ap_portal.start_ap_mode(password=psk) is False
    assert calls["start"] == []


# ── 2. delegation, not a second nmcli implementation ──────────────────────────

def test_starts_via_hotspot_module_with_the_requested_settings(calls):
    ok = ap_portal.start_ap_mode(ssid="EngiRent-Kiosk-Setup", password="goodpass123",
                                 ip="192.168.4.1")
    assert ok is True
    assert calls["start"] == [
        {"ssid": "EngiRent-Kiosk-Setup", "psk": "goodpass123", "ip": "192.168.4.1"}
    ]


def test_reports_failure_rather_than_claiming_success(calls, monkeypatch):
    def boom(*a, **kw):
        raise HotspotError("nmcli con up failed: no such connection")

    monkeypatch.setattr(ap_portal, "start_hotspot", boom)
    # D-77's root cause was the opposite of this: a discarded return code, and a
    # log line that stated the intention as a fact.
    assert ap_portal.start_ap_mode(password="goodpass123") is False


def test_stop_delegates_so_teardown_targets_the_explicit_id(calls):
    ap_portal.stop_ap_mode()
    assert calls["stop"] == [ap_portal.AP_SSID]


def test_module_no_longer_runs_nmcli_itself():
    # The PSK reached nmcli's argv only because this module shelled out. If
    # `subprocess` comes back into it, that leak is one edit away again.
    assert not hasattr(ap_portal, "subprocess"), (
        "ap_portal must delegate to provisioning.hotspot, not run nmcli (D-77)"
    )
