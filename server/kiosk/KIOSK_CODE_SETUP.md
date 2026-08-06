# EngiRent Kiosk – Code Setup & Architecture Guide

Complete guide to understanding and setting up the EngiRent kiosk codebase on Raspberry Pi 5.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Hardware Reference](#hardware-reference)
3. [Directory Structure](#directory-structure)
4. [Module Breakdown](#module-breakdown)
5. [Setup Instructions](#setup-instructions)
6. [Running the Kiosk](#running-the-kiosk)
7. [Development Workflow](#development-workflow)
8. [Troubleshooting](#troubleshooting)

---

## Project Overview

The EngiRent kiosk is a **Raspberry Pi 5-based IoT device** that manages 4 hardware-controlled lockers. It handles:

- **GPIO Control** – 3× 4-channel relay boards + 4× single-channel relay boards for solenoid locks and linear actuators
- **Camera Management** – 5× USB cameras via GStreamer MJPEG pipeline (4 locker cams + 1 face cam)
- **Local UI** – Flask-based web interface for touchscreen display
- **Real-time Communication** – Socket.io client connecting to Node.js backend
- **WiFi Provisioning** – AP (Access Point) mode for first-time network setup
- **Image Upload** – Supabase integration for storing captured images
- **Face Verification** – ML service for renter identity check

---

## Hardware Reference

### Relay Wiring (BCM Pin Map)

Each locker has a **main door** (solenoid), **bottom door** (solenoid), and a **linear actuator** (extend + retract).

| Relay Module | Channel | BCM Pin | Function |
|---|---|---|---|
| Module 1 (4-ch SRD-05VDC) | CH1 | BCM 2 | Locker 1 – Main door solenoid |
| Module 1 (4-ch SRD-05VDC) | CH2 | BCM 3 | Locker 2 – Main door solenoid |
| Module 1 (4-ch SRD-05VDC) | CH3 | BCM 4 | Locker 3 – Main door solenoid |
| Module 1 (4-ch SRD-05VDC) | CH4 | BCM 5 | Locker 4 – Main door solenoid |
| Module 2 (4-ch SRD-05VDC) | CH1 | BCM 6 | Locker 1 – Bottom door solenoid |
| Module 2 (4-ch SRD-05VDC) | CH2 | BCM 7 | Locker 2 – Bottom door solenoid |
| Module 2 (4-ch SRD-05VDC) | CH3 | BCM 8 | Locker 3 – Bottom door solenoid |
| Module 2 (4-ch SRD-05VDC) | CH4 | BCM 9 | Locker 4 – Bottom door solenoid |
| Module 3 (4-ch SRD-05VDC) | CH1 | BCM 10 | Locker 1 – Actuator EXTEND |
| Module 3 (4-ch SRD-05VDC) | CH2 | BCM 11 | Locker 1 – Actuator RETRACT |
| Module 3 (4-ch SRD-05VDC) | CH3 | BCM 12 | Locker 2 – Actuator EXTEND |
| Module 3 (4-ch SRD-05VDC) | CH4 | BCM 13 | Locker 2 – Actuator RETRACT |
| Module 4 (1-ch SRD-12VDC) | – | BCM 14 | Locker 3 – Actuator EXTEND |
| Module 4 (1-ch SRD-12VDC) | – | BCM 15 | Locker 3 – Actuator RETRACT |
| Module 4 (1-ch SRD-12VDC) | – | BCM 16 | Locker 4 – Actuator EXTEND |
| Module 4 (1-ch SRD-12VDC) | – | BCM 17 | Locker 4 – Actuator RETRACT |

> All relay modules are **active-LOW** (signal LOW = relay ON). Set `RELAY_ACTIVE_LEVEL=active_low` in `.env`.

### USB Camera Map

All 5 cameras are USB. Each USB camera exposes **two V4L2 nodes** — always use the first (lower-numbered) node.

| Camera | V4L2 Device | Role |
|---|---|---|
| USB cam 0 | `/dev/video0` | Locker 1 interior |
| USB cam 1 | `/dev/video2` | Locker 2 interior |
| USB cam 2 | `/dev/video4` | Locker 3 interior |
| USB cam 3 | `/dev/video7` | Locker 4 interior |
| USB cam 4 | `/dev/video10` | Face verification |

> Run `v4l2-ctl --list-devices` to verify device nodes after reboot or replug. Update `USB_DEVICE_MAP` in `hardware/camera_manager.py` if nodes differ.

**Test a specific camera:**
```bash
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video0 -frames:v 1 /tmp/cam0.jpg -y
```

---

## Directory Structure

```
kiosk/
├── main.py                          # Entry point – orchestrates startup sequence
├── config.py                        # Configuration loader & GPIO pin map
├── diagnose.py                      # Hardware diagnostics utility
├── kiosk_config.json               # Locker timing & behavior config (seconds)
├── .env.example                     # Environment variable template
├── requirements.txt                 # Python dependencies
├── SETUP.md                         # Hardware setup instructions
├── setup.sh / setup.bat             # Installation scripts
│
├── hardware/                        # GPIO & camera control
│   ├── gpio_controller.py           # Solenoid relay control via lgpio
│   ├── actuator_controller.py       # Linear actuator relay control
│   ├── camera_manager.py            # 5× USB cameras via GStreamer MJPEG
│   └── __init__.py
│
├── kiosk_ui/                        # Local Flask web server (backend half only)
│   ├── server.py                    # Flask app, state/session REST endpoints, MJPEG stream
│   └── __init__.py
│                                     # (serves ../kiosk_ui_react/dist — see below)
│
├── kiosk_ui_react/                  # Touchscreen UI — React + Vite + TypeScript
│   ├── src/                         # Screens, state machine, Framer Motion/theme
│   └── dist/                        # `npm run build` output, served by server.py
│
├── services/                        # Background services
│   ├── socket_client.py             # Socket.io client (backend comms)
│   ├── face_service.py              # Face detection & recognition
│   ├── image_uploader.py            # Upload images via the Node API's local storage
│   └── __init__.py
│
├── provisioning/                    # WiFi setup & AP mode
│   ├── ap_portal.py                 # Access Point web portal
│   ├── wifi_manager.py              # NetworkManager wrapper
│   └── __init__.py
│
├── systemd/                         # Linux service definitions
│   └── engirent-kiosk.service       # Autostart configuration
│
└── data/                            # Runtime data (logs, images, etc)
```

---

## Module Breakdown

### **main.py** – Entry Point

Orchestrates the startup sequence:

1. **Logging Setup** – Initialize colored terminal + file logging
2. **Environment Loading** – Load `.env` variables
3. **WiFi Check** – If no WiFi, enter AP provisioning mode (blocks)
4. **Hardware Init** – Initialize GPIO (lgpio), cameras (GStreamer), relay boards
5. **UI Server** – Start Flask web server (daemon thread)
6. **Socket.io Loop** – Connect to backend and wait for commands (blocks forever)

**Run:** `python3 main.py`

---

### **config.py** – Configuration Manager

Loads settings from `.env` and `kiosk_config.json`.

**Key Variables:**

| Variable | Description |
|----------|-------------|
| `KIOSK_ID` | Unique identifier (e.g. `kiosk-1`) |
| `SERVER_URL` | Backend Socket.io endpoint |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Storage credentials |
| `ML_SERVICE_URL` | Face recognition service |
| `RELAY_ACTIVE_LOW` | `True` for active-LOW relay modules |
| `MOCK_GPIO` | `True` to skip real GPIO (testing on non-Pi) |
| `MOCK_CAMERA` | `True` to return placeholder images |
| `GPIO_CHIP` | Auto-detected (0 or 4) for Pi 5 RP1 chip |

**`LOCKER_PINS` in `config.py`** (source of truth for wiring):

```python
LOCKER_PINS = {
    1: { "main_door_pin": 2,  "bottom_door_pin": 6,  "actuator_extend_pin": 10, "actuator_retract_pin": 11, "camera_index": 0 },
    2: { "main_door_pin": 3,  "bottom_door_pin": 7,  "actuator_extend_pin": 12, "actuator_retract_pin": 13, "camera_index": 1 },
    3: { "main_door_pin": 4,  "bottom_door_pin": 8,  "actuator_extend_pin": 14, "actuator_retract_pin": 15, "camera_index": 2 },
    4: { "main_door_pin": 5,  "bottom_door_pin": 9,  "actuator_extend_pin": 16, "actuator_retract_pin": 17, "camera_index": 3 },
}
FACE_CAMERA_INDEX = 4
```

> **Never override `LOCKER_PINS` from the admin panel.** The server's `kiosk:config` event only updates timing values — pin wiring stays local.

---

### **hardware/** – GPIO & Camera Control

#### `gpio_controller.py`
- Controls solenoid locks via active-LOW relay modules
- Uses `lgpio` for Pi 5 RP1 chip compatibility
- GPIO chip auto-detected at startup (`GPIO_CHIP` in `config.py`)
- Key method: `SolenoidController.unlock_for(locker_id, door, duration_seconds)`

#### `actuator_controller.py`
- Controls linear actuators via ON/OFF relay pairs (extend + retract)
- Place sequence: extend (push item in) → retract (return platform)
- Key method: `ActuatorController.place_item(locker_id, extend_s, retract_s)`

#### `camera_manager.py`
- **All 5 cameras are USB** — no CSI/picamera2
- Opens cameras via **GStreamer MJPEG pipeline** (low CPU, 30fps)
- Fallback to YUYV 640×480 if MJPEG pipeline fails
- Locker cameras: 1280×720 MJPEG | Face camera: 640×480 MJPEG
- Device node map defined in `USB_DEVICE_MAP` (update after hardware changes)

---

### **services/socket_client.py** – Backend Communication

Persistent Socket.io connection to Node.js backend.

**Events emitted TO server:**

| Event | Payload | When |
|---|---|---|
| `kiosk:register` | `{kiosk_id, locker_count, version}` | On connect |
| `kiosk:status` | `{kiosk_id, ui_state, config}` | After each command |
| `kiosk:images` | `{kiosk_id, locker_id, image_urls, rental_id}` | After capture_image |
| `kiosk:face` | `{detected, verified, confidence, ...}` | After capture_face |
| `kiosk:ack` | `{command_id, action, status: "ok"\|"error"}` | After every command |
| `kiosk:log` | `{level, module, message}` | All INFO+ log lines |

**Events received FROM server:**

| Event | Actions supported |
|---|---|
| `kiosk:command` | `open_door`, `drop_item`, `capture_image`, `capture_face`, `lock_all`, `actuator_extend`, `actuator_retract` |
| `kiosk:config` | Timing update (seconds) — pin wiring is **ignored** from server |

**Config update behaviour:** The server sends `kiosk:config` on every kiosk connect. The handler only saves `lockers`-format timing data and ignores `solenoid_pins`, `actuator_pins`, and `camera_indices` — the Pi's local `config.py` is always the source of truth for wiring.

---

### **kiosk_ui/server.py** – Touchscreen Interface

Flask server running on `http://localhost:8080`, serving the built
`kiosk_ui_react/dist/` (React + Vite + TypeScript — migrated from a prior
Flask-templates + vanilla-JS UI so the kiosk shares the same Framer
Motion/animation stack as the phone app and admin console). Run `npm run
build` inside `kiosk_ui_react/` after any UI change — Flask serves whatever
is currently in `dist/`, it doesn't rebuild it. For UI development, `npm run
dev` inside `kiosk_ui_react/` runs a hot-reloading Vite dev server on
`:5173` that proxies `/api`, `/camera`, and `/socket.io` to this Flask
server; `?demo=<screen>` (idle/main/qr/confirm/face/verifying/success/error)
forces a screen with placeholder data for design work without a live kiosk
backend.

- `GET /` – Main touchscreen UI (React build's `index.html`)
- `GET /api/status` – Current locker/hardware state (used by UI polling)

---

### **provisioning/** – WiFi Setup

If no WiFi on startup, the Pi enters AP mode:
1. Pi creates `EngiRent-Kiosk-Setup` network (password: configured in `.env`)
2. User connects from phone/laptop and opens `http://192.168.4.1`
3. User selects home WiFi + enters password
4. Pi connects and resumes

---

### **diagnose.py** – Hardware Diagnostics

```bash
python3 diagnose.py
```

Tests GPIO, cameras, relay boards, actuators, network, and Supabase connectivity.

---

## Setup Instructions

### **1. Prerequisites**

Complete the hardware setup in [SETUP.md](./SETUP.md):
- Raspberry Pi OS Trixie flashed
- `lgpio`, `opencv`, `gstreamer` system packages installed
- Wired ethernet or temporary WiFi for initial setup

### **2. CRITICAL — Disable Camera Auto-Detect**

The kernel's camera auto-detect claims GPIO4, which prevents the kiosk from opening Locker 3's main door. **Must be done before first boot:**

```bash
sudo nano /boot/firmware/config.txt
```

Find and change:
```
camera_auto_detect=1
```
to:
```
camera_auto_detect=0
```

Then reboot:
```bash
sudo reboot
```

### **3. Clone Repository**

```bash
cd ~
git clone https://github.com/Shaloh69/EngiRent.git engirent
cd engirent/server/kiosk
```

### **4. Create Virtual Environment**

```bash
python3 -m venv venv --system-site-packages
source venv/bin/activate
```

> `--system-site-packages` inherits system-installed `lgpio`, `opencv`, and `gstreamer` Python bindings.

### **5. Install Dependencies**

```bash
pip install -r requirements.txt
```

### **6. Configure Environment**

```bash
cp .env.example .env
nano .env
```

**Required Variables:**

| Variable | Example | Description |
|----------|---------|-------------|
| `KIOSK_ID` | `kiosk-1` | Unique identifier |
| `SERVER_URL` | `https://api.engirent.com` | Backend Socket.io URL |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ0...` | Supabase service role key |
| `ML_SERVICE_URL` | `https://ml.engirent.com` | Face recognition service |
| `UI_PORT` | `8080` | Flask UI port |
| `RELAY_ACTIVE_LEVEL` | `active_low` | Relay logic (`active_low` or `active_high`) |
| `MOCK_GPIO` | `False` | Set `True` for testing without hardware |
| `MOCK_CAMERA` | `False` | Set `True` for testing without cameras |

### **7. Verify Camera Devices**

Identify which camera is which locker:

```bash
v4l2-ctl --list-devices
```

Expected output (even-numbered nodes are capture devices):
```
USB Camera (usb-xhci-hcd.1-1.1):
    /dev/video0   ← Locker 1
    /dev/video1

USB Camera (usb-xhci-hcd.1-1.2):
    /dev/video2   ← Locker 2
    /dev/video3
...
```

Test each camera with ffmpeg and confirm which locker it shows:
```bash
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video0 -frames:v 1 /tmp/cam0.jpg -y
```

Update `USB_DEVICE_MAP` in `hardware/camera_manager.py` if your device nodes differ.

### **8. Configure Locker Timing**

`kiosk_config.json` controls how long doors stay open and actuator travel times (in seconds):

```json
{
  "lockers": {
    "1": {
      "main_door_open_seconds": 15,
      "bottom_door_open_seconds": 15,
      "actuator_extend_seconds": 5,
      "actuator_retract_seconds": 5,
      "actuator_speed_percent": 100
    },
    "2": { ... },
    "3": { ... },
    "4": { ... }
  },
  "face_recognition": {
    "confidence_threshold": 0.6,
    "capture_attempts": 3,
    "capture_timeout_seconds": 30
  }
}
```

> These timings can also be updated remotely from the admin panel via `kiosk:config`.

### **9. Test Hardware**

```bash
python3 diagnose.py
```

Verify all GPIO pins and cameras respond correctly before enabling autostart.

---

## Running the Kiosk

### **Manual Start (Testing)**

```bash
source venv/bin/activate
python3 main.py
```

**Expected startup log:**
```
[INFO]  kiosk.main    – Checking WiFi...
[INFO]  kiosk.main    – WiFi connected
[INFO]  kiosk.gpio    – GPIO chip detected: gpiochip0
[INFO]  kiosk.camera  – Locker camera locker=1 device=/dev/video0 ✓
[INFO]  kiosk.camera  – Locker camera locker=2 device=/dev/video2 ✓
[INFO]  kiosk.camera  – Locker camera locker=3 device=/dev/video4 ✓
[INFO]  kiosk.camera  – Locker camera locker=4 device=/dev/video7 ✓
[INFO]  kiosk.camera  – Face camera device=/dev/video10 ✓
[INFO]  kiosk.ui      – Flask server started on 0.0.0.0:8080
[INFO]  kiosk.socket  – Connecting to https://api.engirent.com ...
[INFO]  kiosk.socket  – Connected to server ✓
```

### **Autostart on Boot (Systemd)**

```bash
sudo cp systemd/engirent-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable engirent-kiosk.service
sudo systemctl start engirent-kiosk.service
```

**Check status:**
```bash
sudo systemctl status engirent-kiosk.service
sudo journalctl -u engirent-kiosk.service -f   # Live log stream
```

**Stop/restart:**
```bash
sudo systemctl stop engirent-kiosk.service
sudo systemctl restart engirent-kiosk.service
```

---

## Development Workflow

### **Mock Mode (No Hardware)**

Set in `.env` to test on a non-Pi machine:
```
MOCK_GPIO=True
MOCK_CAMERA=True
```

GPIO calls are no-ops; cameras return grey placeholder images.

### **Pull Latest Code to Pi**

```bash
cd ~/engirent
git pull
sudo systemctl restart engirent-kiosk.service
sudo journalctl -u engirent-kiosk.service -f
```

### **Testing Individual Modules**

```bash
# Test GPIO directly
python3 -c "
from config import LOCKER_PINS
from hardware.gpio_controller import SolenoidController
import asyncio
s = SolenoidController()
asyncio.run(s.unlock_for(1, 'main_door', 3))
"

# Test a single camera
python3 -c "
from hardware.camera_manager import CameraManager
cam = CameraManager()
frames = cam.capture_locker(1, num_frames=1)
open('/tmp/test.jpg', 'wb').write(frames[0])
print('Saved /tmp/test.jpg')
"

# Test face camera
python3 -c "
from hardware.camera_manager import CameraManager
cam = CameraManager()
frames = cam.capture_face(num_frames=1)
open('/tmp/face.jpg', 'wb').write(frames[0])
print('Saved /tmp/face.jpg')
"
```

### **Logs Location**

- **Live:** `sudo journalctl -u engirent-kiosk.service -f`
- **File:** `~/engirent/server/kiosk/data/kiosk.log`
- **Pi logs forwarded to server:** visible in Render/backend logs via `kiosk:log` events

---

## Troubleshooting

### **Service Crashes Immediately (exit code 1)**

**Most common cause:** `camera_auto_detect=1` in `/boot/firmware/config.txt` claims GPIO4, blocking Locker 3 main door.

**Fix:**
```bash
sudo nano /boot/firmware/config.txt
# Set: camera_auto_detect=0
sudo reboot
```

**Diagnose:**
```bash
sudo journalctl -u engirent-kiosk.service -n 50
# Look for: "lgpio.error: 'GPIO busy'"
```

---

### **GPIO Busy Error**

**Symptom:** `lgpio.error: GPIO busy` on a specific pin.

**Common causes and fixes:**

| Cause | Fix |
|---|---|
| `camera_auto_detect=1` claiming GPIO4 | Set `camera_auto_detect=0` in `/boot/firmware/config.txt`, reboot |
| Wrong GPIO chip for Pi 5 | `GPIO_CHIP` is auto-detected — check `config.py` `_detect_gpio_chip()` output |
| Another process holding the pin | `sudo lsof /dev/gpiomem*` to find the culprit |

---

### **Relays Not Activating**

**Symptom:** Door doesn't open, no click from relay.

**Check:**
1. Confirm `RELAY_ACTIVE_LEVEL=active_low` in `.env` (SRD-05VDC and SRD-12VDC are active-LOW)
2. Verify BCM pin matches the relay module channel (see [Hardware Reference](#hardware-reference))
3. Test relay directly:
```bash
python3 -c "
import lgpio, time
h = lgpio.gpiochip_open(0)  # or 4 on older Pi 5 kernels
lgpio.gpio_claim_output(h, 2)
lgpio.gpio_write(h, 2, 0)   # LOW = relay ON (active-low)
time.sleep(3)
lgpio.gpio_write(h, 2, 1)   # HIGH = relay OFF
lgpio.gpiochip_close(h)
"
```

---

### **Camera Not Opening**

**Symptom:** `Camera /dev/videoX could not be opened` in logs.

**Check:**
```bash
v4l2-ctl --list-devices          # Confirm device nodes
v4l2-ctl -d /dev/video0 --list-formats-ext  # Check MJPEG support

# Test GStreamer pipeline directly
gst-launch-1.0 v4l2src device=/dev/video0 ! \
  image/jpeg,width=1280,height=720,framerate=30/1 ! \
  jpegdec ! videoconvert ! autovideosink
```

If a camera lands on a different device node after replug, update `USB_DEVICE_MAP` in `hardware/camera_manager.py`.

---

### **Admin Panel Commands Return OK But Nothing Happens**

**Symptom:** Admin sends `open_door` command, server logs "OK", but relay doesn't fire.

**Root causes & fixes:**

1. **Server config overriding Pi wiring** — fixed in `socket_client.py`. The `kiosk:config` handler now ignores `solenoid_pins` / `actuator_pins` from the server.
2. **GPIO busy** — see above.
3. **Wrong door key** — admin must send `door: "main_door"` or `door: "bottom_door"` (not `"trapdoor"` — trapdoor hardware was removed).
4. **Pi not actually connected** — check `sudo journalctl -u engirent-kiosk.service -f` for the registration log line:
   ```
   🟢 [PI-ONLINE]  Kiosk registered
   ```

---

### **Backend Connection Fails**

**Symptom:** Socket.io can't connect, logs show repeated "reconnecting in 5s".

```bash
# Verify backend is reachable
curl https://api.engirent.com/health

# Check .env
grep SERVER_URL .env
# Must have no trailing slash, correct https:// prefix
```

---

### **WiFi Not Detected on Startup**

Pi enters AP mode automatically. To connect:
1. Connect to `EngiRent-Kiosk-Setup` WiFi from phone/laptop
2. Open `http://192.168.4.1` in browser
3. Select home WiFi and enter password
4. Wait for Pi to reconnect and resume

Manual fallback:
```bash
sudo nmtui
```

---

### **Image Upload Failing**

```bash
# Check Supabase credentials
grep SUPABASE .env

# Confirm bucket exists
# Login to supabase.com → Storage → check "media" bucket exists and is not private
```

---

## Quick Reference

### **Common Commands**

```bash
# Start kiosk manually
source venv/bin/activate && python3 main.py

# Run hardware diagnostics
python3 diagnose.py

# View live service logs
sudo journalctl -u engirent-kiosk.service -f

# Restart service after code update
git pull && sudo systemctl restart engirent-kiosk.service

# Connect to WiFi interactively
sudo nmtui

# Check V4L2 cameras
v4l2-ctl --list-devices

# Check GPIO chip
gpioinfo | head -5

# System resources
free -h && df -h
```

### **Key Files**

| File | Purpose |
|------|---------|
| `.env` | API keys, URLs, relay mode, mock flags |
| `config.py` | GPIO pin map (`LOCKER_PINS`) — source of truth for wiring |
| `kiosk_config.json` | Door open/actuator timing in seconds |
| `hardware/camera_manager.py` | `USB_DEVICE_MAP` — V4L2 device node assignments |
| `hardware/gpio_controller.py` | Solenoid relay open/lock logic |
| `hardware/actuator_controller.py` | Actuator extend/retract logic |
| `services/socket_client.py` | All backend command handlers |
| `/boot/firmware/config.txt` | Must have `camera_auto_detect=0` |

---

## Next Steps

1. ✅ Set `camera_auto_detect=0` in `/boot/firmware/config.txt` and reboot
2. ✅ Run `v4l2-ctl --list-devices` and confirm 5 camera nodes
3. ✅ Test each camera with `ffmpeg` and update `USB_DEVICE_MAP` if needed
4. ✅ Run `python3 diagnose.py` — verify all GPIO and cameras
5. ✅ Run `python3 main.py` — confirm Pi connects and admin shows kiosk online
6. ✅ Enable autostart with systemd service
7. ✅ Monitor with `journalctl -u engirent-kiosk.service -f`

---

**Last Updated:** 2026-04-22
**Version:** 2.0
**Maintainer:** EngiRent Team
