"""
Per-bay exclusivity — one bay, one process, start to finish (D-96, §12).

The rule this file enforces, stated as the lifecycle map states it:

    Once a bay begins a process, that bay is occupied by that process until it
    finishes. No second process may start on it, and nothing may overwrite it.

**Why a busy map and NOT an `asyncio.Lock`.** A lock makes the second command
*wait*. Waiting is the failure mode we are trying to prevent: bay 1's drop is a
44-second sequence (22s retract + 22s extend on its calibration), so a queued
`open_door` would unlock a door up to three quarters of a minute after the
person asked, most likely onto a bay someone else has since walked up to. A
door that opens 40 seconds late is worse than one that refused. So a claim
either succeeds immediately or is refused immediately, and the refusal is
acknowledged so the server and the person both learn about it.

**Why check-then-set is safe here.** `claim()` contains no `await`. The kiosk
runs one asyncio event loop in one thread, so nothing can run between the
check and the set — this is atomic in the only sense that matters on this
device. It is deliberately not thread-safe, because the command path is not
threaded; `main.py`'s Flask UI thread never touches this.

**Why every claim carries a deadline.** A handler that hangs — a solenoid call
that never returns, an upload that stalls — would otherwise hold its bay until
somebody restarts the Pi. That is a bay bricked by a software fault, which is
exactly failure mode F3's shape (commanded, never acknowledged). The caller is
expected to enforce `claim.timeout_seconds` with `asyncio.wait_for` and release
the claim in a `finally`, so a stuck command fails loudly into a state a human
can reconcile instead of silently.

Timeouts are derived FROM `kiosk_config.json`'s hand-calibrated per-bay
seconds, never from a constant guessed here, and never by modifying them: this
module only ever reads those numbers and adds a margin.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

# Commands that act on ONE bay's hardware. `data["locker_id"]` names it.
BAY_SCOPED_ACTIONS = frozenset({
    "open_door",
    "drop_item",
    "capture_image",
    "actuator_extend",
    "actuator_retract",
})

# Commands that touch EVERY bay, so they need all four at once. A self-test
# pulses all 8 solenoids and all 4 actuators.
ALL_BAY_ACTIONS = frozenset({"self_test"})

# `lock_all` is the emergency stop and is deliberately NOT in either set: it
# drives every relay to its safe state, which is the one thing that must never
# be refused because a bay is busy. It force-clears the map instead — see
# `force_release_all`.
EMERGENCY_ACTIONS = frozenset({"lock_all"})

ALL_BAYS = (1, 2, 3, 4)

# Margin added on top of a command's real calibrated duration before the
# watchdog calls it hung. Generous on purpose: aborting a legitimate stroke
# mid-travel would be far worse than waiting a few extra seconds for a stuck
# one. Only the drop sequence gets the long margin — it is the only command
# with two motor phases and a sleep between them.
_MARGIN_SECONDS = 10.0
_DROP_MARGIN_SECONDS = 20.0

# A capture is camera frames plus an HTTP upload to the server, so its ceiling
# is a network number rather than a hardware one.
_CAPTURE_TIMEOUT_SECONDS = 120.0

# Fallbacks used only when the config has no entry for a bay — never to
# override one that does.
_FALLBACK_DOOR_SECONDS = 15.0
_FALLBACK_ACTUATOR_SECONDS = 25.0


class BayBusyError(Exception):
    """Raised by `claim_or_raise`; `on_command` uses `claim()` instead."""


@dataclass(frozen=True)
class BayClaim:
    """A held claim. Returned by `claim()`, handed back to `release()`."""

    bays: tuple[int, ...]
    action: str
    command_id: str
    timeout_seconds: float
    claimed_at: float = field(default_factory=time.monotonic)

    @property
    def held_for(self) -> float:
        return time.monotonic() - self.claimed_at

    def describe(self) -> str:
        bays = ", ".join(str(b) for b in self.bays)
        return f"{self.action} on bay {bays}"


@dataclass(frozen=True)
class BayRefusal:
    """Why a claim was refused, in terms a person can be told."""

    bay: int
    busy_with: str
    busy_command_id: str
    held_for_seconds: float

    def message(self) -> str:
        """One line, for the kiosk screen and the phone. §13 rule 1."""
        return f"Locker {self.bay} is finishing something — please wait"

    def log_line(self) -> str:
        return (
            f"bay {self.bay} busy with '{self.busy_with}' "
            f"(command_id={self.busy_command_id or 'none'}, "
            f"held {self.held_for_seconds:.1f}s)"
        )


def bays_for(action: str, data: dict) -> tuple[int, ...] | None:
    """Which bays this command needs exclusively.

    `None` means "not bay-scoped" — an emergency stop, or one of the
    screen-only commands (`flow_error`, `verification_done`,
    `await_phone_verification`, `face_failed`), none of which touch a relay.
    Those must never be refused: refusing to update a screen helps nobody.
    """
    if action in ALL_BAY_ACTIONS:
        return ALL_BAYS
    if action in BAY_SCOPED_ACTIONS:
        raw = data.get("locker_id")
        if raw is None:
            return None
        try:
            return (int(raw),)
        except (TypeError, ValueError):
            return None
    return None


def timeout_for(action: str, data: dict, locker_cfg: dict | None) -> float:
    """A command's deadline, derived from that bay's calibrated timings.

    `locker_cfg` is the bay's entry from `kiosk_config.json`. Read only — the
    per-locker timings are hand-calibrated against real hardware and are never
    written by this code path.
    """
    cfg = locker_cfg or {}

    if action == "open_door":
        door = data.get("door", "main_door")
        key = "bottom_door_open_seconds" if door == "bottom_door" else "main_door_open_seconds"
        seconds = data.get("duration_override") or cfg.get(key) or _FALLBACK_DOOR_SECONDS
        return float(seconds) + _MARGIN_SECONDS

    if action == "drop_item":
        extend = data.get("extend_seconds") or cfg.get("actuator_extend_seconds") or _FALLBACK_ACTUATOR_SECONDS
        retract = data.get("retract_seconds") or cfg.get("actuator_retract_seconds") or _FALLBACK_ACTUATOR_SECONDS
        return float(extend) + float(retract) + _DROP_MARGIN_SECONDS

    if action == "actuator_extend":
        seconds = data.get("seconds") or cfg.get("actuator_extend_seconds") or _FALLBACK_ACTUATOR_SECONDS
        return float(seconds) + _MARGIN_SECONDS

    if action == "actuator_retract":
        seconds = data.get("seconds") or cfg.get("actuator_retract_seconds") or _FALLBACK_ACTUATOR_SECONDS
        return float(seconds) + _MARGIN_SECONDS

    if action == "capture_image":
        return _CAPTURE_TIMEOUT_SECONDS

    if action == "self_test":
        # 8 solenoid pulses + 4 extend/retract pairs at 0.3s each, plus a
        # camera open per bay. Bounded generously — a self-test that trips its
        # own watchdog would look like broken hardware.
        return 180.0

    return 60.0


class BayRegistry:
    """Which bay is running what, right now."""

    def __init__(self) -> None:
        self._claims: dict[int, BayClaim] = {}

    # ── the whole point of the file ──────────────────────────────────────────
    def claim(self, bays: tuple[int, ...], action: str, command_id: str,
              timeout_seconds: float) -> tuple[BayClaim | None, BayRefusal | None]:
        """Take every bay in `bays`, or take none of them.

        All-or-nothing matters for `self_test`, which needs all four: taking
        the free ones and refusing on the fourth would leave three bays held
        by a command that never ran.
        """
        for bay in bays:
            held = self._claims.get(bay)
            if held is not None:
                return None, BayRefusal(
                    bay=bay,
                    busy_with=held.action,
                    busy_command_id=held.command_id,
                    held_for_seconds=held.held_for,
                )

        claim = BayClaim(
            bays=tuple(bays),
            action=action,
            command_id=command_id,
            timeout_seconds=timeout_seconds,
        )
        for bay in bays:
            self._claims[bay] = claim
        return claim, None

    def release(self, claim: BayClaim) -> None:
        """Release only the bays this exact claim still holds.

        Identity-checked so a late release from a timed-out handler cannot
        free a bay that a newer command has legitimately taken since.
        """
        for bay in claim.bays:
            if self._claims.get(bay) is claim:
                del self._claims[bay]

    def force_release_all(self) -> list[BayClaim]:
        """Drop every claim. Only `lock_all` does this — the emergency stop
        has just driven every relay to its safe state, so whatever those
        claims were protecting is over. Returns what was cleared, so the
        caller can say so out loud rather than clearing silently."""
        cleared = list(dict.fromkeys(self._claims.values()))
        self._claims.clear()
        return cleared

    # ── read-only views, for logs and status ─────────────────────────────────
    def is_busy(self, bay: int) -> bool:
        return bay in self._claims

    def claim_on(self, bay: int) -> BayClaim | None:
        return self._claims.get(bay)

    def busy_bays(self) -> dict[int, str]:
        return {bay: claim.action for bay, claim in sorted(self._claims.items())}
