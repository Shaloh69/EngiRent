import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "kiosk_config.json"

# ── GPIO chip auto-detection (Pi 5 kernel 6.6.45+ moved RP1 to gpiochip0) ─────
# gpiozero 2.0.1 hardcodes chip=4 for Pi 5 which breaks after the kernel rename.
# We detect the correct chip at startup so both old and new kernels work.
def _detect_gpio_chip() -> int:
    try:
        import lgpio
        for chip in (4, 0):
            try:
                h = lgpio.gpiochip_open(chip)
                lgpio.gpiochip_close(h)
                return chip
            except Exception:
                continue
    except ImportError:
        pass
    return 0

GPIO_CHIP = _detect_gpio_chip()

# ── Server connection ──────────────────────────────────────────────────────────
KIOSK_ID = os.getenv("KIOSK_ID", "kiosk-1")
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:5000")
ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://localhost:8001")

# ── Supabase ───────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "media")

# ── Local UI ───────────────────────────────────────────────────────────────────
UI_PORT = int(os.getenv("UI_PORT", "8080"))

# ── WiFi AP provisioning ───────────────────────────────────────────────────────
AP_SSID = os.getenv("AP_SSID", "EngiRent-Kiosk-Setup")
AP_PASSWORD = os.getenv("AP_PASSWORD", "engirent2026")
AP_IP = os.getenv("AP_IP", "192.168.4.1")

# ── GPIO behaviour ─────────────────────────────────────────────────────────────
RELAY_ACTIVE_LOW = os.getenv("RELAY_ACTIVE_LEVEL", "active_low") == "active_low"
MOCK_GPIO = os.getenv("MOCK_GPIO", "False").lower() == "true"
MOCK_CAMERA = os.getenv("MOCK_CAMERA", "False").lower() == "true"

# ── GPIO pin map ───────────────────────────────────────────────────────────────
# Relay setup: 2 doors per locker (main_door + bottom_door), no trapdoor.
# Module 1 (4-ch, SRD-05VDC-SL-C): Main doors  → GPIO 2,3,4,5
# Module 2 (4-ch, SRD-05VDC-SL-C): Bottom doors → GPIO 6,7,8,9
# Module 3 (4-ch, SRD-05VDC-SL-C): Actuators L1/L2 extend/retract → GPIO 10,11,12,13
# Module 4 (1-ch, SRD-12VDC-SL-C × 4): Actuators L3/L4 extend/retract → GPIO 14,15,16,17
LOCKER_PINS = {
    1: {
        "main_door_pin":       2,   # BCM 2 / Four-channel relay → Main door solenoid
        "bottom_door_pin":     6,   # BCM 6 / Four-channel relay → Bottom door solenoid
        "actuator_extend_pin": 10,  # BCM 10 / Four-channel relay → Actuator extend
        "actuator_retract_pin":11,  # BCM 11 / Four-channel relay → Actuator retract
        "camera_type": "usb",
        "camera_index": 0,
    },
    2: {
        "main_door_pin":       3,   # BCM 3 / Four-channel relay → Main door solenoid
        "bottom_door_pin":     7,   # BCM 7 / Four-channel relay → Bottom door solenoid
        "actuator_extend_pin": 12,  # BCM 12 / Four-channel relay → Actuator extend
        "actuator_retract_pin":13,  # BCM 13 / Four-channel relay → Actuator retract
        "camera_type": "usb",
        "camera_index": 1,
    },
    3: {
        "main_door_pin":       4,   # BCM 4 / Four-channel relay → Main door solenoid
        "bottom_door_pin":     8,   # BCM 8 / Four-channel relay → Bottom door solenoid
        "actuator_extend_pin": 14,  # BCM 14 / Single-channel relay → Actuator extend
        "actuator_retract_pin":15,  # BCM 15 / Single-channel relay → Actuator retract
        "camera_type": "usb",
        "camera_index": 2,
    },
    4: {
        "main_door_pin":       5,   # BCM 5 / Four-channel relay → Main door solenoid
        "bottom_door_pin":     9,   # BCM 9 / Four-channel relay → Bottom door solenoid
        "actuator_extend_pin": 16,  # BCM 16 / Single-channel relay → Actuator extend
        "actuator_retract_pin":17,  # BCM 17 / Single-channel relay → Actuator retract
        "camera_type": "usb",
        "camera_index": 3,
    },
}

FACE_CAMERA_INDEX = 4   # 5th USB camera → /dev/video8 (index into USB_DEVICE_MAP)


def load_timing_config() -> dict:
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return _default_timing()


def save_timing_config(config: dict) -> None:
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def _default_timing() -> dict:
    default_locker = {
        "main_door_open_seconds": 15,
        "bottom_door_open_seconds": 15,
        "actuator_extend_seconds": 5,
        "actuator_retract_seconds": 5,
    }
    return {
        "lockers": {str(i): dict(default_locker) for i in range(1, 5)},
        "face_recognition": {
            "confidence_threshold": 0.6,
            "capture_attempts": 3,
            "capture_timeout_seconds": 30,
        },
    }
