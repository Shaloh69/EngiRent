"""
L298N linear actuator controller.

Each locker has one trapdoor actuator:
  EXTEND  (push/open)  → IN_PWM=duty, IN_DIR=LOW
  RETRACT (pull/close) → IN_PWM=duty, IN_DIR=HIGH

Pin pairs from config:
  actuator_pwm_pin  – speed (PWM)
  actuator_dir_pin  – direction (digital)
"""

import asyncio
import logging

from config import LOCKER_PINS, MOCK_GPIO, GPIO_CHIP

log = logging.getLogger("kiosk.actuator")

PWM_FREQUENCY = 1000  # Hz

if not MOCK_GPIO:
    from gpiozero import PWMOutputDevice, OutputDevice
    from gpiozero.pins.lgpio import LGPIOFactory
    import gpiozero

    gpiozero.Device.pin_factory = LGPIOFactory(chip=GPIO_CHIP)
    log.info("Actuator controller using gpiochip%s", GPIO_CHIP)


class _MockPWM:
    def __init__(self, pin):
        self._pin = pin
        self.value = 0.0

    def on(self):
        self.value = 1.0
        log.debug("[MOCK] PWM %s → ON (100%%)", self._pin)

    def off(self):
        self.value = 0.0
        log.debug("[MOCK] PWM %s → OFF", self._pin)

    def close(self):
        pass


class _MockDigital:
    def __init__(self, pin):
        self._pin = pin

    def on(self):
        log.debug("[MOCK] DIR %s → HIGH", self._pin)

    def off(self):
        log.debug("[MOCK] DIR %s → LOW", self._pin)

    def close(self):
        pass


class ActuatorController:
    """Controls 4 trapdoor linear actuators (one per locker)."""

    def __init__(self):
        self._pwm: dict[int, object] = {}
        self._dir: dict[int, object] = {}
        self._init_pins()

    def _init_pins(self):
        for locker_id, pins in LOCKER_PINS.items():
            pwm_pin = pins["actuator_pwm_pin"]
            dir_pin = pins["actuator_dir_pin"]
            if MOCK_GPIO:
                self._pwm[locker_id] = _MockPWM(pwm_pin)
                self._dir[locker_id] = _MockDigital(dir_pin)
            else:
                self._pwm[locker_id] = PWMOutputDevice(
                    pwm_pin, frequency=PWM_FREQUENCY, initial_value=0
                )
                self._dir[locker_id] = OutputDevice(dir_pin, initial_value=False)
            log.info(
                "Actuator locker=%s pwm=GPIO%s dir=GPIO%s",
                locker_id,
                pwm_pin,
                dir_pin,
            )

    def _set_speed(self, locker_id: int, speed_pct: int):
        duty = max(0, min(100, speed_pct)) / 100.0
        if MOCK_GPIO:
            self._pwm[locker_id].value = duty
        else:
            self._pwm[locker_id].value = duty

    def _extend(self, locker_id: int, speed_pct: int):
        """Push trapdoor open."""
        self._dir[locker_id].off()    # DIR LOW = extend
        self._set_speed(locker_id, speed_pct)
        log.info("ACTUATOR EXTEND locker=%s speed=%s%%", locker_id, speed_pct)

    def _retract(self, locker_id: int, speed_pct: int):
        """Pull trapdoor closed."""
        self._dir[locker_id].on()     # DIR HIGH = retract
        self._set_speed(locker_id, speed_pct)
        log.info("ACTUATOR RETRACT locker=%s speed=%s%%", locker_id, speed_pct)

    def _stop(self, locker_id: int):
        self._pwm[locker_id].off()
        log.info("ACTUATOR STOP locker=%s", locker_id)

    async def open_trapdoor(
        self, locker_id: int, push_seconds: float, pull_seconds: float, speed_pct: int = 100
    ):
        """
        Full open-then-close cycle:
          1. Extend for push_seconds  → trapdoor opens, item drops
          2. Retract for pull_seconds → trapdoor closes
        """
        log.info(
            "DROP sequence locker=%s push=%.1fs pull=%.1fs",
            locker_id,
            push_seconds,
            pull_seconds,
        )
        self._extend(locker_id, speed_pct)
        await asyncio.sleep(push_seconds)
        self._stop(locker_id)

        await asyncio.sleep(0.3)  # brief pause between directions

        self._retract(locker_id, speed_pct)
        await asyncio.sleep(pull_seconds)
        self._stop(locker_id)
        log.info("DROP complete locker=%s", locker_id)

    async def manual_extend(self, locker_id: int, seconds: float, speed_pct: int = 100):
        """Manual admin override – extend only."""
        self._extend(locker_id, speed_pct)
        await asyncio.sleep(seconds)
        self._stop(locker_id)

    async def manual_retract(self, locker_id: int, seconds: float, speed_pct: int = 100):
        """Manual admin override – retract only."""
        self._retract(locker_id, speed_pct)
        await asyncio.sleep(seconds)
        self._stop(locker_id)

    def stop_all(self):
        for locker_id in self._pwm:
            self._stop(locker_id)

    def cleanup(self):
        self.stop_all()
        for pwm in self._pwm.values():
            pwm.close()
        for d in self._dir.values():
            d.close()
