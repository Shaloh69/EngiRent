"""
place_item() had retract/extend backwards: it extended first and ended on
retract. Found 2026-09-22 on a real long-lead-pickup rental — the trap door
opened (retract) to drop the item and nothing ever closed it again, so it
stayed open on an unattended kiosk. RETRACT opens the trap door; EXTEND
closes it. Correct sequence is retract (open, item drops) then extend
(close).

These pin the call ORDER in actuator_controller.py, not the physical GPIO
(which needs real hardware) or the timing values in kiosk_config.json (never
touched — CLAUDE.md forbids changing those, and this fix doesn't).
"""

import asyncio
import os
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# `lgpio` exists only on the Raspberry Pi; MOCK_GPIO keeps ActuatorController
# off it entirely, but config.py still imports it at module scope elsewhere.
sys.modules.setdefault("lgpio", types.ModuleType("lgpio"))
os.environ["MOCK_GPIO"] = "true"

from hardware.actuator_controller import ActuatorController  # noqa: E402


def test_place_item_retracts_before_extending(monkeypatch):
    controller = ActuatorController()
    calls: list[str] = []
    monkeypatch.setattr(controller, "_do_retract", lambda locker_id: calls.append("retract"))
    monkeypatch.setattr(controller, "_do_extend", lambda locker_id: calls.append("extend"))
    monkeypatch.setattr(controller, "_stop", lambda locker_id: calls.append("stop"))

    asyncio.run(controller.place_item(locker_id=1, extend_seconds=0.01, retract_seconds=0.01))

    # Open (retract) first, close (extend) last — the trap door must not be
    # left open at the end of the sequence.
    assert calls == ["retract", "stop", "extend", "stop"]


def test_place_item_ends_with_extend_relay_on_last(monkeypatch):
    # A more direct check: whichever motion runs last is the one whose
    # relay was live immediately before the final stop() — that must be
    # EXTEND (closed), not RETRACT (open).
    controller = ActuatorController()
    order: list[str] = []
    real_extend = controller._do_extend
    real_retract = controller._do_retract

    def spy_extend(locker_id):
        order.append("extend")
        real_extend(locker_id)

    def spy_retract(locker_id):
        order.append("retract")
        real_retract(locker_id)

    monkeypatch.setattr(controller, "_do_extend", spy_extend)
    monkeypatch.setattr(controller, "_do_retract", spy_retract)

    asyncio.run(controller.place_item(locker_id=1, extend_seconds=0.01, retract_seconds=0.01))

    assert order[-1] == "extend", "the trap door must end closed (extend), not open (retract)"
