"""
Relay-based linear actuator controller.

Each locker has one actuator driven by two relay channels:
  EXTEND  – extend relay ON,  retract relay OFF  (item platform rises)
  RETRACT – extend relay OFF, retract relay ON   (item platform lowers)
  STOP    – both relays OFF

Pin pairs from config:
  actuator_extend_pin  – relay channel 1 (BCM pin)
  actuator_retract_pin – relay channel 2 (BCM pin)
"""

import asyncio
import logging

from config import LOCKER_PINS, MOCK_GPIO, GPIO_CHIP

log = logging.getLogger("kiosk.actuator")

if not MOCK_GPIO:
    from gpiozero import OutputDevice
    from gpiozero.pins.lgpio import LGPIOFactory
    import gpiozero

    gpiozero.Device.pin_factory = LGPIOFactory(chip=GPIO_CHIP)
    log.info("Actuator controller using gpiochip%s", GPIO_CHIP)


class _MockRelay:
    def __init__(self, pin: int, name: str):
        self._pin = pin
        self._name = name

    def on(self):
        log.debug("[MOCK] %s GPIO%s → ON", self._name, self._pin)

    def off(self):
        log.debug("[MOCK] %s GPIO%s → OFF", self._name, self._pin)

    def close(self):
        pass


class ActuatorController:
    """Controls 4 linear actuators (one per locker) via relay polarity reversal."""

    def __init__(self):
        self._extend:  dict[int, object] = {}
        self._retract: dict[int, object] = {}
        self._init_pins()

    def _init_pins(self):
        for locker_id, pins in LOCKER_PINS.items():
            ext_pin = pins["actuator_extend_pin"]
            ret_pin = pins["actuator_retract_pin"]
            if MOCK_GPIO:
                self._extend[locker_id]  = _MockRelay(ext_pin,  "EXTEND")
                self._retract[locker_id] = _MockRelay(ret_pin, "RETRACT")
            else:
                self._extend[locker_id]  = OutputDevice(ext_pin,  initial_value=False)
                self._retract[locker_id] = OutputDevice(ret_pin, initial_value=False)
            log.info(
                "Actuator locker=%s extend=GPIO%s retract=GPIO%s",
                locker_id, ext_pin, ret_pin,
            )

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

    async def place_item(
        self, locker_id: int, extend_seconds: float, retract_seconds: float
    ):
        """
        Extend platform (item in) → pause → retract back.
        """
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

    async def manual_extend(self, locker_id: int, seconds: float, _speed: int = 100):
        self._do_extend(locker_id)
        await asyncio.sleep(seconds)
        self._stop(locker_id)

    async def manual_retract(self, locker_id: int, seconds: float, _speed: int = 100):
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
