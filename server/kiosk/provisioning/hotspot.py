"""
Setup hotspot, done so it actually works (D-77).

Found 2026-09-13 when the user's Android, joined to `EngiRent-Kiosk-Setup`, got
ERR_ADDRESS_UNREACHABLE for http://192.168.4.1. `ap_portal.start_ap_mode()` had
two independent bugs, both silent because every return code was ignored:

  1. `nmcli dev wifi hotspot ... ssid X` names the connection it creates
     **"Hotspot"**, not X. The follow-up `nmcli con modify X ...` and
     `nmcli con up X` therefore targeted a connection that does not exist.
     The hotspot stayed on NetworkManager's default **10.42.0.1** while the log
     said `IP=192.168.4.1`.
  2. Even with the right name, it set `ipv4.method manual`, which runs NO DHCP
     server and NO DNS — phones could not get an address, and the captive-portal
     DNS rule (dnsmasq) would never have been read. It must be `shared`.

A third consequence reached setup_mode's timeout: its teardown also deleted the
connection by SSID, so the 20-minute give-up could not remove a hotspot named
"Hotspot" — the kiosk could stay stranded on its own hotspot until power-cycled.

This module fixes all three:

  * the connection is written as a NetworkManager keyfile with an explicit id,
    `mode=ap`, `method=shared`, a fixed address, and autoconnect off;
  * the PSK lives in that root-only (0600) file — never on nmcli's argv, which
    any local user can read from /proc;
  * every nmcli call's return code is checked, and the address actually on
    wlan0 is read back and returned, so nothing logs an address that is not real;
  * teardown targets the explicit id, and also removes a legacy "Hotspot"
    profile left by the old code — but only if its SSID is ours.

No GPIO. Must run as root.
"""

from __future__ import annotations

import logging
import os
import subprocess

log = logging.getLogger("kiosk.hotspot")

HOTSPOT_CON = "engirent-setup-hotspot"
SYSTEM_CONNECTIONS = "/etc/NetworkManager/system-connections"
LEGACY_CON = "Hotspot"          # what `nmcli dev wifi hotspot` names it by default


class HotspotError(RuntimeError):
    pass


def validate_psk(psk: str) -> None:
    """WPA2 passphrases are 8-63 printable characters. Newlines and backslashes
    are refused because they would corrupt or be reinterpreted by the GLib
    keyfile format; leading/trailing spaces because keyfile values are trimmed."""
    if not (8 <= len(psk) <= 63):
        raise HotspotError("AP password must be 8-63 characters")
    if any(c in psk for c in "\n\r\\"):
        raise HotspotError("AP password may not contain newlines or backslashes")
    if psk != psk.strip():
        raise HotspotError("AP password may not start or end with spaces")


def hotspot_keyfile(ssid: str, psk: str, ip: str, ifname: str = "wlan0") -> str:
    validate_psk(psk)
    return (
        "[connection]\n"
        f"id={HOTSPOT_CON}\n"
        "type=wifi\n"
        f"interface-name={ifname}\n"
        "autoconnect=false\n"
        "\n"
        "[wifi]\n"
        "mode=ap\n"
        f"ssid={ssid}\n"
        "band=bg\n"
        "\n"
        "[wifi-security]\n"
        "key-mgmt=wpa-psk\n"
        "proto=rsn\n"
        "pairwise=ccmp\n"
        "group=ccmp\n"
        f"psk={psk}\n"
        "\n"
        "[ipv4]\n"
        # `shared` = NetworkManager runs DHCP + DNS (dnsmasq) for clients.
        # `manual` was the original bug: no DHCP, no DNS, phones get no address.
        "method=shared\n"
        f"address1={ip}/24\n"
        "\n"
        "[ipv6]\n"
        "method=disabled\n"
    )


def keyfile_path(directory: str = SYSTEM_CONNECTIONS) -> str:
    return os.path.join(directory, f"{HOTSPOT_CON}.nmconnection")


def parse_ipv4_address(nmcli_out: str) -> str | None:
    """`nmcli -g IP4.ADDRESS device show wlan0` prints e.g. `192.168.4.1/24`
    (several addresses are joined with ' | '). Returns the first bare address."""
    for chunk in nmcli_out.replace("|", "\n").splitlines():
        chunk = chunk.strip()
        if chunk:
            return chunk.split("/")[0]
    return None


def _nm(*args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout)


def _remove_legacy_hotspot(ssid: str) -> None:
    r = _nm("-g", "802-11-wireless.ssid", "con", "show", LEGACY_CON)
    if r.returncode == 0 and r.stdout.strip() == ssid:
        log.info("removing legacy '%s' profile left by the old start_ap_mode", LEGACY_CON)
        _nm("con", "down", LEGACY_CON)
        _nm("con", "delete", LEGACY_CON)


def start_hotspot(ssid: str, psk: str, ip: str, ifname: str = "wlan0",
                  directory: str = SYSTEM_CONNECTIONS) -> str:
    """Raise the hotspot and return the IPv4 address really on `ifname`.
    Raises HotspotError on any failure, after cleaning up what it created."""
    content = hotspot_keyfile(ssid, psk, ip, ifname)
    _remove_legacy_hotspot(ssid)
    stop_hotspot(ssid, directory=directory, quiet=True)

    path = keyfile_path(directory)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)

    for step in (("con", "reload"), ("con", "up", HOTSPOT_CON)):
        r = _nm(*step)
        if r.returncode != 0:
            err = (r.stderr or r.stdout).strip()
            stop_hotspot(ssid, directory=directory, quiet=True)
            raise HotspotError(f"nmcli {' '.join(step)} failed: {err}")

    actual = parse_ipv4_address(_nm("-g", "IP4.ADDRESS", "device", "show", ifname).stdout)
    if not actual:
        stop_hotspot(ssid, directory=directory, quiet=True)
        raise HotspotError(f"hotspot came up but {ifname} has no IPv4 address")
    if actual != ip:
        log.warning("hotspot address is %s, not the requested %s", actual, ip)
    log.info("hotspot up: SSID=%s address=%s (read back from %s)", ssid, actual, ifname)
    return actual


def stop_hotspot(ssid: str = "", directory: str = SYSTEM_CONNECTIONS, quiet: bool = False) -> None:
    """Take the hotspot down by its EXPLICIT id and delete its keyfile, so
    NetworkManager falls back to saved client networks. Idempotent."""
    _nm("con", "down", HOTSPOT_CON)
    path = keyfile_path(directory)
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    _nm("con", "reload")
    if ssid:
        _remove_legacy_hotspot(ssid)
    if not quiet:
        log.info("hotspot down")
