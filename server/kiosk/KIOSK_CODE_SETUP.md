# EngiRent Kiosk – Code Setup & Architecture Guide

Complete guide to understanding and setting up the EngiRent kiosk codebase on Raspberry Pi 5.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Directory Structure](#directory-structure)
3. [Module Breakdown](#module-breakdown)
4. [Setup Instructions](#setup-instructions)
5. [Running the Kiosk](#running-the-kiosk)
6. [Development Workflow](#development-workflow)
7. [Troubleshooting](#troubleshooting)

---

## Project Overview

The EngiRent kiosk is a **Raspberry Pi 5-based IoT device** that manages 4 hardware-controlled lockers. It handles:

- **GPIO Control** – Relay boards for solenoid locks
- **Motor Control** – H-bridge drivers for linear actuators
- **Camera Management** – CSI cameras + USB webcams for image capture & face recognition
- **Local UI** – Flask-based web interface for touchscreen display
- **Real-time Communication** – Socket.io client connecting to Node.js backend
- **WiFi Provisioning** – AP (Access Point) mode for first-time network setup
- **Image Upload** – Supabase integration for storing captured images

---

## Directory Structure

```
kiosk/
├── main.py                          # Entry point – orchestrates startup sequence
├── config.py                        # Configuration loader
├── diagnose.py                      # Hardware diagnostics utility
├── kiosk_config.json               # Locker timing & behavior config
├── .env.example                     # Environment variable template
├── requirements.txt                 # Python dependencies
├── SETUP.md                         # Hardware setup instructions
├── setup.sh / setup.bat             # Installation scripts
│
├── hardware/                        # GPIO & actuator control
│   ├── gpio_controller.py           # Low-level GPIO via lgpio
│   ├── actuator_controller.py       # Linear actuator PWM control
│   ├── camera_manager.py            # CSI + USB camera initialization
│   └── __init__.py
│
├── kiosk_ui/                        # Local Flask web server
│   ├── server.py                    # Flask app & Socket.io handler
│   ├── static/                      # Frontend assets (CSS, JS, images)
│   ├── templates/                   # HTML templates (touchscreen UI)
│   └── __init__.py
│
├── services/                        # Background services
│   ├── socket_client.py             # Socket.io client (Backend comms)
│   ├── face_service.py              # Face detection & recognition
│   ├── image_uploader.py            # Upload images to Supabase
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
4. **Hardware Init** – Initialize GPIO, cameras, relay boards
5. **UI Server** – Start Flask web server (daemon thread)
6. **Socket.io Loop** – Connect to backend and wait for commands (blocks forever)

**Run:** `python3 main.py`

---

### **hardware/** – GPIO & Motor Control

#### `gpio_controller.py`
- **Purpose:** Low-level GPIO control using `lgpio` (RP1 chip support)
- **Key Functions:**
  - `setup_gpio()` – Initialize relay pins
  - `activate_relay()` / `deactivate_relay()` – Control solenoid locks
  - `read_sensor()` – Read status sensors

#### `actuator_controller.py`
- **Purpose:** Control linear actuators via PWM (H-bridge motor drivers)
- **Key Functions:**
  - `extend_actuator()` – Push out trapdoor
  - `retract_actuator()` – Pull back trapdoor
  - Timing & speed control from `kiosk_config.json`

#### `camera_manager.py`
- **Purpose:** Manage CSI (Pi Camera) and USB webcams
- **Key Functions:**
  - `initialize_cameras()` – Detect & initialize all camera inputs
  - `capture_image()` – Snapshot from specific camera
  - Uses `picamera2` (CSI) + `OpenCV` (USB)

---

### **kiosk_ui/** – Touchscreen Interface

#### `server.py`
- **Purpose:** Flask web server + Socket.io handler for real-time comms
- **Endpoints:**
  - `GET /` – Main touchscreen UI
  - `POST /api/unlock` – Trigger locker unlock (from UI touch buttons)
  - `GET /api/status` – Get locker & hardware status
  - `Socket.io Events` – Receive commands from backend
- **Runs on:** `http://localhost:8080` (configured in `.env`)

---

### **services/** – Background Services

#### `socket_client.py`
- **Purpose:** Persistent Socket.io connection to Node.js backend
- **Responsibilities:**
  - Auto-reconnect with exponential backoff
  - Listen for `unlock_locker` / `lock_locker` commands
  - Emit `locker_status` / `image_captured` events
  - Handle heartbeat / keep-alive

#### `face_service.py`
- **Purpose:** Face detection & recognition
- **Key Functions:**
  - Load pre-trained models (OpenCV + optional ML API)
  - Process camera frames for face detection
  - Send detected faces to backend ML service

#### `image_uploader.py`
- **Purpose:** Upload captured images to Supabase storage
- **Key Functions:**
  - Queue images for upload
  - Handle retries on failure
  - Associate images with locker ID & timestamp

---

### **provisioning/** – WiFi Setup

#### `ap_portal.py`
- **Purpose:** Flask AP (Access Point) portal for WiFi provisioning
- **Trigger:** Runs if no WiFi detected on startup
- **Flow:**
  1. Pi creates its own WiFi network (`engirent-setup`)
  2. User connects from phone/laptop
  3. User selects home WiFi + enters password
  4. Pi connects and reboots

#### `wifi_manager.py`
- **Purpose:** Wrapper around `NetworkManager` (nmcli)
- **Key Functions:**
  - `scan_networks()` – List available WiFi networks
  - `connect()` – Connect to network with SSID/password
  - `get_status()` – Check connection state

---

### **config.py** – Configuration Manager

Loads and validates settings from:
- `.env` file (environment variables)
- `kiosk_config.json` (locker timings)

**Key Variables:**
- `KIOSK_ID` – Unique identifier (e.g., `kiosk-1`)
- `SERVER_URL` – Backend API endpoint
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` – Database access
- `UI_PORT` – Flask server port
- `RELAY_ACTIVE_LEVEL` – Relay activation logic (0=active-LOW, 1=active-HIGH)

---

### **diagnose.py** – Hardware Diagnostics

**Run:** `python3 diagnose.py`

Tests:
- GPIO pin connectivity
- Camera detection (CSI + USB)
- Relay board response
- Motor actuator operation
- Network connectivity
- Supabase connectivity

---

## Setup Instructions

### **1. Prerequisites**

Ensure you've completed the hardware setup in [SETUP.md](./SETUP.md):
- OS flashed (Raspberry Pi OS Trixie)
- System dependencies installed (`lgpio`, `picamera2`, etc.)
- Wired ethernet or temporary WiFi for initial setup

### **2. Clone Repository**

```bash
cd ~
git clone https://github.com/Shaloh69/EngiRent.git engirent
cd engirent/server/kiosk
```

### **3. Create Virtual Environment**

```bash
python3 -m venv venv --system-site-packages
source venv/bin/activate
```

> Use `--system-site-packages` to inherit system-installed `lgpio`, `picamera2`, and `opencv`.

### **4. Install Dependencies**

```bash
pip install -r requirements.txt
```

### **5. Configure Environment**

```bash
cp .env.example .env
nano .env
```

**Required Variables:**

| Variable | Example | Description |
|----------|---------|-------------|
| `KIOSK_ID` | `kiosk-1` | Unique identifier |
| `SERVER_URL` | `https://api.engirent.com` | Backend API |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Database |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ0...` | DB auth token |
| `ML_SERVICE_URL` | `https://ml.engirent.com` | Face recognition |
| `UI_PORT` | `8080` | Web server port |
| `RELAY_ACTIVE_LEVEL` | `0` | Relay logic (0 or 1) |

### **6. Configure Locker Behavior**

Edit `kiosk_config.json` to set locker timings:

```json
{
  "lockers": {
    "1": {
      "main_door_open_seconds": 15,
      "bottom_door_open_seconds": 15,
      "actuator_extend_seconds": 5,
      "actuator_retract_seconds": 5,
      "actuator_speed_percent": 100
    }
  }
}
```

### **7. Test Hardware**

```bash
python3 diagnose.py
```

Verify all hardware is detected and responsive.

---

## Running the Kiosk

### **Manual Start (Testing)**

```bash
source venv/bin/activate
python3 main.py
```

**Expected Output:**
```
[INFO] kiosk.main – Checking WiFi...
[INFO] kiosk.main – WiFi connected: home-network
[INFO] kiosk.gpio – Initializing GPIO (RP1)...
[INFO] kiosk.camera – Detected 4 camera inputs
[INFO] kiosk.kiosk_ui – Flask server started on 0.0.0.0:8080
[INFO] kiosk.socket – Connecting to https://api.engirent.com...
[INFO] kiosk.socket – Connected! Listening for commands...
```

### **Autostart on Boot (Systemd)**

```bash
sudo cp systemd/engirent-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable engirent-kiosk.service
sudo systemctl start engirent-kiosk.service
```

**Check Status:**
```bash
sudo systemctl status engirent-kiosk.service
sudo journalctl -u engirent-kiosk.service -f  # Live logs
```

### **Stop the Service**

```bash
sudo systemctl stop engirent-kiosk.service
```

---

## Development Workflow

### **Setup Dev Environment**

```bash
cd ~/engirent/server/kiosk
source venv/bin/activate
```

### **Running in Debug Mode**

Edit `main.py` and set logging level:
```python
logging.basicConfig(level=logging.DEBUG)
```

Then run:
```bash
python3 main.py
```

### **Testing Individual Modules**

**Test GPIO:**
```bash
python3 -c "from hardware.gpio_controller import *; test_relay(1)"
```

**Test Camera:**
```bash
python3 -c "from hardware.camera_manager import *; initialize_cameras(); capture_image(1)"
```

**Test Backend Connection:**
```bash
python3 -c "from services.socket_client import *; asyncio.run(connect())"
```

### **Hot Reload for Frontend**

The Flask UI server watches `kiosk_ui/static/` and `kiosk_ui/templates/` for changes.
Edit HTML/CSS and refresh the browser—no restart needed.

### **Logs Location**

- **Terminal Output:** Live colorized logs
- **File Logs:** `~/engirent/server/kiosk/data/kiosk.log`

---

## Troubleshooting

### **WiFi Not Detected on Startup**

**Symptom:** Pi enters AP mode, won't connect to home network.

**Solution:**
1. Connect to `engirent-setup` network from phone
2. Open `http://192.168.4.1` in browser
3. Scan & select home WiFi
4. Enter password (exact case-sensitive)
5. Wait for reboot

If still failing:
```bash
sudo nmtui  # NetworkManager TUI – manual config
```

---

### **GPIO Not Responding**

**Symptom:** Relays don't activate, actuators don't move.

**Diagnosis:**
```bash
python3 diagnose.py
# Look for GPIO errors
```

**Check lgpio:**
```bash
python3 -c "import lgpio; print(lgpio.__version__)"
```

**Verify Wiring:**
- Check GPIO pin numbers match `hardware/gpio_controller.py`
- Verify power supply connections (12V solenoids, 5V Pi)
- Test relay module directly with multimeter

---

### **Camera Not Detected**

**Symptom:** Camera frames not captured, face detection fails.

**Diagnosis:**
```bash
python3 diagnose.py  # Check camera detection
ls /dev/video*       # Should list /dev/video0, /dev/video2, etc.
```

**CSI Camera Issues:**
```bash
sudo raspi-config  # Enable Camera in Interface Options
# Reboot and retry
```

**USB Webcam Not Detected:**
```bash
lsusb              # List connected USB devices
# Check if camera appears
dmesg | tail -20   # Look for USB errors
```

---

### **Backend Connection Fails**

**Symptom:** Socket.io can't connect to backend, logs show timeout.

**Check:**
```bash
curl https://api.engirent.com/health  # Verify backend is up
```

**Verify Environment:**
```bash
cat .env | grep SERVER_URL
# Ensure URL is correct (https://, no trailing slash)
```

**Test Socket Connection:**
```bash
python3 -c "
import asyncio
from services.socket_client import SocketClient
client = SocketClient()
asyncio.run(client.connect())
"
```

---

### **Flask UI Not Accessible**

**Symptom:** Can't reach `http://localhost:8080` from browser.

**Check Port:**
```bash
lsof -i :8080  # See what's using port 8080
```

**Verify Flask Started:**
```bash
ps aux | grep main.py  # Look for Python process
```

**Check Firewall:**
```bash
sudo ufw status  # Ensure port 8080 is open
sudo ufw allow 8080/tcp  # If needed
```

---

### **Out of Memory / Slow Performance**

**Symptom:** Kiosk freezes, processes crash.

**Check Memory:**
```bash
free -h
top  # Look for memory-hungry processes
```

**Optimize:**
- Reduce camera resolution in `camera_manager.py`
- Disable face recognition if not needed
- Check for memory leaks in long-running threads
- Reduce image quality for uploads

---

### **Image Upload Failing**

**Symptom:** Images not reaching Supabase, upload service errors.

**Check Credentials:**
```bash
cat .env | grep SUPABASE
# Verify URL and key are correct
```

**Test Upload Directly:**
```bash
python3 -c "
from services.image_uploader import ImageUploader
uploader = ImageUploader()
# Manually test upload
"
```

**Check Bucket Permissions:**
- Login to Supabase dashboard
- Verify storage bucket `media` exists and is readable

---

## Quick Reference

### **Common Commands**

```bash
# Start kiosk (manual)
source venv/bin/activate && python3 main.py

# Test hardware
python3 diagnose.py

# View logs (running service)
sudo journalctl -u engirent-kiosk.service -f

# Restart service
sudo systemctl restart engirent-kiosk.service

# Connect to WiFi (interactive)
sudo nmtui

# Check system resources
free -h && df -h
```

### **File Locations**

| File | Purpose |
|------|---------|
| `.env` | Environment variables (API keys, URLs) |
| `kiosk_config.json` | Locker timings & behavior |
| `hardware/gpio_controller.py` | GPIO pin definitions |
| `kiosk_ui/server.py` | Web UI endpoints |
| `services/socket_client.py` | Backend connection logic |
| `data/kiosk.log` | Application logs |

---

## Next Steps

1. ✅ **Complete Hardware Setup** – See [SETUP.md](./SETUP.md)
2. ✅ **Follow Setup Instructions** (above)
3. ✅ **Run `diagnose.py`** – Verify hardware
4. ✅ **Test with `python3 main.py`** – Manual start
5. ✅ **Enable Autostart** – Systemd service
6. ✅ **Monitor with Logs** – `journalctl` command

For backend integration details, see `../node_server/README.md`.

---

**Last Updated:** 2026-04-22  
**Version:** 1.0  
**Maintainer:** EngiRent Team
