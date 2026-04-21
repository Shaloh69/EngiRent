"""
Solenoid relay controller.

Each locker has 3 solenoids:
  main_door   – top insertion door
  trapdoor    – internal drop door (penalty)
  bottom_door – retrieval door at the base

Relay modules are active-LOW by default (energised = GPIO LOW = solenoid open).
Set RELAY_ACTIVE_LOW=False in .env if your board is active-HIGH.
"""

import asyncio
import logging

from config import LOCKER_PINS, MOCK_GPIO, RELAY_ACTIVE_LOW, GPIO_CHIP

log = logging.getLogger("kiosk.gpio")

DOOR_KEYS = ("main_door", "trapdoor", "bottom_door")

if not MOCK_GPIO:
    from gpiozero import OutputDevice
    from gpiozero.pins.lgpio import LGPIOFactory
    import gpiozero

    gpiozero.Device.pin_factory = LGPIOFactory(chip=GPIO_CHIP)
    log.info("Solenoid controller using gpiochip%s", GPIO_CHIP)


class _MockOutput:
    """Stand-in for gpiozero.OutputDevice when MOCK_GPIO=True."""

    def __init__(self, pin: int, active_high: bool = True):
        self._pin = pin
        self._state = False

    def on(self):
        self._state = True
        log.debug("[MOCK] GPIO %s → ON", self._pin)

    def off(self):
        self._state = False
        log.debug("[MOCK] GPIO %s → OFF", self._pin)

    def close(self):
        pass


class SolenoidController:
    """Manages all 12 solenoids across 4 lockers."""

    def __init__(self):
        self._relays: dict[tuple[int, str], object] = {}
        self._init_pins()

    def _init_pins(self):
        for locker_id, pins in LOCKER_PINS.items():
            for door in DOOR_KEYS:
                pin = pins[f"{door}_pin"]
                if MOCK_GPIO:
                    relay = _MockOutput(pin)
                else:
                    # active_high=False → output LOW when .on() is called
                    relay = OutputDevice(
                        pin,
                        active_high=not RELAY_ACTIVE_LOW,
                        initial_value=False,
                    )
                self._relays[(locker_id, door)] = relay
                log.info("Solenoid locker=%s door=%s pin=GPIO%s", locker_id, door, pin)

    def _relay(self, locker_id: int, door: str):
        key = (locker_id, door)
        if key not in self._relays:
            raise ValueError(f"Unknown locker={locker_id} door={door}")
        return self._relays[key]

    def unlock(self, locker_id: int, door: str):
        """Energise relay → solenoid retracts → door unlocked."""
        self._relay(locker_id, door).on()
        log.info("UNLOCK locker=%s door=%s", locker_id, door)

    def lock(self, locker_id: int, door: str):
        """De-energise relay → solenoid extends → door locked."""
        self._relay(locker_id, door).off()
        log.info("LOCK   locker=%s door=%s", locker_id, door)

    async def unlock_for(self, locker_id: int, door: str, seconds: float):
        """Unlock, hold for `seconds`, then re-lock."""
        self.unlock(locker_id, door)
        log.info("Holding unlock locker=%s door=%s for %.1f s…", locker_id, door, seconds)
        await asyncio.sleep(seconds)
        self.lock(locker_id, door)
        log.info("AUTO-LOCKED locker=%s door=%s after %.1f s", locker_id, door, seconds)

    def lock_all(self):
        """Emergency: lock every solenoid immediately."""
        for (lid, door) in self._relays:
            self.lock(lid, door)
        log.warning("ALL solenoids locked")

    def cleanup(self):
        self.lock_all()
        for relay in self._relays.values():
            relay.close()
