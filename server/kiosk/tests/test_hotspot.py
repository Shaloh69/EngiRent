"""
Tests for the setup hotspot (D-77).

Each test pins one of the bugs the user hit on 2026-09-13, when their Android
joined `EngiRent-Kiosk-Setup` and got ERR_ADDRESS_UNREACHABLE for 192.168.4.1:

  * the address change targeted a connection named after the SSID, but nmcli
    had named it "Hotspot" -> stayed on 10.42.0.1
  * `ipv4.method manual` -> no DHCP, no DNS
  * teardown by SSID -> the 20-minute give-up could not remove the hotspot

nmcli is replaced by a recorder, so these run anywhere.
"""

import os
import subprocess
import types

import pytest

from provisioning import hotspot as hs

SSID, PSK, IP = "EngiRent-Kiosk-Setup", "correct-horse-battery", "192.168.4.1"


# ── the connection definition ───────────────────────────────────────────────

def keyfile():
    return hs.hotspot_keyfile(SSID, PSK, IP)


def test_method_is_shared_so_phones_get_dhcp_and_dns():
    lines = keyfile().splitlines()
    assert "method=shared" in lines
    assert "method=manual" not in lines, "manual runs no DHCP — the original bug"


def test_address_is_set_in_the_connection_itself():
    assert f"address1={IP}/24" in keyfile().splitlines()


def test_connection_has_an_explicit_id_not_the_default_hotspot_name():
    lines = keyfile().splitlines()
    assert f"id={hs.HOTSPOT_CON}" in lines
    assert hs.HOTSPOT_CON != hs.LEGACY_CON


def test_it_is_an_access_point_that_never_autoconnects():
    lines = keyfile().splitlines()
    assert "mode=ap" in lines and "autoconnect=false" in lines
    assert f"ssid={SSID}" in lines


def test_wpa2_psk():
    lines = keyfile().splitlines()
    assert "key-mgmt=wpa-psk" in lines and f"psk={PSK}" in lines


@pytest.mark.parametrize("bad", ["short", "x" * 64, "line\nbreak", "back\\slash", " padded ", ""])
def test_unsafe_or_invalid_passwords_are_refused(bad):
    with pytest.raises(hs.HotspotError):
        hs.hotspot_keyfile(SSID, bad, IP)


# ── reading back the real address ───────────────────────────────────────────

@pytest.mark.parametrize("out,expected", [
    ("192.168.4.1/24\n", "192.168.4.1"),
    ("10.42.0.1/24", "10.42.0.1"),
    ("192.168.4.1/24 | 169.254.3.4/16", "192.168.4.1"),
    ("", None),
])
def test_parse_ipv4_address(out, expected):
    assert hs.parse_ipv4_address(out) == expected


# ── nmcli interactions, recorded ────────────────────────────────────────────

class Recorder:
    """Stands in for subprocess.run. `responses` maps a joined argv prefix to
    (returncode, stdout)."""

    def __init__(self, responses=None):
        self.calls = []
        self.responses = responses or {}

    def __call__(self, argv, **_kw):
        self.calls.append(argv)
        joined = " ".join(argv)
        for prefix, (rc, out) in self.responses.items():
            if joined.startswith(prefix):
                return types.SimpleNamespace(returncode=rc, stdout=out, stderr="" if rc == 0 else "boom")
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")


@pytest.fixture
def nm(monkeypatch):
    rec = Recorder({"nmcli -g IP4.ADDRESS device show wlan0": (0, f"{IP}/24")})
    monkeypatch.setattr(hs.subprocess, "run", rec)
    return rec


def test_teardown_targets_the_explicit_id_never_the_ssid(nm, tmp_path):
    """The first setup_mode deleted by SSID, so its give-up could not remove the
    hotspot and the kiosk stayed stranded."""
    hs.stop_hotspot(SSID, directory=str(tmp_path))
    targets = [c[-1] for c in nm.calls if c[:3] in (["nmcli", "con", "down"], ["nmcli", "con", "delete"])]
    assert hs.HOTSPOT_CON in targets
    assert SSID not in targets


def test_start_writes_a_private_keyfile_and_returns_the_real_address(nm, tmp_path):
    actual = hs.start_hotspot(SSID, PSK, IP, directory=str(tmp_path))
    assert actual == IP
    path = hs.keyfile_path(str(tmp_path))
    assert os.path.isfile(path)
    assert "method=shared" in open(path, encoding="utf-8").read()
    if os.name == "posix":
        assert (os.stat(path).st_mode & 0o777) == 0o600
    assert ["nmcli", "con", "up", hs.HOTSPOT_CON] in nm.calls


def test_psk_never_appears_on_nmcli_argv(nm, tmp_path):
    """argv is world-readable on the Pi; the password belongs in the 0600 file."""
    hs.start_hotspot(SSID, PSK, IP, directory=str(tmp_path))
    assert not any(PSK in " ".join(c) for c in nm.calls)


def test_start_reports_the_address_it_actually_got(monkeypatch, tmp_path):
    rec = Recorder({"nmcli -g IP4.ADDRESS device show wlan0": (0, "10.42.0.1/24")})
    monkeypatch.setattr(hs.subprocess, "run", rec)
    assert hs.start_hotspot(SSID, PSK, IP, directory=str(tmp_path)) == "10.42.0.1"


def test_failed_activation_raises_and_cleans_up(monkeypatch, tmp_path):
    rec = Recorder({f"nmcli con up {hs.HOTSPOT_CON}": (4, "")})
    monkeypatch.setattr(hs.subprocess, "run", rec)
    with pytest.raises(hs.HotspotError):
        hs.start_hotspot(SSID, PSK, IP, directory=str(tmp_path))
    assert not os.path.exists(hs.keyfile_path(str(tmp_path)))


def test_no_address_after_activation_raises(monkeypatch, tmp_path):
    rec = Recorder({"nmcli -g IP4.ADDRESS device show wlan0": (0, "")})
    monkeypatch.setattr(hs.subprocess, "run", rec)
    with pytest.raises(hs.HotspotError):
        hs.start_hotspot(SSID, PSK, IP, directory=str(tmp_path))


def test_legacy_hotspot_profile_removed_only_when_it_is_ours(monkeypatch, tmp_path):
    ours = Recorder({f"nmcli -g 802-11-wireless.ssid con show {hs.LEGACY_CON}": (0, SSID)})
    monkeypatch.setattr(hs.subprocess, "run", ours)
    hs.stop_hotspot(SSID, directory=str(tmp_path))
    assert ["nmcli", "con", "delete", hs.LEGACY_CON] in ours.calls

    someone_elses = Recorder({f"nmcli -g 802-11-wireless.ssid con show {hs.LEGACY_CON}": (0, "CoffeeShop")})
    monkeypatch.setattr(hs.subprocess, "run", someone_elses)
    hs.stop_hotspot(SSID, directory=str(tmp_path))
    assert ["nmcli", "con", "delete", hs.LEGACY_CON] not in someone_elses.calls
