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

    def __init__(self, pin_config: dict | None = None):
        self._relays: dict[tuple[int, str], object] = {}
        self._pin_config = pin_config or LOCKER_PINS
        self._init_pins()

    def _init_pins(self):
        for locker_id, pins in self._pin_config.items():
            for door in DOOR_KEYS:
                # Handle both direct pin format (pin: 17) and nested format (main_door_pin: 17)
                pin_key = f"{door}_pin" if f"{door}_pin" in pins else door
                pin = pins[pin_key] if isinstance(pins[pin_key], int) else pins[pin_key]
                
                if MOCK_GPIO:
                    relay = _MockOutput(pin)
                    log.debug("Solenoid locker=%s door=%s pin=GPIO%s [MOCK]", locker_id, door, pin)
                else:
                    try:
                        # active_high=False → output LOW when .on() is called
                        relay = OutputDevice(
                            pin,
                            active_high=not RELAY_ACTIVE_LOW,
                            initial_value=False,
                        )
                        log.info("Solenoid locker=%s door=%s pin=GPIO%s ✓", locker_id, door, pin)
                    except Exception as e:
                        log.error("Failed to init solenoid locker=%s door=%s pin=GPIO%s: %s", locker_id, door, pin, e)
                        raise
                self._relays[(locker_id, door)] = relay

    def reinitialize(self, pin_config: dict):
        """Reinitialize with new pin configuration (for dynamic updates from server)."""
        log.info("Reinitializing solenoid controller with new pin config…")
        try:
            self.lock_all()  # Lock everything first
            self.cleanup()   # Close old relays
            self._pin_config = pin_config
            self._relays = {}
            self._init_pins()
            log.info("Solenoid controller reinitialized successfully ✓")
        except Exception as e:
            log.error("Failed to reinitialize solenoid controller: %s", e)
            raise

    def _relay(self, locker_id: int, door: str):
        key = (locker_id, door)
        if key not in self._relays:
            raise ValueError(f"Unknown locker={locker_id} door={door}")
        return self._relays[key]

    def unlock(self, locker_id: int, door: str):
        """Energise relay → solenoid retracts → door unlocked."""
        try:
            relay = self._relay(locker_id, door)
            relay.on()
            log.info("🔓 UNLOCK locker=%s door=%s | relay energized", locker_id, door)
        except Exception as e:
            log.error("❌ UNLOCK failed locker=%s door=%s: %s", locker_id, door, e)
            raise

    def lock(self, locker_id: int, door: str):
        """De-energise relay → solenoid extends → door locked."""
        try:
            relay = self._relay(locker_id, door)
            relay.off()
            log.info("🔒 LOCK   locker=%s door=%s | relay de-energized", locker_id, door)
        except Exception as e:
            log.error("❌ LOCK failed locker=%s door=%s: %s", locker_id, door, e)
            raise

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
