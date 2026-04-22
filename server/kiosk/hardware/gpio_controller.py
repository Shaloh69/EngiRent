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
        old_pin_config = self._pin_config
        old_relays = self._relays
        new_relays: dict[tuple[int, str], object] = {}

        try:
            # Build the new relay set first, keep existing relays intact until success.
            for locker_id, pins in pin_config.items():
                for door in DOOR_KEYS:
                    pin_key = f"{door}_pin" if f"{door}_pin" in pins else door
                    pin = pins[pin_key] if isinstance(pins[pin_key], int) else pins[pin_key]

                    if MOCK_GPIO:
                        relay = _MockOutput(pin)
                        log.debug("[REINIT] Solenoid locker=%s door=%s pin=GPIO%s [MOCK]", locker_id, door, pin)
                    else:
                        relay = OutputDevice(
                            pin,
                            active_high=not RELAY_ACTIVE_LOW,
                            initial_value=False,
                        )
                        log.info("[REINIT] Solenoid locker=%s door=%s pin=GPIO%s ✓", locker_id, door, pin)
                    new_relays[(locker_id, door)] = relay

            # New pin set validated successfully; swap over and close old relays.
            self._pin_config = pin_config
            self._relays = new_relays
            if old_relays:
                for relay in old_relays.values():
                    try:
                        relay.close()
                    except Exception as e:
                        log.warning("Failed to close old relay during reinit: %s", e)
            log.info("Solenoid controller reinitialized successfully ✓")
        except Exception as e:
            log.error("Failed to reinitialize solenoid controller: %s", e)
            for relay in new_relays.values():
                try:
                    relay.close()
                except Exception:
                    pass
            self._pin_config = old_pin_config
            self._relays = old_relays
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
        if not self._relays:
            log.debug("lock_all called with no relays")
            return
        for (lid, door) in self._relays:
            self.lock(lid, door)
        log.warning("ALL solenoids locked")

    def cleanup(self):
        if not self._relays:
            log.debug("cleanup called with no relays")
            return
        self.lock_all()
        for relay in self._relays.values():
            try:
                relay.close()
            except Exception as e:
                log.warning("Failed to close relay during cleanup: %s", e)
        self._relays = {}
