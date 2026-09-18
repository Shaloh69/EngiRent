"""
The kiosk returns to "ready" by itself — and Cancel actually cancels.

Found on screen 2026-09-18, second physical test. The Pi's `_ui_state` was
sticky (a status stayed until the next command overwrote it) and the React
screen polls it every 2 seconds, so:

  * Cancel navigated to main locally, told the Pi nothing, and the next poll
    returned "face_scan" and pulled the screen straight back;
  * a finished deposit bounced back onto the success screen forever — the
    "kiosk keeps repeating" reported in the first physical test.

These pin the Pi half of the fix: every change carries a sequence number,
finished flows revert to "online" on their own, a newer state is never
overwritten by a stale revert, and Cancel resets the Pi and closes the session.
Timers are shrunk to milliseconds; nothing here waits real seconds.
"""

import sys
import time
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# `lgpio` exists only on the Raspberry Pi. socket_client imports the GPIO layer
# at module load, so stub it — these tests exercise UI state, never hardware.
sys.modules.setdefault("lgpio", types.ModuleType("lgpio"))

from services import socket_client as sc  # noqa: E402

FAST = 0.05  # seconds — stands in for the real 20s / 30s reverts


@pytest.fixture(autouse=True)
def fast_reverts(monkeypatch):
    monkeypatch.setattr(
        sc,
        "_REVERT_AFTER_SECONDS",
        {"item_verified": FAST, "item_pending": FAST, "error": FAST, "idle": FAST},
    )
    sc._set_ui("online", "Kiosk online – Ready")
    sc._active_rental_id = None
    yield


def _wait_past_revert():
    time.sleep(FAST * 4)


def test_every_change_gets_a_new_sequence_number():
    sc._set_ui("face_scan", "Check your phone")
    a = sc.get_ui_state()["seq"]
    sc._set_ui("face_scan", "Check your phone")
    b = sc.get_ui_state()["seq"]
    # Same status twice is still two changes: a second person starting the
    # same step must not be mistaken for a re-poll of the first.
    assert b == a + 1


@pytest.mark.parametrize("status", ["item_verified", "item_pending", "error", "idle"])
def test_a_finished_or_idle_state_reverts_to_ready(status):
    sc._set_ui(status, "done")
    _wait_past_revert()
    assert sc.get_ui_state()["status"] == "online"


@pytest.mark.parametrize(
    "status",
    ["face_scan", "verified", "door_open", "dropping", "capturing", "verifying_item", "item_retry"],
)
def test_a_state_someone_is_still_acting_on_never_reverts(status):
    # A person mid-step — retrying on their phone, a door open, the actuator
    # moving, a check running — must never be told the kiosk is "ready".
    sc._set_ui(status, "in progress")
    _wait_past_revert()
    assert sc.get_ui_state()["status"] == status


def test_a_stale_revert_never_overwrites_a_newer_state():
    # Deposit door closes -> idle, and the person taps "Item is placed" before
    # the idle revert fires. The revert must not stamp "ready" over the capture.
    sc._set_ui("idle", "Ready")
    sc._set_ui("capturing", "Capturing images")
    _wait_past_revert()
    assert sc.get_ui_state()["status"] == "capturing"


def test_cancel_resets_to_ready_and_forgets_the_rental(monkeypatch):
    # With no server connection (no running loop), Cancel must still reset the
    # kiosk locally and must not raise — the person at the screen gets their
    # ready state back even if the Pi is momentarily offline.
    monkeypatch.setattr(sc, "_main_loop", None)
    sc._active_rental_id = "rental-123"
    sc._set_ui("face_scan", "Check your phone")

    sc.cancel_current_flow()

    assert sc.get_ui_state()["status"] == "online"
    assert sc._active_rental_id is None


def test_cancel_tells_the_server_which_session_to_close(monkeypatch):
    emitted = []

    class FakeLoop:
        pass

    def fake_run(coro, loop):
        coro.close()  # never awaited in a test; close it cleanly
        emitted.append(loop)
        return None

    async def fake_emit(event, payload):
        emitted.append((event, payload))

    monkeypatch.setattr(sc, "_main_loop", FakeLoop())
    monkeypatch.setattr(sc.asyncio, "run_coroutine_threadsafe", fake_run)

    # Record what the emit coroutine would carry by building it ourselves.
    calls = []
    monkeypatch.setattr(sc.sio, "emit", lambda event, payload: calls.append((event, payload)) or fake_emit(event, payload))

    sc._active_rental_id = "rental-abc"
    sc._set_ui("face_scan", "Check your phone")
    sc.cancel_current_flow()

    assert ("kiosk:flow_cancel", {"rental_id": "rental-abc"}) in calls
    assert sc.get_ui_state()["status"] == "online"


def test_awaiting_phone_verification_remembers_the_rental():
    import asyncio

    asyncio.run(
        sc._cmd_await_phone_verification({"rental_id": "rental-xyz", "message": "Check your phone"})
    )
    assert sc._active_rental_id == "rental-xyz"
    assert sc.get_ui_state()["status"] == "face_scan"
