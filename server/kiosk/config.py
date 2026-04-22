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
# Each locker: 2 solenoids (main door, bottom door) + 1 relay-pair actuator
# Solenoids controlled via relay modules (active-LOW by default)
# Actuators controlled via 2-relay polarity-reversal circuit
#   extend relay ON + retract relay OFF  → actuator extends (item in)
#   extend relay OFF + retract relay ON  → actuator retracts (item out)
LOCKER_PINS = {
    1: {
        "main_door_pin":       17,   # BCM 17 / Pin 11 → Solenoid relay
        "bottom_door_pin":     27,   # BCM 27 / Pin 13 → Solenoid relay
        "actuator_extend_pin": 12,   # BCM 12 / Pin 32 → 4-CH Relay IN1
        "actuator_retract_pin":16,   # BCM 16 / Pin 36 → 4-CH Relay IN2
        "camera_type": "csi",
        "camera_index": 0,
    },
    2: {
        "main_door_pin":       22,   # BCM 22 / Pin 15 → Solenoid relay
        "bottom_door_pin":     23,   # BCM 23 / Pin 16 → Solenoid relay
        "actuator_extend_pin": 20,   # BCM 20 / Pin 38 → 4-CH Relay IN3
        "actuator_retract_pin":21,   # BCM 21 / Pin 40 → 4-CH Relay IN4
        "camera_type": "csi",
        "camera_index": 1,
    },
    3: {
        "main_door_pin":       24,   # BCM 24 / Pin 18 → Solenoid relay
        "bottom_door_pin":     25,   # BCM 25 / Pin 22 → Solenoid relay
        "actuator_extend_pin": 19,   # BCM 19 / Pin 35 → Single Relay 1
        "actuator_retract_pin":26,   # BCM 26 / Pin 37 → Single Relay 2
        "camera_type": "usb",
        "camera_index": 0,
    },
    4: {
        "main_door_pin":       5,    # BCM 5  / Pin 29 → Solenoid relay
        "bottom_door_pin":     6,    # BCM 6  / Pin 31 → Solenoid relay
        "actuator_extend_pin": 13,   # BCM 13 / Pin 33 → Single Relay 3
        "actuator_retract_pin":4,    # BCM 4  / Pin 7  → Single Relay 4
        "camera_type": "usb",
        "camera_index": 1,
    },
}

FACE_CAMERA_INDEX = 2   # USB port 3/Hub → /dev/video6 or similar


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
