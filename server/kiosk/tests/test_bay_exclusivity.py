"""
D-96 / §12 — one bay, one process, start to finish.

**These tests drive `on_command` itself, deliberately.** This codebase has now
shipped five defects (D-90b, D-94, D-95, D-96, D-97) that were designed,
unit-tested and never connected to a caller — including F2, the server-side
half of this very rule, whose three tests pass today against a pure function
nothing feeds. Testing `BayRegistry` in isolation would repeat exactly that
mistake, so every test below goes in through the real dispatch entry point
with the real handler table, and asserts on the real `kiosk:ack` payloads.

Nothing here waits real seconds: handlers are replaced with short sleeps and
deadlines are shrunk, but the *code path* is the production one.
"""

import asyncio
import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# `lgpio` exists only on the Raspberry Pi. socket_client imports the GPIO layer
# at module load, so stub it — these tests exercise dispatch, never hardware.
sys.modules.setdefault("lgpio", types.ModuleType("lgpio"))

from services import bay_lock  # noqa: E402
from services import socket_client as sc  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_dispatch(monkeypatch):
    """A fresh registry and a recording `safe_emit` for every test."""
    monkeypatch.setattr(sc, "_bays", bay_lock.BayRegistry())

    acks: list[dict] = []

    async def _record(event: str, payload: dict):
        if event == "kiosk:ack":
            acks.append(payload)

    monkeypatch.setattr(sc, "safe_emit", _record)

    # `_cmd_open_door` and friends emit kiosk:status through the live socket.
    async def _noop_emit(*_a, **_kw):
        return None

    monkeypatch.setattr(sc.sio, "emit", _noop_emit)

    sc._set_ui("online", "Kiosk online – Ready")
    return acks


def _cmd(action: str, command_id: str, **extra) -> dict:
    return {"action": action, "command_id": command_id, **extra}


def _acks_for(acks: list[dict], command_id: str) -> list[dict]:
    return [a for a in acks if a["command_id"] == command_id]


# ── The rule itself ───────────────────────────────────────────────────────────


def test_second_command_for_a_busy_bay_is_refused_not_queued(isolated_dispatch, monkeypatch):
    """The test the whole defect exists for.

    A 44-second drop is running on bay 1 and an `open_door` for bay 1 arrives.
    It must be refused *immediately* — not queued behind the stroke, which
    would unlock a door onto a compartment whose floor had just finished
    moving, most likely with a different person standing there.
    """
    acks = isolated_dispatch
    started: list[str] = []

    async def _slow_drop(_data):
        started.append("drop")
        await asyncio.sleep(0.2)

    async def _open(_data):
        started.append("open")

    monkeypatch.setattr(sc, "_cmd_drop_item", _slow_drop)
    monkeypatch.setattr(sc, "_cmd_open_door", _open)

    async def scenario():
        await sc.on_command(_cmd("drop_item", "DROP-1", locker_id=1))
        await asyncio.sleep(0.02)  # let the drop task actually start

        # Same bay, mid-stroke.
        await sc.on_command(_cmd("open_door", "OPEN-1", locker_id=1, door="main_door"))

        refusals = _acks_for(acks, "OPEN-1")
        assert len(refusals) == 1, "a refused command must be acknowledged, exactly once"
        assert refusals[0]["status"] == "refused"
        assert refusals[0]["reason"] == "bay_busy"
        assert refusals[0]["locker_id"] == 1
        assert refusals[0]["busy_with"] == "drop_item"
        assert "please wait" in refusals[0]["message"].lower()

        # The refused handler must never have run.
        assert started == ["drop"], "a refused command must not execute, now or later"

        # And it must not be queued: after the drop finishes, still no open.
        await asyncio.sleep(0.3)
        assert started == ["drop"], "refused means refused — never deferred"
        assert _acks_for(acks, "DROP-1")[0]["status"] == "ok"

    asyncio.run(scenario())


def test_a_different_bay_runs_concurrently(isolated_dispatch, monkeypatch):
    """The rule is per-bay, not a global mutex. Four bays must still work as
    four independent machines, or the bank serialises to a single queue."""
    acks = isolated_dispatch
    ran: list[int] = []

    async def _slow_open(data):
        ran.append(int(data["locker_id"]))
        await asyncio.sleep(0.1)

    monkeypatch.setattr(sc, "_cmd_open_door", _slow_open)

    async def scenario():
        await sc.on_command(_cmd("open_door", "A", locker_id=1, door="main_door"))
        await asyncio.sleep(0.02)
        await sc.on_command(_cmd("open_door", "B", locker_id=2, door="main_door"))
        await asyncio.sleep(0.25)

        assert sorted(ran) == [1, 2]
        assert _acks_for(acks, "A")[0]["status"] == "ok"
        assert _acks_for(acks, "B")[0]["status"] == "ok"

    asyncio.run(scenario())


def test_the_bay_is_free_again_once_the_command_finishes(isolated_dispatch, monkeypatch):
    acks = isolated_dispatch

    async def _quick(_data):
        await asyncio.sleep(0.05)

    monkeypatch.setattr(sc, "_cmd_open_door", _quick)

    async def scenario():
        await sc.on_command(_cmd("open_door", "FIRST", locker_id=3, door="main_door"))
        await asyncio.sleep(0.2)
        assert sc._bays.is_busy(3) is False, "a finished command must release its bay"

        await sc.on_command(_cmd("open_door", "SECOND", locker_id=3, door="main_door"))
        await asyncio.sleep(0.2)
        assert _acks_for(acks, "SECOND")[0]["status"] == "ok"

    asyncio.run(scenario())


# ── Failure has a deadline (§12 item 5 / failure mode F3) ─────────────────────


def test_a_hung_handler_releases_its_bay_loudly(isolated_dispatch, monkeypatch):
    """A lock with no timeout is a bay bricked until someone restarts the Pi."""
    acks = isolated_dispatch

    async def _hangs(_data):
        await asyncio.sleep(30)

    monkeypatch.setattr(sc, "_cmd_open_door", _hangs)
    # Shrink only the deadline; the path through wait_for is the real one.
    monkeypatch.setattr(bay_lock, "timeout_for", lambda *_a, **_kw: 0.05)
    monkeypatch.setattr(sc, "timeout_for", lambda *_a, **_kw: 0.05)

    async def scenario():
        await sc.on_command(_cmd("open_door", "HUNG", locker_id=4, door="main_door"))
        await asyncio.sleep(0.3)

        ack = _acks_for(acks, "HUNG")[0]
        assert ack["status"] == "error"
        assert ack["reason"] == "timeout"
        assert sc._bays.is_busy(4) is False, "a timed-out command must not hold its bay"

        # And the bay genuinely works again afterwards.
        async def _quick(_data):
            return None

        monkeypatch.setattr(sc, "_cmd_open_door", _quick)
        monkeypatch.setattr(sc, "timeout_for", lambda *_a, **_kw: 5)
        await sc.on_command(_cmd("open_door", "AFTER", locker_id=4, door="main_door"))
        await asyncio.sleep(0.1)
        assert _acks_for(acks, "AFTER")[0]["status"] == "ok"

    asyncio.run(scenario())


def test_a_failing_handler_also_releases_its_bay(isolated_dispatch, monkeypatch):
    acks = isolated_dispatch

    async def _boom(_data):
        raise RuntimeError("relay did not respond")

    monkeypatch.setattr(sc, "_cmd_open_door", _boom)

    async def scenario():
        await sc.on_command(_cmd("open_door", "BOOM", locker_id=1, door="main_door"))
        await asyncio.sleep(0.1)
        assert _acks_for(acks, "BOOM")[0]["status"] == "error"
        assert sc._bays.is_busy(1) is False

    asyncio.run(scenario())


# ── What must NEVER be refused ────────────────────────────────────────────────


def test_emergency_lock_all_is_never_refused_and_clears_every_claim(isolated_dispatch, monkeypatch):
    """`lock_all` drives every relay to its safe state. Refusing it because a
    bay is busy would be refusing the one command whose whole purpose is to
    end whatever that bay is doing."""
    acks = isolated_dispatch
    locked: list[str] = []

    async def _slow_drop(_data):
        await asyncio.sleep(0.3)

    async def _lock_all(_data):
        locked.append("locked")

    monkeypatch.setattr(sc, "_cmd_drop_item", _slow_drop)
    monkeypatch.setattr(sc, "_cmd_lock_all", _lock_all)

    async def scenario():
        await sc.on_command(_cmd("drop_item", "D", locker_id=1))
        await asyncio.sleep(0.02)
        assert sc._bays.is_busy(1) is True

        await sc.on_command(_cmd("lock_all", "STOP"))
        await asyncio.sleep(0.05)

        assert locked == ["locked"], "the emergency stop must always run"
        assert _acks_for(acks, "STOP")[0]["status"] == "ok"
        assert sc._bays.busy_bays() == {}, "the emergency stop clears the map"

    asyncio.run(scenario())


def test_screen_only_commands_are_never_refused(isolated_dispatch, monkeypatch):
    """`flow_error` and friends touch no relay. Refusing to update a screen
    because a motor is running helps nobody — and would leave the person
    looking at a stale instruction."""
    acks = isolated_dispatch

    async def _slow_drop(_data):
        await asyncio.sleep(0.2)

    monkeypatch.setattr(sc, "_cmd_drop_item", _slow_drop)

    async def scenario():
        await sc.on_command(_cmd("drop_item", "D", locker_id=1))
        await asyncio.sleep(0.02)

        await sc.on_command(_cmd("flow_error", "MSG", message="Something went wrong"))
        await asyncio.sleep(0.05)
        assert _acks_for(acks, "MSG")[0]["status"] == "ok"

    asyncio.run(scenario())


# ── A self-test needs the whole bank ──────────────────────────────────────────


def test_self_test_is_refused_while_any_bay_is_busy(isolated_dispatch, monkeypatch):
    """It pulses all 8 solenoids and all 4 actuators, so it needs all four
    bays — and must take all of them or none."""
    acks = isolated_dispatch
    ran: list[str] = []

    async def _slow_open(_data):
        await asyncio.sleep(0.2)

    async def _self_test(_data):
        ran.append("self_test")

    monkeypatch.setattr(sc, "_cmd_open_door", _slow_open)
    monkeypatch.setattr(sc, "_cmd_self_test", _self_test)

    async def scenario():
        await sc.on_command(_cmd("open_door", "O", locker_id=2, door="main_door"))
        await asyncio.sleep(0.02)

        await sc.on_command(_cmd("self_test", "ST"))
        assert _acks_for(acks, "ST")[0]["status"] == "refused"
        assert _acks_for(acks, "ST")[0]["locker_id"] == 2
        assert ran == [], "a refused self-test must not pulse anything"

        # All-or-nothing: the free bays must not have been left held.
        assert sc._bays.is_busy(1) is False
        assert sc._bays.is_busy(3) is False
        assert sc._bays.is_busy(4) is False

    asyncio.run(scenario())


def test_a_running_self_test_blocks_every_bay(isolated_dispatch, monkeypatch):
    acks = isolated_dispatch

    async def _slow_self_test(_data):
        await asyncio.sleep(0.2)

    monkeypatch.setattr(sc, "_cmd_self_test", _slow_self_test)

    async def scenario():
        await sc.on_command(_cmd("self_test", "ST"))
        await asyncio.sleep(0.02)

        for bay in (1, 2, 3, 4):
            await sc.on_command(_cmd("open_door", f"O{bay}", locker_id=bay, door="main_door"))
            ack = _acks_for(acks, f"O{bay}")[0]
            assert ack["status"] == "refused", f"bay {bay} must be held by the self-test"
            assert ack["busy_with"] == "self_test"

    asyncio.run(scenario())


# ── Deadlines come from the calibration, not from a guess ─────────────────────


def test_deadlines_track_the_real_per_bay_calibration():
    """Bay 2's door unlocks for 5s where bay 1's unlocks for 15s. A single
    hardcoded deadline would either abort bay 1 or let bay 2 hang for three
    times longer than it should. These read the real, hand-calibrated file.
    """
    cfg = json.loads((Path(__file__).resolve().parents[1] / "kiosk_config.json").read_text())
    bay1 = cfg["lockers"]["1"]
    bay2 = cfg["lockers"]["2"]

    d1 = bay_lock.timeout_for("open_door", {"door": "main_door"}, bay1)
    d2 = bay_lock.timeout_for("open_door", {"door": "main_door"}, bay2)

    assert d1 > d2, "a longer door hold must get a longer deadline"
    assert d1 > bay1["main_door_open_seconds"], "the deadline must clear the real hold"
    assert d2 > bay2["main_door_open_seconds"]

    # A drop must outlast both motor phases together — 22s + 22s on bay 1.
    drop = bay_lock.timeout_for("drop_item", {}, bay1)
    assert drop > bay1["actuator_extend_seconds"] + bay1["actuator_retract_seconds"]


def test_an_explicit_override_is_respected():
    """The server can send a longer door hold; the deadline has to follow it,
    or the override would trip its own watchdog."""
    long_hold = bay_lock.timeout_for(
        "open_door", {"door": "main_door", "duration_override": 90}, {"main_door_open_seconds": 15}
    )
    assert long_hold > 90


def test_a_missing_bay_config_does_not_refuse_the_command(isolated_dispatch, monkeypatch):
    """A gap in the timing file must degrade to a safe default deadline, not
    to a bay nobody can open."""
    acks = isolated_dispatch

    async def _quick(_data):
        return None

    monkeypatch.setattr(sc, "_cmd_open_door", _quick)
    monkeypatch.setattr(sc, "load_timing_config", lambda: {"lockers": {}})

    async def scenario():
        await sc.on_command(_cmd("open_door", "NOCFG", locker_id=1, door="main_door"))
        await asyncio.sleep(0.1)
        assert _acks_for(acks, "NOCFG")[0]["status"] == "ok"

    asyncio.run(scenario())


# ── The refusal must not clobber the screen of the flow that is running ───────


def test_a_refusal_does_not_overwrite_the_live_flow_on_that_bay(isolated_dispatch, monkeypatch):
    """Someone is standing at bay 1 watching "placing item…". A refusal aimed
    at a second request must not replace what they are reading (§13 rule 3 —
    the two screens must never disagree)."""

    async def _slow_drop(data):
        sc._set_ui("dropping", "Locker 1 – placing item…", int(data["locker_id"]))
        await asyncio.sleep(0.2)

    monkeypatch.setattr(sc, "_cmd_drop_item", _slow_drop)

    async def scenario():
        await sc.on_command(_cmd("drop_item", "D", locker_id=1))
        await asyncio.sleep(0.02)
        assert sc._ui_state["status"] == "dropping"

        await sc.on_command(_cmd("open_door", "O", locker_id=1, door="main_door"))
        assert sc._ui_state["status"] == "dropping", "the live step must survive a refusal"
        assert "placing item" in sc._ui_state["message"]

    asyncio.run(scenario())


def test_a_refusal_for_another_bay_does_reach_the_screen(isolated_dispatch, monkeypatch):
    """The converse: if the panel is not already showing that bay's step, the
    person must be told why nothing happened (§12 item 4)."""

    async def _slow_drop(_data):
        await asyncio.sleep(0.2)

    monkeypatch.setattr(sc, "_cmd_drop_item", _slow_drop)

    async def scenario():
        await sc.on_command(_cmd("drop_item", "D", locker_id=1))
        await asyncio.sleep(0.02)
        sc._set_ui("online", "Kiosk online – Ready")  # panel is on idle, not bay 1

        await sc.on_command(_cmd("open_door", "O", locker_id=1, door="main_door"))
        assert sc._ui_state["status"] == "busy"
        assert "Locker 1" in sc._ui_state["message"]

    asyncio.run(scenario())
