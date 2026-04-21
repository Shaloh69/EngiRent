"""
EngiRent Kiosk – main entry point.

Start order:
  1. Logging setup (colored terminal + file)
  2. Load .env
  3. Check WiFi → if missing, run AP provisioning mode (blocks until reboot)
  4. Init hardware (GPIO, actuators, cameras)
  5. Start local HDMI UI server (daemon thread)
  6. Start Socket.io client loop (blocks forever, reconnects on disconnect)
"""

import asyncio
import logging
import os
import sys
import time

from dotenv import load_dotenv

load_dotenv()

# ── Colored terminal formatter ─────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RED    = "\033[91m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
CYAN   = "\033[96m"
WHITE  = "\033[97m"

LEVEL_COLORS = {
    "DEBUG":    DIM + WHITE,
    "INFO":     GREEN,
    "WARNING":  YELLOW,
    "ERROR":    RED,
    "CRITICAL": BOLD + RED,
}

MODULE_COLORS = {
    "kiosk.main":          BOLD + CYAN,
    "kiosk.socket":        BOLD + BLUE,
    "kiosk.gpio":          BOLD + YELLOW,
    "kiosk.actuator":      BOLD + YELLOW,
    "kiosk.camera":        BOLD + GREEN,
    "kiosk.face":          BOLD + GREEN,
    "kiosk.uploader":      BLUE,
    "kiosk.ui":            CYAN,
    "kiosk.wifi":          YELLOW,
    "kiosk.ap":            YELLOW,
}


class ColorFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        lc = LEVEL_COLORS.get(record.levelname, WHITE)
        mc = MODULE_COLORS.get(record.name, DIM + WHITE)

        ts   = self.formatTime(record, "%H:%M:%S")
        lvl  = f"{lc}{record.levelname:<8}{RESET}"
        name = f"{mc}{record.name}{RESET}"
        msg  = record.getMessage()

        if record.levelno >= logging.ERROR:
            msg = f"{RED}{msg}{RESET}"
        elif record.levelno == logging.WARNING:
            msg = f"{YELLOW}{msg}{RESET}"

        line = f"{DIM}{ts}{RESET}  {lvl}  {name}  {msg}"

        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def _setup_logging():
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    # Terminal handler – colored
    sh = logging.StreamHandler(sys.stdout)
    sh.setLevel(logging.DEBUG)
    sh.setFormatter(ColorFormatter())

    # File handler – plain text
    fh = logging.FileHandler("/var/log/engirent-kiosk.log", encoding="utf-8")
    fh.setLevel(logging.INFO)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(name)s – %(message)s"
    ))

    root.addHandler(sh)
    root.addHandler(fh)

    # Silence noisy third-party loggers
    for noisy in ("engineio", "socketio", "urllib3", "werkzeug"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


_setup_logging()
log = logging.getLogger("kiosk.main")


def _banner():
    from config import GPIO_CHIP
    kiosk_id   = os.getenv("KIOSK_ID", "kiosk-1")
    server_url = os.getenv("SERVER_URL", "?")
    ui_port    = os.getenv("UI_PORT", "8080")
    mock_gpio  = os.getenv("MOCK_GPIO", "false").lower() == "true"
    mock_cam   = os.getenv("MOCK_CAMERA", "false").lower() == "true"

    print(f"\n{BOLD}{CYAN}{'=' * 56}{RESET}")
    print(f"{BOLD}{CYAN}   EngiRent Hub – Kiosk Controller{RESET}")
    print(f"{BOLD}{CYAN}{'=' * 56}{RESET}")
    print(f"  {DIM}Kiosk ID  :{RESET}  {WHITE}{kiosk_id}{RESET}")
    print(f"  {DIM}Server    :{RESET}  {WHITE}{server_url}{RESET}")
    print(f"  {DIM}UI Port   :{RESET}  {WHITE}{ui_port}{RESET}")
    print(f"  {DIM}GPIO Chip :{RESET}  {WHITE}/dev/gpiochip{GPIO_CHIP}{RESET}")
    print(f"  {DIM}GPIO Mock :{RESET}  {YELLOW if mock_gpio else GREEN}{'ON (simulated)' if mock_gpio else 'OFF (real hardware)'}{RESET}")
    print(f"  {DIM}Cam Mock  :{RESET}  {YELLOW if mock_cam else GREEN}{'ON (simulated)' if mock_cam else 'OFF (real cameras)'}{RESET}")
    print(f"{BOLD}{CYAN}{'=' * 56}{RESET}\n")


# ── Imports (after logging is configured) ─────────────────────────────────────
from provisioning.wifi_manager import is_wifi_connected
from provisioning.ap_portal import AP_SSID, AP_PASSWORD, AP_IP, run_portal, start_ap_mode
from kiosk_ui.server import start_ui_server_thread
from services.socket_client import init_hardware, connect_to_server
from hardware.gpio_controller import SolenoidController
from hardware.actuator_controller import ActuatorController
from hardware.camera_manager import CameraManager


# ── WiFi provisioning ──────────────────────────────────────────────────────────

def maybe_provision():
    log.info("Checking WiFi connection…")
    if is_wifi_connected():
        log.info("WiFi connected ✓")
        return

    log.warning("No WiFi — entering AP provisioning mode")
    ap_ssid = os.getenv("AP_SSID", AP_SSID)
    ap_pass = os.getenv("AP_PASSWORD", AP_PASSWORD)
    ap_ip   = os.getenv("AP_IP", AP_IP)

    if not start_ap_mode(ssid=ap_ssid, password=ap_pass, ip=ap_ip):
        log.error("Could not start AP hotspot — skipping (retry next boot)")
        return

    log.info("Hotspot '%s' active  pw='%s'  portal=http://%s", ap_ssid, ap_pass, ap_ip)
    run_portal(host="0.0.0.0", port=80)

    log.error("Portal exited unexpectedly — retrying in 10 s")
    time.sleep(10)
    maybe_provision()


# ── Hardware init ──────────────────────────────────────────────────────────────

def init_hardware():
    log.info("── Hardware init ──────────────────────────────")
    log.info("[GPIO]     Initialising solenoid controller…")
    solenoid = SolenoidController()
    log.info("[GPIO]     SolenoidController ready (12 relays)")

    log.info("[ACTUATOR] Initialising actuator controller…")
    actuator = ActuatorController()
    log.info("[ACTUATOR] ActuatorController ready (4 channels)")

    log.info("[CAMERA]   Initialising camera manager…")
    camera = CameraManager()
    log.info("[CAMERA]   CameraManager ready")
    log.info("── Hardware ready ─────────────────────────────")
    return solenoid, actuator, camera


# ── Socket.io client loop ──────────────────────────────────────────────────────

async def run_socket_client(solenoid, actuator, camera):
    # Inject hardware directly into socket_client module globals
    import services.socket_client as _sc
    _sc._solenoid = solenoid
    _sc._actuator = actuator
    _sc._camera   = camera
    log.info("[SOCKET] Hardware injected into socket client")
    await connect_to_server()


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    _banner()
    log.info("Starting EngiRent Kiosk…")

    # 1. WiFi / provisioning
    maybe_provision()

    # 2. Hardware
    solenoid, actuator, camera = init_hardware()

    # 3. Local HDMI UI (daemon thread)
    log.info("[UI]     Starting HDMI UI server on port %s…", os.getenv("UI_PORT", "8080"))
    start_ui_server_thread()
    log.info("[UI]     UI server started ✓  → http://localhost:%s", os.getenv("UI_PORT", "8080"))

    # 4. Socket.io event loop
    log.info("[SOCKET] Starting Socket.io client loop…")
    try:
        asyncio.run(run_socket_client(solenoid, actuator, camera))
    except KeyboardInterrupt:
        log.info("Kiosk stopped by user (Ctrl+C)")
        try:
            solenoid.lock_all()
            solenoid.cleanup()
        except Exception:
            pass
        log.info("All solenoids locked. Goodbye.")


if __name__ == "__main__":
    main()
