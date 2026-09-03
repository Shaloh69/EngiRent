# EngiRent Kiosk – Raspberry Pi 5 Hardware & Setup Guide

---

## Table of Contents

1. [Hardware Requirements](#1-hardware-requirements)
2. [OS Flash](#2-os-flash)
3. [CRITICAL — Boot Config Fix](#3-critical--boot-config-fix)
4. [Automated Setup (Recommended)](#4-automated-setup-recommended)
5. [Manual Setup](#5-manual-setup)
6. [GPIO Wiring Reference](#6-gpio-wiring-reference)
7. [Camera Wiring & Identification](#7-camera-wiring--identification)
8. [Environment Variables](#8-environment-variables)
9. [Locker Timing Config](#9-locker-timing-config)
10. [WiFi Provisioning](#10-wifi-provisioning)
11. [Verify & Test](#11-verify--test)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Hardware Requirements

| Component | Qty | Notes |
|---|---|---|
| Raspberry Pi 5 (4 GB+) | 1 | RP1 GPIO chip (gpiochip0 / gpiochip4 kernel-dependent) |
| 4-channel relay module (SRD-05VDC-SL-C) | 3 | Modules 1–3: main doors, bottom doors, actuators L1/L2 |
| 1-channel relay module (SRD-12VDC-SL-C) | 4 | Module 4: actuators L3/L4 extend + retract (×2 each) |
| 12V solenoid lock | 8 | 2 per locker (main door + bottom door) |
| 12V linear actuator | 4 | 1 per locker — controlled by relay pairs (extend/retract) |
| 12V 10A power supply | 1 | Solenoids + actuators |
| 5V 3A USB-C power supply | 1 | Pi only |
| USB camera | 4 | One per locker interior (USB extension cables). The 5th unit — the face camera — was removed 2026-09-03; face verification now happens in the mobile app. |
| HDMI monitor / touchscreen | 1 | 7–10″ for kiosk display |
| USB hub (powered) | 1 | For 4 simultaneous USB cameras |

> **No CSI cameras.** All cameras are USB. `picamera2` is not used.  
> **No H-bridge / L298N motor drivers.** Actuators are controlled by relay pairs (one relay extends, one retracts).

---

## 2. OS Flash

Flash **Raspberry Pi OS Bookworm or Trixie (64-bit, full desktop)** with Raspberry Pi Imager.

In Imager advanced settings before writing:
- Hostname: `engirent-kiosk`
- Enable SSH
- Username: `pi` (or your preferred username)
- Password: set a strong password
- **Do NOT preconfigure WiFi** — the kiosk handles provisioning on first boot

---

## 3. CRITICAL — Boot Config Fix

**Do this before running setup or starting the kiosk.**

The default `camera_auto_detect=1` in the Pi boot config causes the kernel to probe for CSI cameras and claims **GPIO4** in the process — even when no CSI camera is connected. This permanently blocks Locker 3's main door relay.

After first boot, SSH into the Pi and fix it:

```bash
sudo nano /boot/firmware/config.txt
```

Find this line:
```
camera_auto_detect=1
```

Change it to:
```
camera_auto_detect=0
```

Save and reboot:
```bash
sudo reboot
```

> If you already ran the automated `setup.sh`, this was patched for you automatically.

---

## 4. Automated Setup (Recommended)

After cloning the repo, run the one-shot setup script. It handles everything: packages, boot config patch, venv, `.env`, config JSON, systemd service, and Chromium autostart.

```bash
cd ~
git clone https://github.com/Shaloh69/EngiRent.git engirent
cd engirent/server/kiosk
sudo bash setup.sh
```

The script will prompt you interactively for required credentials (Supabase key, server URL, etc.), then print next steps when done.

**After setup completes:**

```bash
sudo reboot   # applies camera_auto_detect=0 and auto-login
```

After reboot:

```bash
sudo systemctl start engirent-kiosk.service
sudo journalctl -u engirent-kiosk.service -f
```

---

## 5. Manual Setup

Skip this section if you used `setup.sh`.

### 5.1 System Packages

```bash
sudo apt update && sudo apt upgrade -y

# GPIO (Pi 5 RP1 chip)
sudo apt install -y python3-lgpio python3-gpiozero

# Camera — USB only via OpenCV + GStreamer (no picamera2)
sudo apt install -y python3-opencv
sudo apt install -y \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    python3-gst-1.0

# Camera tools
sudo apt install -y v4l-utils ffmpeg

# Kiosk browser + cursor hider
sudo apt install -y chromium unclutter

# Network
sudo apt install -y network-manager git python3-pip python3-venv curl
sudo systemctl enable NetworkManager
```

### 5.2 Python Virtual Environment

```bash
cd ~/engirent/server/kiosk
python3 -m venv venv --system-site-packages
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

> `--system-site-packages` is required so the venv inherits system-installed `lgpio` and `opencv`.

### 5.3 Environment File

```bash
cp .env.example .env
nano .env
```

See [Section 8](#8-environment-variables) for all variables.

### 5.4 Default Timing Config

```bash
# Only needed if kiosk_config.json doesn't exist
cp kiosk_config.json.example kiosk_config.json  # or create manually — see Section 9
```

### 5.5 Systemd Service

```bash
# Edit the service file to match your username and path
sudo sed \
    -e "s|/home/pi/engirent/server/kiosk|$(pwd)|g" \
    -e "s|User=pi|User=$(whoami)|g" \
    systemd/engirent-kiosk.service \
    > /tmp/engirent-kiosk.service

sudo mv /tmp/engirent-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable engirent-kiosk.service
```

### 5.6 Chromium Autostart

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/engirent-browser.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=EngiRent Kiosk Browser
Exec=bash -c 'until curl -sf http://localhost:8080 >/dev/null 2>&1; do sleep 2; done; while true; do if ! pgrep -f "^/usr/lib/chromium/chromium.*--app=http://localhost:8080" >/dev/null 2>&1; then /usr/bin/chromium --noerrdialogs --disable-infobars --disable-session-crashed-bubble --kiosk --start-fullscreen --window-size=1920,1080 --app=http://localhost:8080; fi; sleep 10; done'
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF
```

### 5.7 Auto-Login & Screen Blanking

```bash
sudo raspi-config nonint do_boot_behaviour B4   # Desktop auto-login

# Disable screen blanking
mkdir -p ~/.config/lxsession/LXDE-pi
cat >> ~/.config/lxsession/LXDE-pi/autostart <<'EOF'
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0 -root
EOF
```

---

## 6. GPIO Wiring Reference

### Overview

| Relay Module | Type | Channels | Controls |
|---|---|---|---|
| Module 1 | 4-ch SRD-05VDC-SL-C | BCM 2, 3, 4, 5 | Main door solenoids L1–L4 |
| Module 2 | 4-ch SRD-05VDC-SL-C | BCM 6, 7, 8, 9 | Bottom door solenoids L1–L4 |
| Module 3 | 4-ch SRD-05VDC-SL-C | BCM 10, 11, 12, 13 | Actuators L1 ext/ret, L2 ext/ret |
| Module 4 | 4× 1-ch SRD-12VDC-SL-C | BCM 14, 15, 16, 17 | Actuators L3 ext/ret, L4 ext/ret |

> All modules are **active-LOW** (signal LOW = relay ON, signal HIGH = relay OFF).  
> Set `RELAY_ACTIVE_LEVEL=active_low` in `.env`.

### Full Pin Table

| BCM Pin | GPIO Header | Relay Module | Function |
|---|---|---|---|
| BCM 2 | Pin 3 | Module 1, CH1 | Locker 1 — Main door solenoid |
| BCM 3 | Pin 5 | Module 1, CH2 | Locker 2 — Main door solenoid |
| BCM 4 | Pin 7 | Module 1, CH3 | Locker 3 — Main door solenoid |
| BCM 5 | Pin 29 | Module 1, CH4 | Locker 4 — Main door solenoid |
| BCM 6 | Pin 31 | Module 2, CH1 | Locker 1 — Bottom door solenoid |
| BCM 7 | Pin 26 | Module 2, CH2 | Locker 2 — Bottom door solenoid |
| BCM 8 | Pin 24 | Module 2, CH3 | Locker 3 — Bottom door solenoid |
| BCM 9 | Pin 21 | Module 2, CH4 | Locker 4 — Bottom door solenoid |
| BCM 10 | Pin 19 | Module 3, CH1 | Locker 1 — Actuator EXTEND |
| BCM 11 | Pin 23 | Module 3, CH2 | Locker 1 — Actuator RETRACT |
| BCM 12 | Pin 32 | Module 3, CH3 | Locker 2 — Actuator EXTEND |
| BCM 13 | Pin 33 | Module 3, CH4 | Locker 2 — Actuator RETRACT |
| BCM 14 | Pin 8 | Module 4, Relay 1 | Locker 3 — Actuator EXTEND |
| BCM 15 | Pin 22 | Module 4, Relay 2 | Locker 3 — Actuator RETRACT |
| BCM 16 | Pin 36 | Module 4, Relay 3 | Locker 4 — Actuator EXTEND |
| BCM 17 | Pin 11 | Module 4, Relay 4 | Locker 4 — Actuator RETRACT |

### Actuator Wiring

Each actuator is wired to **two relay outputs**:

```
Extend relay COM  → Actuator (+)   |   12V supply → Extend relay NO
Retract relay COM → Actuator (–)   |   12V supply → Retract relay NO
Common GND        → Actuator GND
```

Extend relay ON + Retract relay OFF → actuator pushes out  
Extend relay OFF + Retract relay ON → actuator pulls back  
Both OFF → actuator holds position

### Solenoid Wiring

```
Relay COM → Solenoid (+)
Relay NO  → 12V supply
Solenoid (–) → Common GND
```

Relay ON (signal LOW) → solenoid energised → door unlocked  
Relay OFF (signal HIGH) → solenoid de-energised → door locked

---

## 7. Camera Wiring & Identification

### Setup

All 5 cameras are USB. Connect via USB extension cables to the Pi's USB 3.0 ports (blue), using a powered USB hub if needed.

Each USB camera registers **two V4L2 device nodes**. Only the first (lower-numbered) node captures video.

### Expected Device Map

Run after connecting all cameras:

```bash
v4l2-ctl --list-devices
```

Expected output:

```
USB Camera (usb-xhci-hcd.1-1.1):
    /dev/video0    ← use this  (Locker 1)
    /dev/video1    ← metadata, ignore

USB Camera (usb-xhci-hcd.1-1.2):
    /dev/video2    ← use this  (Locker 2)
    /dev/video3

USB Camera (usb-xhci-hcd.1-1.3):
    /dev/video4    ← use this  (Locker 3)
    /dev/video5

USB Camera (usb-xhci-hcd.1-1.3):
    /dev/video7    ← use this  (Locker 4)
    /dev/video8

(A fifth USB camera used to appear here as the face cam. It was removed on
2026-09-03 — face verification moved to the user's phone.)
```

> Device nodes can shift after reboot or replug. Always verify with `v4l2-ctl --list-devices` and update `USB_DEVICE_MAP` in `hardware/camera_manager.py` if they change.

### Identify Which Camera is Which Locker

Test each device node, open the saved image, and physically confirm which locker it shows:

```bash
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video0  -frames:v 1 /tmp/cam0.jpg  -y
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video2  -frames:v 1 /tmp/cam2.jpg  -y
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video4  -frames:v 1 /tmp/cam4.jpg  -y
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video7  -frames:v 1 /tmp/cam7.jpg  -y
ffmpeg -f v4l2 -input_format mjpeg -video_size  640x480 -i /dev/video10 -frames:v 1 /tmp/cam10.jpg -y
```

Open images on the Pi:
```bash
eog /tmp/cam0.jpg   # or: xdg-open /tmp/cam0.jpg
```

Once confirmed, update `USB_DEVICE_MAP` in `hardware/camera_manager.py`:

```python
USB_DEVICE_MAP: dict[int, str] = {
    0: _BY_PATH.format("platform-xhci-hcd.0-usb-0:1.2:1.0"),  # Locker 1
    1: _BY_PATH.format("platform-xhci-hcd.0-usb-0:1.3:1.0"),  # Locker 2
    2: _BY_PATH.format("platform-xhci-hcd.0-usb-0:2:1.0"),    # Locker 3
    3: _BY_PATH.format("platform-xhci-hcd.1-usb-0:2:1.0"),    # Locker 4
    # Lockers 1 & 2 re-confirmed 2026-09-03 (later the same day) after
    # removing the face camera shifted their ports off xhci-hcd.1 onto
    # xhci-hcd.0 — see camera_manager.py's module docstring.
}
```

> **Do not go back to bare `/dev/videoN` here.** Those indices are assigned in
> enumeration order and genuinely do move between reboots and replugs — on
> 2026-09-03 this silently mapped three lockers to each other's cameras, so item
> verification was comparing photos of the wrong locker and reporting success.
> The `/dev/v4l/by-path/` symlinks are tied to the physical USB port, so a
> camera keeps its identity as long as it stays plugged into the same socket.
>
> **There is no index 4.** The face camera was removed on 2026-09-03 when face
> verification moved to the user's phone — see the design mandate §2.13.

### Check Supported Formats

```bash
v4l2-ctl -d /dev/video0 --list-formats-ext
```

Look for `MJPG` at 1280×720 or higher. If only YUYV is listed, the camera will use the fallback 640×480 mode (slower but functional).

---

## 8. Environment Variables

```bash
nano ~/engirent/server/kiosk/.env
```

| Variable | Example / Default | Description |
|---|---|---|
| `KIOSK_ID` | `kiosk-1` | Unique ID per physical device |
| `SERVER_URL` | `https://engirent-api.onrender.com` | Node.js backend Socket.io URL |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ0…` | Service role key (from Supabase → API) |
| `SUPABASE_STORAGE_BUCKET` | `media` | Storage bucket name |
| `ML_SERVICE_URL` | `https://engirent-ml.onrender.com` | Face verification ML service |
| `UI_PORT` | `8080` | Port for the local Flask kiosk UI |
| `AP_SSID` | `EngiRent-Kiosk-Setup` | WiFi AP name for provisioning |
| `AP_PASSWORD` | `engirent2026` | WiFi AP password |
| `AP_IP` | `192.168.4.1` | AP gateway IP |
| `RELAY_ACTIVE_LEVEL` | `active_low` | `active_low` for SRD modules, `active_high` for SSRs |
| `MOCK_GPIO` | `False` | `True` = skip real GPIO (safe for non-Pi testing) |
| `MOCK_CAMERA` | `False` | `True` = return grey placeholder images |

---

## 9. Locker Timing Config

`kiosk_config.json` controls how long doors stay open and how long actuators travel. All values are in **seconds**.

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
    "2": { "...same keys..." },
    "3": { "...same keys..." },
    "4": { "...same keys..." }
  },
  "_note": "The old 'face_recognition' block was removed on 2026-09-03. The kiosk no longer captures or verifies faces; the phone does, and the ML comparison runs server-side in Node. See the design mandate 2.13."
}
```

Timings can also be pushed remotely from the admin panel (Kiosk → Configure Timings). The Pi saves them locally on receipt.

> **The Pi's `config.py` is always the source of truth for GPIO pin wiring.** The server never overrides pin assignments.

---

## 10. WiFi Provisioning

On first boot (or if WiFi is not configured), the kiosk enters AP mode automatically:

1. Pi creates a hotspot: **`EngiRent-Kiosk-Setup`** (password set in `.env`)
2. Connect your phone or laptop to that network
3. Open **http://192.168.4.1** in a browser
4. Select your home/office WiFi, enter the password, tap **Connect**
5. Pi reboots and connects — provisioning is complete

If the portal is unreachable, configure WiFi directly:
```bash
sudo nmtui
```

---

## 11. Verify & Test

### Check Service Status

```bash
sudo systemctl status engirent-kiosk.service
sudo journalctl -u engirent-kiosk.service -f
```

Expected startup log:
```
[INFO]  kiosk.gpio    – GPIO chip detected: gpiochip0
[INFO]  kiosk.camera  – Locker camera locker=1 device=…usb-0:1.2:1.0 ✓
[INFO]  kiosk.camera  – Locker camera locker=2 device=…usb-0:1.3:1.0 ✓
[INFO]  kiosk.camera  – Locker camera locker=3 device=…usb-0:2:1.0   ✓
[INFO]  kiosk.camera  – Locker camera locker=4 device=…usb-0:2:1.0   ✓
[INFO]  kiosk.socket  – Connected to server ✓
[INFO]  kiosk.socket  – 🟢 [PI-ONLINE] Kiosk registered
```

### Run Diagnostics

```bash
cd ~/engirent/server/kiosk
source venv/bin/activate
python3 diagnose.py
```

### Test in Mock Mode (No Hardware)

```bash
source venv/bin/activate
MOCK_GPIO=True MOCK_CAMERA=True python3 main.py
```

Open http://localhost:8080 to view the local UI.

### Manual GPIO Test (Single Relay)

```bash
python3 -c "
import lgpio, time
h = lgpio.gpiochip_open(0)        # use 4 on older Pi 5 kernels
lgpio.gpio_claim_output(h, 2)
lgpio.gpio_write(h, 2, 0)         # LOW = relay ON (active-low)
print('Relay ON — locker 1 main door')
time.sleep(3)
lgpio.gpio_write(h, 2, 1)         # HIGH = relay OFF
lgpio.gpiochip_close(h)
print('Relay OFF')
"
```

### Update Code on Pi

```bash
cd ~/engirent
git pull
sudo systemctl restart engirent-kiosk.service
sudo journalctl -u engirent-kiosk.service -f
```

---

## 12. Troubleshooting

### Service Crashes on Start (exit code 1)

**Most likely cause:** `camera_auto_detect=1` is still in `/boot/firmware/config.txt`, causing the kernel to claim GPIO4 before the kiosk can use it.

```bash
sudo journalctl -u engirent-kiosk.service -n 50
# Look for: lgpio.error: 'GPIO busy'

# Fix:
sudo nano /boot/firmware/config.txt
# Set: camera_auto_detect=0
sudo reboot
```

---

### `lgpio.error: GPIO busy` on a Specific Pin

Several BCM pins used for relays are shared with kernel hardware interfaces that are enabled by default. All must be disabled:

| BCM Pins | Interface | Relay function |
|---|---|---|
| BCM 2, 3 | I2C (SDA/SCL) | Lockers 1 & 2 — main doors |
| BCM 8, 9, 10, 11 | SPI | Bottom doors & actuators |
| BCM 14, 15 | UART (TX/RX) | Locker 3 — actuators |

**Fix — disable all three:**
```bash
sudo raspi-config nonint do_i2c       1   # 1 = disable
sudo raspi-config nonint do_spi       1
sudo raspi-config nonint do_serial_hw 0   # 0 = disable hardware serial
sudo reboot
```

Other causes:

| Cause | Fix |
|---|---|
| `camera_auto_detect=1` in boot config | Set `camera_auto_detect=0`, reboot |
| Wrong GPIO chip number | `GPIO_CHIP` is auto-detected in `config.py` — check log for `gpiochip0` vs `gpiochip4` |
| Another process holding the pin | `sudo lsof /dev/gpiomem*` — find and kill the process |

---

### Relay Not Activating

1. Confirm `RELAY_ACTIVE_LEVEL=active_low` in `.env` (SRD-05VDC and SRD-12VDC are active-LOW)
2. Verify the BCM pin matches the relay terminal (see [Section 6](#6-gpio-wiring-reference))
3. Test the relay directly with the manual GPIO test above
4. Check power supply — solenoids draw ~500 mA each; a weak supply causes silent failures

---

### Camera Not Opening

```bash
# Check device nodes are present
v4l2-ctl --list-devices

# Test GStreamer pipeline directly
gst-launch-1.0 v4l2src device=/dev/video0 ! \
  image/jpeg,width=1280,height=720,framerate=30/1 ! \
  jpegdec ! videoconvert ! autovideosink

# If device node changed after replug:
# Update USB_DEVICE_MAP in hardware/camera_manager.py
```

---

### Admin Panel Commands Return OK But Relay Doesn't Fire

1. **GPIO busy** — see above; fix `camera_auto_detect=0`
2. **Server pushed stale pin config** — already fixed in `socket_client.py` (pin overrides from server are ignored)
3. **Kiosk not actually registered** — check logs for the `🟢 [PI-ONLINE] Kiosk registered` line; if missing, the Pi's socket connection dropped

---

### Actuator Runs One Direction Only

- Swap the motor wire polarity on the relay output terminals
- Or swap the `actuator_extend_pin` and `actuator_retract_pin` values in `config.py`

---

### WiFi Provisioning Portal Unreachable

```bash
nmcli dev wifi          # check WiFi state
sudo systemctl status NetworkManager
# If still failing:
sudo nmtui              # manual config
```

---

### `lgpio` Not Found in Venv

The venv must be created with `--system-site-packages`:
```bash
rm -rf venv
python3 -m venv venv --system-site-packages
source venv/bin/activate
pip install -r requirements.txt
```

---

### Chromium Opens But Shows Blank Screen

```bash
# Check Flask UI is running
curl http://localhost:8080
sudo systemctl status engirent-kiosk.service
# Flask starts on port 8080 — Chromium waits for it in the autostart entry
```

---

**Last Updated:** 2026-04-22
**Version:** 2.0
**Maintainer:** EngiRent Team
