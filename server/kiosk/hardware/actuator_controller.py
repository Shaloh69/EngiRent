"""
Relay-based linear actuator controller — uses lgpio directly (no gpiozero).

Each locker has one actuator driven by two relay channels:
  EXTEND  – extend relay ON,  retract relay OFF
  RETRACT – extend relay OFF, retract relay ON
  STOP    – both relays OFF

Pin pairs from config.py:
  actuator_extend_pin  – relay channel A (BCM pin)
  actuator_retract_pin – relay channel B (BCM pin)

Actuator relays are active-LOW (same modules as solenoids).
"""

import asyncio
import logging

from config import LOCKER_PINS, MOCK_GPIO, RELAY_ACTIVE_LOW, GPIO_CHIP

log = logging.getLogger("kiosk.actuator")

_RELAY_ON  = 0 if RELAY_ACTIVE_LOW else 1
_RELAY_OFF = 1 if RELAY_ACTIVE_LOW else 0

if not MOCK_GPIO:
    import lgpio
    log.info("Actuator controller using gpiochip%s", GPIO_CHIP)


class _MockRelay:
    def __init__(self, pin: int, name: str):
        self._pin  = pin
        self._name = name

    def on(self):
        log.debug("[MOCK] %s GPIO%s → ON", self._name, self._pin)

    def off(self):
        log.debug("[MOCK] %s GPIO%s → OFF", self._name, self._pin)

    def close(self):
        pass


class _LgpioRelay:
    def __init__(self, handle: int, pin: int, name: str):
        self._h    = handle
        self._pin  = pin
        self._name = name
        lgpio.gpio_claim_output(self._h, self._pin, _RELAY_OFF)

    def on(self):
        lgpio.gpio_write(self._h, self._pin, _RELAY_ON)

    def off(self):
        lgpio.gpio_write(self._h, self._pin, _RELAY_OFF)

    def close(self):
        try:
            lgpio.gpio_write(self._h, self._pin, _RELAY_OFF)
            lgpio.gpio_free(self._h, self._pin)
        except Exception:
            pass


class ActuatorController:
    """Controls 4 linear actuators (one per locker) via relay polarity reversal."""

    def __init__(self):
        self._handle: int | None = None
        self._extend:  dict[int, _MockRelay | _LgpioRelay] = {}
        self._retract: dict[int, _MockRelay | _LgpioRelay] = {}

        if not MOCK_GPIO:
            self._handle = lgpio.gpiochip_open(GPIO_CHIP)

        self._init_pins()

    def _init_pins(self):
        for locker_id, pins in LOCKER_PINS.items():
            ext_pin = pins["actuator_extend_pin"]
            ret_pin = pins["actuator_retract_pin"]

            if MOCK_GPIO:
                self._extend[locker_id]  = _MockRelay(ext_pin,  "EXTEND")
                self._retract[locker_id] = _MockRelay(ret_pin, "RETRACT")
            else:
                try:
                    self._extend[locker_id]  = _LgpioRelay(self._handle, ext_pin,  "EXTEND")
                    self._retract[locker_id] = _LgpioRelay(self._handle, ret_pin, "RETRACT")
                except Exception as e:
                    log.error("Failed to init actuator locker=%s: %s", locker_id, e)
                    raise

            log.info("Actuator locker=%s extend=GPIO%s retract=GPIO%s ✓", locker_id, ext_pin, ret_pin)

    def _do_extend(self, locker_id: int):
        self._retract[locker_id].off()
        self._extend[locker_id].on()
        log.info("ACTUATOR EXTEND  locker=%s", locker_id)

    def _do_retract(self, locker_id: int):
        self._extend[locker_id].off()
        self._retract[locker_id].on()
        log.info("ACTUATOR RETRACT locker=%s", locker_id)

    def _stop(self, locker_id: int):
        self._extend[locker_id].off()
        self._retract[locker_id].off()
        log.info("ACTUATOR STOP    locker=%s", locker_id)

    async def place_item(self, locker_id: int, extend_seconds: float, retract_seconds: float):
        log.info("PLACE sequence locker=%s extend=%.1fs retract=%.1fs",
                 locker_id, extend_seconds, retract_seconds)
        self._do_extend(locker_id)
        await asyncio.sleep(extend_seconds)
        self._stop(locker_id)
        await asyncio.sleep(0.3)
        self._do_retract(locker_id)
        await asyncio.sleep(retract_seconds)
        self._stop(locker_id)
        log.info("PLACE complete locker=%s", locker_id)

    async def manual_extend(self, locker_id: int, seconds: float):
        self._do_extend(locker_id)
        await asyncio.sleep(seconds)
        self._stop(locker_id)

    async def manual_retract(self, locker_id: int, seconds: float):
        self._do_retract(locker_id)
        await asyncio.sleep(seconds)
        self._stop(locker_id)

    def stop_all(self):
        for locker_id in self._extend:
            self._stop(locker_id)

    def cleanup(self):
        self.stop_all()
        for r in list(self._extend.values()) + list(self._retract.values()):
            r.close()
        self._extend  = {}
        self._retract = {}
        if self._handle is not None:
            try:
                lgpio.gpiochip_close(self._handle)
            except Exception:
                pass
            self._handle = None
