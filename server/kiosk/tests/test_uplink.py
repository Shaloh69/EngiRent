"""
Tests for uplink diagnosis (D-74).

These are written against the real outage of 2026-09-13, not against the happy
path: the Pi was associated with Wi-Fi, held a DHCP lease, and had no route out.
Every assertion below would have been false under the old
`is_wifi_connected()`, which called that state "connected".

Pure logic only — no network, no nmcli, no sleeping. Run from `server/kiosk`:

    python -m pytest tests/test_uplink.py -q
"""

import pytest

from provisioning.uplink import (
    Action,
    parse_wifi_associated,
    PolicyConfig,
    Probe,
    Uplink,
    UplinkPolicy,
    classify,
    describe,
    server_host_port,
)


def probe(wifi=True, internet=True, dns=True, server=True) -> Probe:
    return Probe(wifi_associated=wifi, internet_ok=internet, dns_ok=dns, server_ok=server)


# ── classify ─────────────────────────────────────────────────────────────────

def test_the_2026_09_13_outage_is_no_internet_not_connected():
    """THE regression this module exists for: associated, no route out."""
    assert classify(probe(wifi=True, internet=False, dns=False, server=False)) == Uplink.NO_INTERNET


def test_reaching_the_server_wins_over_every_other_signal():
    """A LAN or Tailscale server with no public internet is a WORKING kiosk.
    If this ever regresses, the kiosk will declare itself broken while serving
    students perfectly well."""
    assert classify(probe(wifi=True, internet=False, dns=False, server=True)) == Uplink.OK
    assert classify(probe(wifi=False, internet=False, dns=False, server=True)) == Uplink.OK


def test_no_wifi_is_distinct_from_no_internet():
    assert classify(probe(wifi=False, internet=False, dns=False, server=False)) == Uplink.NO_WIFI


def test_dns_only_failure():
    assert classify(probe(wifi=True, internet=True, dns=False, server=False)) == Uplink.NO_DNS


def test_server_down_but_network_fine():
    assert classify(probe(wifi=True, internet=True, dns=True, server=False)) == Uplink.SERVER_UNREACHABLE


def test_all_good():
    assert classify(probe()) == Uplink.OK


# ── policy: announcements ────────────────────────────────────────────────────

def test_announces_once_per_change_not_every_tick():
    p = UplinkPolicy()
    assert p.update(Uplink.NO_INTERNET, now=0) == Action.ANNOUNCE
    assert p.update(Uplink.NO_INTERNET, now=30) == Action.NONE
    assert p.update(Uplink.NO_INTERNET, now=60) == Action.NONE
    assert p.update(Uplink.OK, now=90) == Action.ANNOUNCE


def test_recovery_resets_the_clock():
    p = UplinkPolicy(PolicyConfig(grace_seconds=100, auto_ap_enabled=True))
    p.update(Uplink.NO_INTERNET, now=0)
    p.update(Uplink.OK, now=50)
    p.update(Uplink.NO_INTERNET, now=60)
    # 10s into the NEW fault, not 60s into the old one.
    assert p.seconds_in_state(now=70) == 10
    assert p.update(Uplink.NO_INTERNET, now=70, safe_to_disrupt=lambda: True) == Action.NONE


# ── policy: the safety gates, which are the point ────────────────────────────

def test_auto_ap_is_off_by_default_so_a_router_reboot_cannot_hide_the_kiosk():
    p = UplinkPolicy()
    for t in (0, 10_000, 100_000):
        assert p.update(Uplink.NO_INTERNET, now=t, safe_to_disrupt=lambda: True) != Action.START_AP


def test_never_starts_ap_when_the_server_is_merely_down():
    """The network is fine here. Dropping it would fix nothing and would cut
    the remote access needed to fix the server."""
    p = UplinkPolicy(PolicyConfig(grace_seconds=0, auto_ap_enabled=True))
    assert p.update(Uplink.SERVER_UNREACHABLE, now=0, safe_to_disrupt=lambda: True) == Action.ANNOUNCE
    assert p.update(Uplink.SERVER_UNREACHABLE, now=10_000, safe_to_disrupt=lambda: True) == Action.NONE


def test_missing_safety_callback_refuses_to_disrupt():
    """No callback means unknown, and unknown must never mean yes — the bay may
    be open with a student's property in it."""
    p = UplinkPolicy(PolicyConfig(grace_seconds=0, auto_ap_enabled=True))
    assert p.update(Uplink.NO_WIFI, now=0) != Action.START_AP


def test_unsafe_blocks_ap_even_after_the_grace_period():
    p = UplinkPolicy(PolicyConfig(grace_seconds=60, auto_ap_enabled=True))
    p.update(Uplink.NO_INTERNET, now=0)
    assert p.update(Uplink.NO_INTERNET, now=10_000, safe_to_disrupt=lambda: False) == Action.NONE


def test_grace_period_must_elapse_for_a_degraded_link():
    p = UplinkPolicy(PolicyConfig(grace_seconds=900, auto_ap_enabled=True))
    p.update(Uplink.NO_INTERNET, now=0)
    assert p.update(Uplink.NO_INTERNET, now=899, safe_to_disrupt=lambda: True) == Action.NONE
    assert p.update(Uplink.NO_INTERNET, now=900, safe_to_disrupt=lambda: True) == Action.START_AP


def test_no_wifi_skips_the_grace_period_but_not_the_safety_gate():
    p = UplinkPolicy(PolicyConfig(grace_seconds=900, auto_ap_enabled=True))
    assert p.update(Uplink.NO_WIFI, now=0, safe_to_disrupt=lambda: True) == Action.START_AP


# ── messages and helpers ─────────────────────────────────────────────────────

@pytest.mark.parametrize("state", list(Uplink))
def test_every_state_has_a_message(state):
    assert describe(state).strip()


def test_no_internet_message_does_not_blame_the_student():
    msg = describe(Uplink.NO_INTERNET).lower()
    assert "wi-fi" in msg and "staff" in msg


@pytest.mark.parametrize(
    "url,expected",
    [
        ("http://desktop-gklhcri:5000", ("desktop-gklhcri", 5000)),
        ("http://192.168.1.18:5000", ("192.168.1.18", 5000)),
        ("https://example.trycloudflare.com", ("example.trycloudflare.com", 443)),
        ("http://localhost", ("localhost", 80)),
    ],
)
def test_server_host_port(url, expected):
    assert server_host_port(url) == expected


# ── nmcli parsing: the bug that hid for months ───────────────────────────

#: Captured verbatim from engirent-kiosk on 2026-09-13, WiFi healthy.
NMCLI_DEVICE_CONNECTED = """wlan0:wifi:connected
lo:loopback:connected (externally)
p2p-dev-wlan0:wifi-p2p:disconnected
eth0:ethernet:unavailable
tailscale0:tun:unmanaged"""

NMCLI_CON_ACTIVE = """802-11-wireless:activated
loopback:activated"""

NMCLI_DEVICE_NO_WIFI = """wlan0:wifi:disconnected
lo:loopback:connected (externally)
p2p-dev-wlan0:wifi-p2p:disconnected
eth0:ethernet:unavailable"""


def test_device_output_is_recognised():
    assert parse_wifi_associated(NMCLI_DEVICE_CONNECTED) is True


def test_connection_output_says_802_11_wireless_not_wifi():
    """The original check looked for the literal `wifi` in CONNECTION output.
    nmcli says `802-11-wireless` there, so it never matched."""
    assert parse_wifi_associated(NMCLI_CON_ACTIVE) is True


def test_disconnected_wifi_is_not_associated():
    assert parse_wifi_associated(NMCLI_DEVICE_NO_WIFI) is False


def test_p2p_device_alone_does_not_count_as_associated():
    """`p2p-dev-wlan0` exists whether or not the Pi is on a network. If it ever
    counts, the kiosk will believe it has WiFi while having none."""
    assert parse_wifi_associated("p2p-dev-wlan0:wifi-p2p:connected") is False


def test_p2p_connected_line_does_not_mask_a_real_wifi_line():
    assert parse_wifi_associated("p2p-dev-wlan0:wifi-p2p:connected\nwlan0:wifi:connected") is True


# ── the shared diagnosis: one writer for the screen ─────────────────────────

import provisioning.uplink as uplink_mod
from provisioning.watchdog import UplinkWatchdog


@pytest.fixture(autouse=False)
def fresh_diagnosis():
    uplink_mod.record(None)
    yield
    uplink_mod.record(None)


def test_no_message_before_the_first_measurement(fresh_diagnosis):
    """The socket client must fall back to its own text, not print 'None'."""
    assert uplink_mod.current_message() is None


def test_ok_has_no_override_message(fresh_diagnosis):
    uplink_mod.record(Uplink.OK)
    assert uplink_mod.current_message() is None


def test_no_internet_supplies_the_specific_message(fresh_diagnosis):
    uplink_mod.record(Uplink.NO_INTERNET)
    assert uplink_mod.current_message() == describe(Uplink.NO_INTERNET)


def test_watchdog_records_every_tick_not_only_on_change(fresh_diagnosis, monkeypatch):
    """The screen is rewritten by the socket client on every 5s retry. If the
    watchdog only recorded on change, a later retry would still read the right
    value -- but if it ever stopped recording, recovery would never clear the
    old message. So it records unconditionally; this pins that."""
    probes = iter([
        probe(wifi=True, internet=False, dns=False, server=False),
        probe(wifi=True, internet=False, dns=False, server=False),
        probe(),
    ])
    monkeypatch.setattr("provisioning.watchdog.run_probe", lambda url, server_ok=None: next(probes))
    wd = UplinkWatchdog("http://desktop-gklhcri:5000")

    assert wd.tick(now=0) == Uplink.NO_INTERNET
    assert uplink_mod.current_message() == describe(Uplink.NO_INTERNET)
    assert wd.tick(now=60) == Uplink.NO_INTERNET          # no change, still recorded
    assert uplink_mod.current_message() == describe(Uplink.NO_INTERNET)
    assert wd.tick(now=120) == Uplink.OK                  # recovery clears it
    assert uplink_mod.current_message() is None


def test_watchdog_never_starts_ap_by_default_even_when_told_it_is_safe(fresh_diagnosis, monkeypatch):
    monkeypatch.setattr("provisioning.watchdog.run_probe",
                        lambda url, server_ok=None: probe(wifi=False, internet=False, dns=False, server=False))
    started = []
    wd = UplinkWatchdog("http://x:1", safe_to_disrupt=lambda: True, start_ap=lambda: started.append(1))
    for t in range(0, 100_000, 5_000):
        wd.tick(now=t)
    assert started == []


def test_empty_and_garbage_are_false_not_crashes():
    for junk in ("", "\n\n", "nonsense", "a:b", ":::"):
        assert parse_wifi_associated(junk) is False
