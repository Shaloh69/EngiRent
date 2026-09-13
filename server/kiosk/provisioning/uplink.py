"""
Uplink diagnosis — WHY the kiosk cannot reach the server (D-74).

Written 2026-09-13, from a real outage. A brownout left the Pi associated with
its Wi-Fi and holding a DHCP lease while the router had no upstream at all.
The old check, `wifi_manager.is_wifi_connected()`, said "connected" throughout:
it accepts NetworkManager's `limited` state, and on this Pi NetworkManager
reports `full` regardless, because its connectivity check is disabled
(`ConnectivityCheckAvailable: false`, no `[connectivity] uri`). Measured while
`ping 1.1.1.1` was losing 100% of packets.

So "is there Wi-Fi" was never the useful question. There are four distinct
failures behind one symptom — *the kiosk is not talking to the server* — and
they need different responses:

    NO_WIFI             not associated with anything   → provisioning is right
    NO_INTERNET         associated, no route out       → provisioning MIGHT help
    NO_DNS              packets flow, names do not     → provisioning rarely helps
    SERVER_UNREACHABLE  internet fine, server is not   → provisioning is WRONG

**The hard-won rule in here: reaching the server wins over everything.** If the
socket is connected, the kiosk is working, and no amount of failed internet
probes should say otherwise — the server may be on the LAN, or over Tailscale.
`classify()` therefore short-circuits on `server_ok`.

**And the reason auto-AP is OFF by default.** The Pi has one radio. Starting
the setup hotspot drops the Wi-Fi it is on — which, on 2026-09-13, was the only
remaining way to reach the Pi at all (LAN, jumping through the server PC).
An unattended kiosk that hides itself behind its own hotspot because a router
rebooted is worse than one that says, honestly, that it cannot reach the server.

This module is pure logic plus thin, separable probes. `classify()` and
`UplinkPolicy` do no I/O so they can be tested without a network —
`tests/test_uplink.py`.
"""

from __future__ import annotations

import logging
import socket
import subprocess
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlparse

log = logging.getLogger("kiosk.uplink")


# ── States ────────────────────────────────────────────────────────────────────

class Uplink(str, Enum):
    OK = "ok"
    NO_WIFI = "no_wifi"
    NO_INTERNET = "no_internet"
    NO_DNS = "no_dns"
    SERVER_UNREACHABLE = "server_unreachable"


#: Shown on the kiosk and written to the log. Each says what is wrong and who
#: can fix it — a student standing here can act on none of them, so they name
#: the responsible party instead of blaming the network in the abstract.
MESSAGES: dict[Uplink, str] = {
    Uplink.OK: "Connected",
    Uplink.NO_WIFI: "This kiosk has lost its Wi-Fi. Staff setup required.",
    Uplink.NO_INTERNET: "Wi-Fi is connected but has no internet. Staff have been alerted.",
    Uplink.NO_DNS: "Wi-Fi is connected but cannot look up addresses. Staff have been alerted.",
    Uplink.SERVER_UNREACHABLE: "Cannot reach the EngiRent server. The network here is fine.",
}


@dataclass(frozen=True)
class Probe:
    """One round of measurements. Separated from `classify` so the decision is
    testable without a network, and so a caller can supply `server_ok` from the
    live Socket.io client rather than re-probing what it already knows."""

    wifi_associated: bool
    internet_ok: bool          # raw IP reachability, deliberately WITHOUT DNS
    dns_ok: bool
    server_ok: bool


def classify(p: Probe) -> Uplink:
    """Turn one probe into a state. Order matters and is the whole design.

    `server_ok` is checked FIRST because it is the only thing the kiosk
    actually needs; a LAN-hosted or Tailscale-reachable server is fine with no
    public internet. `wifi_associated` is checked before the rest because
    without it the others cannot be interpreted at all.
    """
    if p.server_ok:
        return Uplink.OK
    if not p.wifi_associated:
        return Uplink.NO_WIFI
    if not p.internet_ok:
        return Uplink.NO_INTERNET
    if not p.dns_ok:
        return Uplink.NO_DNS
    return Uplink.SERVER_UNREACHABLE


# ── Policy ────────────────────────────────────────────────────────────────────

class Action(str, Enum):
    NONE = "none"
    ANNOUNCE = "announce"        # state changed — log it and tell the UI
    START_AP = "start_ap"        # enter provisioning


@dataclass(frozen=True)
class PolicyConfig:
    #: How long a fixable fault must persist before provisioning is even
    #: considered. Routers reboot; a kiosk that tears down its network after
    #: thirty seconds of trouble would be its own worst failure mode.
    grace_seconds: int = 900
    #: Off by default, deliberately. See this module's header.
    auto_ap_enabled: bool = False


class UplinkPolicy:
    """Decides what to do about a state, with hysteresis and safety gates.

    Holds only the first time the current non-OK state was seen, so it can be
    driven from a test with a fake clock.
    """

    #: States where a setup hotspot could plausibly be the fix. Notably absent:
    #: SERVER_UNREACHABLE — the network is fine, the server is down, and
    #: provisioning would destroy a working connection to fix nothing.
    AP_CANDIDATE = (Uplink.NO_WIFI, Uplink.NO_INTERNET, Uplink.NO_DNS)

    def __init__(self, config: PolicyConfig | None = None):
        self.config = config or PolicyConfig()
        self._state: Uplink | None = None
        self._since: float | None = None

    @property
    def state(self) -> Uplink | None:
        return self._state

    def seconds_in_state(self, now: float) -> float:
        return 0.0 if self._since is None else max(0.0, now - self._since)

    def update(self, state: Uplink, now: float, safe_to_disrupt=None) -> Action:
        """Feed one classified state; get the action to take.

        `safe_to_disrupt` is a callable returning whether the kiosk may drop
        its network right now — it must be False while a door is open or a
        handover is in flight. **Absent, it is treated as False**: this refuses
        to disrupt rather than guess, which is the only safe default for a
        machine holding somebody's property.
        """
        changed = state != self._state
        if changed:
            self._state = state
            self._since = now

        # Every route to START_AP requires auto-AP to be switched on AND the
        # kiosk to say it is safe to disrupt. NO_WIFI skips only the grace
        # period — there is no working network left to preserve, so waiting
        # would just delay the one fix that can work.
        if self.config.auto_ap_enabled and state in self.AP_CANDIDATE:
            waited = state == Uplink.NO_WIFI or self.seconds_in_state(now) >= self.config.grace_seconds
            if waited and bool(safe_to_disrupt and safe_to_disrupt()):
                return Action.START_AP

        return Action.ANNOUNCE if changed else Action.NONE


# ── Probes (I/O — kept out of the logic above on purpose) ─────────────────────

#: Exactly the two spellings nmcli uses for a WiFi link, captured from the live
#: Pi on 2026-09-13. `wifi-p2p` is deliberately NOT here: `p2p-dev-wlan0` is a
#: peer-to-peer device that exists whether or not the Pi is on any network.
_WIFI_TYPES = ("wifi", "802-11-wireless")


def parse_wifi_associated(nmcli_out: str) -> bool:
    """Pure parser, so the format assumption is testable without a Pi.

    **This is where the original check was broken, and it went unnoticed for
    months.** `wifi_manager.is_wifi_connected()` scanned
    `nmcli -t -f TYPE,STATE con show --active` for the literal type `wifi` —
    but for a *connection* nmcli says **`802-11-wireless`**; only a *device*
    says `wifi`. That branch could never match, so the function's only working
    path was the `connectivity` call that lies on this Pi. Had connectivity
    ever answered `none`, the kiosk would have raised its setup hotspot **while
    perfectly connected to WiFi**. Found 2026-09-13 by running the new probe on
    the real Pi, which reported `wifi_associated=False` for a healthy `wlan0`.

    Accepts either shape:
        DEVICE:TYPE:STATE     `wlan0:wifi:connected`
        TYPE:STATE            `802-11-wireless:activated`
    """
    for line in nmcli_out.splitlines():
        parts = [p.strip().lower() for p in line.split(":")]
        if len(parts) >= 3:
            typ, state = parts[1], parts[2]
        elif len(parts) == 2:
            typ, state = parts[0], parts[1]
        else:
            continue
        if typ in _WIFI_TYPES and (state.startswith("connected") or state == "activated"):
            return True
    return False


def probe_wifi_associated(timeout: int = 5) -> bool:
    """Association only — NOT connectivity. `nmcli connectivity` is not used
    here: it reports `full` on this Pi with a dead uplink (measured)."""
    for args in (
        ["nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device"],
        ["nmcli", "-t", "-f", "TYPE,STATE", "con", "show", "--active"],
    ):
        try:
            r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
            if parse_wifi_associated(r.stdout):
                return True
        except Exception as e:                                # pragma: no cover
            log.error("nmcli association check failed (%s): %s", args[-1], e)
    return False


def probe_tcp(host: str, port: int, timeout: float = 4.0) -> bool:
    """A TCP connect, used for both the internet and the server checks.
    ICMP is avoided on purpose — plenty of networks drop ping but route TCP."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def probe_internet(host: str = "1.1.1.1", port: int = 53, timeout: float = 4.0) -> bool:
    """Reachability by IP, with no name lookup, so this stays orthogonal to DNS."""
    return probe_tcp(host, port, timeout)


def probe_dns(hostname: str = "controlplane.tailscale.com", timeout: float = 4.0) -> bool:
    try:
        socket.setdefaulttimeout(timeout)
        socket.getaddrinfo(hostname, None)
        return True
    except Exception:
        return False


def server_host_port(server_url: str) -> tuple[str, int]:
    u = urlparse(server_url)
    return (u.hostname or "localhost", u.port or (443 if u.scheme == "https" else 80))


def run_probe(server_url: str, server_ok: bool | None = None) -> Probe:
    """One full round. Pass `server_ok=sio.connected` when a live client
    already knows — an open Socket.io connection is better evidence than any
    probe this module could invent, and it costs nothing."""
    host, port = server_host_port(server_url)
    if server_ok is None:
        server_ok = probe_tcp(host, port)
    return Probe(
        wifi_associated=probe_wifi_associated(),
        internet_ok=probe_internet(),
        dns_ok=probe_dns(),
        server_ok=bool(server_ok),
    )


# ── The current diagnosis, shared with the socket client ──────────────────────
#
# ONE writer for what the screen says. The socket client's `connect_error`
# handler already sets `("error", "Cannot reach server")` on every 5-second
# retry, and the kiosk UI renders only the `error` status's message
# (`useKioskState.ts`: `s.status === "error"` -> ErrorScreen). A watchdog that
# wrote its own message once, on change, was overwritten within 5 seconds --
# caught before deploy on 2026-09-13. So the watchdog only RECORDS; the socket
# client asks for the cause when it writes its message.

_current: Uplink | None = None


def record(state: Uplink) -> None:
    global _current
    _current = state


def current_message() -> str | None:
    """The cause to show instead of a generic "Cannot reach server", or None
    when there is nothing more specific to say (unknown yet, or OK)."""
    if _current is None or _current is Uplink.OK:
        return None
    return describe(_current)


def describe(state: Uplink) -> str:
    return MESSAGES.get(state, MESSAGES[Uplink.SERVER_UNREACHABLE])
