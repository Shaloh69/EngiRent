# EngiRent Kiosk – Raspberry Pi 5 Setup Guide

## Hardware Requirements

| Component | Qty | Notes |
|---|---|---|
| Raspberry Pi 5 (4 GB+) | 1 | RP1 GPIO chip |
| L298N H-bridge motor driver | 4 | One per locker (trapdoor actuator) |
| 12V linear actuator | 4 | One per locker trapdoor |
| 5V relay module (4-ch) | 3 | 12 channels total for solenoids |
| 12V solenoid lock | 12 | 3 per locker (main, trapdoor, bottom) |
| 12V 5A power supply | 1 | Solenoids + actuators |
| 5V 3A USB-C power supply | 1 | Pi |
| Raspberry Pi Camera Module 3 | 2 | CSI0 + CSI1 (lockers 1, 2) |
| USB webcam | 3 | Lockers 3, 4 + face recognition |
| HDMI monitor | 1 | 7–10" for kiosk display |

---

## 1. OS Setup

Flash **Raspberry Pi OS Bookworm (64-bit, full desktop)** using Raspberry Pi Imager.

Before booting, in Imager settings:
- Set hostname: `engirent-kiosk`
- Enable SSH
- Set username: `pi` / password of your choice
- Do **not** preconfigure WiFi (provisioning handles it)

---

## 2. System Dependencies

```bash
sudo apt update && sudo apt upgrade -y

# GPIO (RP1 chip)
sudo apt install -y python3-lgpio python3-gpiozero

# Camera
sudo apt install -y python3-picamera2 python3-opencv

# System utils
sudo apt install -y git python3-pip python3-venv chromium-browser unclutter

# NetworkManager (already installed on Bookworm desktop)
sudo systemctl enable NetworkManager
```

Enable camera interfaces:
```bash
sudo raspi-config
# Interface Options → Camera → Enable (both)
# Interface Options → I2C  → Enable
```

---

## 3. Clone Repository

```bash
cd ~
git clone https://github.com/Shaloh69/EngiRent.git engirent
cd engirent/server/kiosk
```

---

## 4. Python Virtual Environment

```bash
python3 -m venv venv --system-site-packages   # inherit system lgpio/picamera2/cv2
source venv/bin/activate
pip install -r requirements.txt
```

> `--system-site-packages` is required because `lgpio` and `picamera2` are installed
> system-wide via apt and cannot be pip-installed cleanly on Pi 5.

---

## 5. Environment Configuration

```bash
cp .env.example .env
nano .env
```

Fill in:

| Variable | Value |
|---|---|
| `KIOSK_ID` | `kiosk-1` (unique per device) |
| `SERVER_URL` | `https://engirent-api.onrender.com` |
| `SUPABASE_URL` | From Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase API keys |
| `SUPABASE_STORAGE_BUCKET` | `media` |
| `ML_SERVICE_URL` | `https://engirent-ml.onrender.com` |
| `UI_PORT` | `8080` |
| `RELAY_ACTIVE_LEVEL` | `0` (active-LOW relay) or `1` (active-HIGH) |
| `MOCK_GPIO` | `false` (set `true` for dev without hardware) |
| `MOCK_CAMERA` | `false` |

AP provisioning defaults (can leave as-is):

| Variable | Default |
|---|---|
| `AP_SSID` | `EngiRent-Kiosk-Setup` |
| `AP_PASSWORD` | `engirent123` |
| `AP_IP` | `192.168.4.1` |

---

## 6. GPIO Wiring

### Solenoid Relay Connections

Each relay module is driven by a Pi GPIO pin (active-LOW by default):

| Locker | Door | GPIO Pin |
|---|---|---|
| 1 | Main door | 17 |
| 1 | Trapdoor | 18 |
| 1 | Bottom door | 27 |
| 2 | Main door | 22 |
| 2 | Trapdoor | 23 |
| 2 | Bottom door | 24 |
| 3 | Main door | 25 |
| 3 | Trapdoor | 8 |
| 3 | Bottom door | 7 |
| 4 | Main door | 1 |
| 4 | Trapdoor | 0 |
| 4 | Bottom door | 5 |

### L298N Actuator Connections (per locker)

| Locker | PWM Pin (speed) | DIR Pin (direction) |
|---|---|---|
| 1 | GPIO 12 | GPIO 16 |
| 2 | GPIO 20 | GPIO 21 |
| 3 | GPIO 19 | GPIO 26 |
| 4 | GPIO 13 | GPIO 6 |

L298N wiring per module:
- `IN1` → DIR pin, `IN2` → GND (via 10 kΩ pull-down)
- `ENA` → PWM pin
- `OUT1/OUT2` → Actuator terminals
- `12V` → 12V supply, `GND` → common ground with Pi

### Camera Connections

| Camera | Interface | Index |
|---|---|---|
| Locker 1 | CSI0 | – |
| Locker 2 | CSI1 | – |
| Locker 3 | USB `/dev/video4` | 0 |
| Locker 4 | USB `/dev/video5` | 1 |
| Face recognition | USB `/dev/video6` | 2 |

---

## 7. First-Boot WiFi Provisioning

On first boot (no WiFi configured):

1. The kiosk automatically starts a hotspot named **`EngiRent-Kiosk-Setup`**
2. Connect your phone or laptop to that network (password: `engirent123`)
3. Open **http://192.168.4.1** in a browser
4. Select your WiFi network, enter the password, tap **Connect & Reboot**
5. The Pi reboots and connects to your WiFi — provisioning is complete

---

## 8. Install Systemd Services

```bash
# Kiosk controller service
sudo cp systemd/engirent-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable engirent-kiosk.service
sudo systemctl start  engirent-kiosk.service

# Chromium kiosk browser (auto-launch on desktop)
sudo cp systemd/engirent-kiosk-browser.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable engirent-kiosk-browser.service
sudo systemctl start  engirent-kiosk-browser.service
```

Check status:
```bash
sudo systemctl status engirent-kiosk.service
journalctl -u engirent-kiosk.service -f   # live logs
```

---

## 9. Auto-Login to Desktop (for Chromium)

```bash
sudo raspi-config
# System Options → Boot / Auto Login → Desktop Autologin
```

---

## 10. Hide Mouse Cursor

```bash
sudo nano /etc/xdg/lxsession/LXDE-pi/autostart
```
Add at the end:
```
@unclutter -idle 0 -root
```

---

## 11. Screen Blanking / Power Save Off

```bash
sudo nano /etc/xdg/lxsession/LXDE-pi/autostart
```
Add:
```
@xset s off
@xset -dpms
@xset s noblank
```

---

## 12. Testing Without Hardware

```bash
source venv/bin/activate
MOCK_GPIO=true MOCK_CAMERA=true python main.py
```

Open http://localhost:8080 to see the HDMI UI.

---

## 13. Updating Locker Timing Config

Timing can be updated live from the EngiRent admin panel (Kiosk page → Configure Timings).

To manually edit:
```bash
nano /home/pi/engirent/server/kiosk/kiosk_config.json
sudo systemctl restart engirent-kiosk.service
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `lgpio` not found | `sudo apt install python3-lgpio` |
| Camera not detected | `vcgencmd get_camera`, re-enable in raspi-config |
| Relay not triggering | Check `RELAY_ACTIVE_LEVEL` in `.env` (0 = active-LOW) |
| Actuator runs one way only | Swap OUT1/OUT2 on L298N, or flip DIR_PIN logic in `config.py` |
| WiFi provisioning portal unreachable | Ensure Pi is not already connected to WiFi, check `nmcli dev wifi` |
| Kiosk browser black screen | `systemctl status engirent-kiosk.service` — ensure Flask UI started on port 8080 |
