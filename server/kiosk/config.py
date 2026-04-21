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
# Each locker: 3 solenoids (main door, trapdoor, bottom door) + 1 actuator pair
# Solenoids are controlled via relay modules
# Actuators are controlled via L298N motor drivers (PWM + direction)
LOCKER_PINS = {
    1: {
        "main_door_pin": 17,      # Relay A IN1 → Solenoid 1
        "trapdoor_pin": 18,       # Relay A IN2 → Solenoid 2
        "bottom_door_pin": 27,    # Relay A IN3 → Solenoid 3
        "actuator_pwm_pin": 12,   # Motor Driver A IN1 (PWM)
        "actuator_dir_pin": 16,   # Motor Driver A IN2 (DIR)
        "camera_type": "csi",
        "camera_index": 0,        # CSI0 connector
    },
    2: {
        "main_door_pin": 22,      # Relay A IN4 → Solenoid 4
        "trapdoor_pin": 23,       # Relay B IN1 → Solenoid 5
        "bottom_door_pin": 24,    # Relay B IN2 → Solenoid 6
        "actuator_pwm_pin": 20,   # Motor Driver A IN3 (PWM)
        "actuator_dir_pin": 21,   # Motor Driver A IN4 (DIR)
        "camera_type": "csi",
        "camera_index": 1,        # CSI1 connector
    },
    3: {
        "main_door_pin": 25,      # Relay B IN3 → Solenoid 7
        "trapdoor_pin": 9,        # Relay B IN4 → Solenoid 8  (was GPIO8 = SPI0-CE0, conflicts with SPI)
        "bottom_door_pin": 7,     # 1-CH Relay 9 → Solenoid 9
        "actuator_pwm_pin": 19,   # Motor Driver B IN1 (PWM)
        "actuator_dir_pin": 26,   # Motor Driver B IN2 (DIR)
        "camera_type": "usb",
        "camera_index": 0,        # USB port 1 → /dev/video4 or similar
    },
    4: {
        "main_door_pin": 11,      # 1-CH Relay 10 → Solenoid 10  (was GPIO1 = HAT EEPROM ID_SC)
        "trapdoor_pin": 10,       # 1-CH Relay 11 → Solenoid 11  (was GPIO0 = HAT EEPROM ID_SD)
        "bottom_door_pin": 5,     # 1-CH Relay 12 → Solenoid 12
        "actuator_pwm_pin": 13,   # Motor Driver B IN3 (PWM, hardware PWM1)
        "actuator_dir_pin": 6,    # Motor Driver B IN4 (DIR)
        "camera_type": "usb",
        "camera_index": 1,        # USB port 2 → /dev/video5 or similar
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
        "trapdoor_unlock_seconds": 2,
        "bottom_door_open_seconds": 15,
        "actuator_push_seconds": 5,
        "actuator_pull_seconds": 5,
        "actuator_speed_percent": 100,
    }
    return {
        "lockers": {str(i): dict(default_locker) for i in range(1, 5)},
        "face_recognition": {
            "confidence_threshold": 0.6,
            "capture_attempts": 3,
            "capture_timeout_seconds": 30,
        },
    }
