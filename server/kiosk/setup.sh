#!/bin/bash
# EngiRent Kiosk – Full auto-setup for Raspberry Pi OS (Bookworm / Trixie)
# Usage:  sudo bash setup.sh
#
# Safe to run multiple times — all steps are idempotent.

set -euo pipefail

# ── Resolve paths & user ───────────────────────────────────────────────────────
KIOSK_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
USER_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"

# Boot config location differs between Pi OS versions
if   [ -f /boot/firmware/config.txt ]; then BOOT_CFG=/boot/firmware/config.txt
elif [ -f /boot/config.txt ];          then BOOT_CFG=/boot/config.txt
else                                        BOOT_CFG=""; fi

# ── Must run as root ───────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Run with sudo:  sudo bash setup.sh"
    exit 1
fi

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       EngiRent Kiosk – Automated Setup           ║"
echo "╚══════════════════════════════════════════════════╝"
echo "  Directory : $KIOSK_DIR"
echo "  User      : $SERVICE_USER  (home: $USER_HOME)"
echo "  Boot cfg  : ${BOOT_CFG:-not found}"
echo ""

STEP=0
step() { STEP=$((STEP+1)); echo ""; echo "──────────────────────────────────────────────────"; echo "[$STEP] $*"; echo "──────────────────────────────────────────────────"; }

# ══════════════════════════════════════════════════════════════════════════════
# 1. System packages
# ══════════════════════════════════════════════════════════════════════════════
step "Installing system packages"
apt-get update -qq
apt-get install -y -qq \
    python3-lgpio \
    python3-gpiozero \
    python3-opencv \
    opencv-data \
    python3-pip \
    python3-venv \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-libav \
    v4l-utils \
    ffmpeg \
    chromium \
    unclutter \
    network-manager \
    git \
    curl
echo "  ✓ System packages installed"

# Enable NetworkManager if not running
systemctl enable NetworkManager 2>/dev/null || true
systemctl start  NetworkManager 2>/dev/null || true

# ══════════════════════════════════════════════════════════════════════════════
# 2. CRITICAL — Disable camera_auto_detect (kernel claims GPIO4 otherwise)
# ══════════════════════════════════════════════════════════════════════════════
step "Patching boot config: camera_auto_detect=0"
if [ -z "$BOOT_CFG" ]; then
    echo "  ⚠  Boot config not found — patch manually:"
    echo "     sudo nano /boot/firmware/config.txt"
    echo "     Set: camera_auto_detect=0"
else
    if grep -q "^camera_auto_detect=1" "$BOOT_CFG"; then
        sed -i 's/^camera_auto_detect=1/camera_auto_detect=0/' "$BOOT_CFG"
        echo "  ✓ camera_auto_detect: 1 → 0  ($BOOT_CFG)"
    elif grep -q "^camera_auto_detect=0" "$BOOT_CFG"; then
        echo "  ✓ Already camera_auto_detect=0 — no change"
    elif grep -q "^#*camera_auto_detect" "$BOOT_CFG"; then
        sed -i 's/^#*camera_auto_detect.*/camera_auto_detect=0/' "$BOOT_CFG"
        echo "  ✓ camera_auto_detect uncommented and set to 0  ($BOOT_CFG)"
    else
        echo "camera_auto_detect=0" >> "$BOOT_CFG"
        echo "  ✓ camera_auto_detect=0 appended to $BOOT_CFG"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 3. Python virtual environment
# ══════════════════════════════════════════════════════════════════════════════
step "Setting up Python virtual environment"
if [ ! -d "$KIOSK_DIR/venv" ]; then
    # --system-site-packages: inherit system lgpio and opencv
    sudo -u "$SERVICE_USER" python3 -m venv "$KIOSK_DIR/venv" --system-site-packages
    echo "  ✓ venv created"
else
    echo "  venv already exists — skipping creation"
fi

echo "  Upgrading pip…"
sudo -u "$SERVICE_USER" "$KIOSK_DIR/venv/bin/pip" install --upgrade pip

echo "  Installing Python dependencies from requirements.txt…"
sudo -u "$SERVICE_USER" "$KIOSK_DIR/venv/bin/pip" install -r "$KIOSK_DIR/requirements.txt"
echo "  ✓ Python dependencies installed"

# Verify all critical imports — failures here mean the kiosk will crash on start
echo ""
echo "  Verifying critical imports…"
_check_import() {
    local MODULE="$1" HINT="$2"
    if sudo -u "$SERVICE_USER" "$KIOSK_DIR/venv/bin/python" -c "import $MODULE" 2>/dev/null; then
        echo "  ✓ $MODULE"
    else
        echo "  ✗ $MODULE — $HINT"
        IMPORT_ERRORS=$((IMPORT_ERRORS + 1))
    fi
}
IMPORT_ERRORS=0
_check_import "cv2"           "run: sudo apt install -y python3-opencv"
_check_import "lgpio"         "run: sudo apt install -y python3-lgpio"
_check_import "flask"         "run: pip install flask"
_check_import "flask_socketio" "run: pip install flask-socketio"
_check_import "socketio"      "run: pip install python-socketio[asyncio_client]"
_check_import "supabase"      "run: pip install supabase"
_check_import "PIL"           "run: pip install pillow"
_check_import "dotenv"        "run: pip install python-dotenv"

if [ "$IMPORT_ERRORS" -gt 0 ]; then
    echo ""
    echo "  ⚠  $IMPORT_ERRORS import(s) failed — fix them before starting the kiosk"
else
    echo "  ✓ All imports OK"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 4. Environment file (.env)
# ══════════════════════════════════════════════════════════════════════════════
step "Configuring .env"
if [ ! -f "$KIOSK_DIR/.env" ]; then
    cp "$KIOSK_DIR/.env.example" "$KIOSK_DIR/.env"
    chown "$SERVICE_USER:$SERVICE_USER" "$KIOSK_DIR/.env"
    echo "  .env created from template"
else
    echo "  .env already exists"
fi
chown "$SERVICE_USER:$SERVICE_USER" "$KIOSK_DIR/.env"

# Helper: prompt for a .env value only if it is blank or still a placeholder
_prompt_env() {
    local KEY="$1" LABEL="$2" CURRENT
    CURRENT="$(grep -E "^${KEY}=" "$KIOSK_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
    if [ -z "$CURRENT" ] || echo "$CURRENT" | grep -qiE "your-|PASTE_|example\.com"; then
        echo ""
        printf "  ┌─ %s\n" "$KEY"
        read -rp "  │  $LABEL: " NEW_VAL
        if [ -n "$NEW_VAL" ]; then
            if grep -q "^${KEY}=" "$KIOSK_DIR/.env"; then
                sed -i "s|^${KEY}=.*|${KEY}=${NEW_VAL}|" "$KIOSK_DIR/.env"
            else
                echo "${KEY}=${NEW_VAL}" >> "$KIOSK_DIR/.env"
            fi
            echo "  └─ ✓ Saved"
        else
            echo "  └─ ⚠  Skipped — set manually:  nano $KIOSK_DIR/.env"
        fi
    else
        echo "  ✓ $KEY already configured"
    fi
}

_prompt_env "KIOSK_ID"                  "Kiosk ID (e.g. kiosk-1)"
_prompt_env "SERVER_URL"                "Backend URL (e.g. https://engirent-api.onrender.com)"
_prompt_env "SUPABASE_URL"              "Supabase project URL (https://xxx.supabase.co)"
_prompt_env "SUPABASE_SERVICE_ROLE_KEY" "Supabase service role key (from Supabase → API settings)"
_prompt_env "ML_SERVICE_URL"            "ML service URL (e.g. https://engirent-ml.onrender.com)"

# ══════════════════════════════════════════════════════════════════════════════
# 5. Default kiosk_config.json
# ══════════════════════════════════════════════════════════════════════════════
step "Checking kiosk_config.json"
if [ ! -f "$KIOSK_DIR/kiosk_config.json" ]; then
    cat > "$KIOSK_DIR/kiosk_config.json" <<'JSON'
{
  "lockers": {
    "1": {
      "main_door_open_seconds": 15,
      "bottom_door_open_seconds": 15,
      "actuator_extend_seconds": 5,
      "actuator_retract_seconds": 5,
      "actuator_speed_percent": 100
    },
    "2": {
      "main_door_open_seconds": 15,
      "bottom_door_open_seconds": 15,
      "actuator_extend_seconds": 5,
      "actuator_retract_seconds": 5,
      "actuator_speed_percent": 100
    },
    "3": {
      "main_door_open_seconds": 15,
      "bottom_door_open_seconds": 15,
      "actuator_extend_seconds": 5,
      "actuator_retract_seconds": 5,
      "actuator_speed_percent": 100
    },
    "4": {
      "main_door_open_seconds": 15,
      "bottom_door_open_seconds": 15,
      "actuator_extend_seconds": 5,
      "actuator_retract_seconds": 5,
      "actuator_speed_percent": 100
    }
  },
  "face_recognition": {
    "confidence_threshold": 0.6,
    "capture_attempts": 3,
    "capture_timeout_seconds": 30
  }
}
JSON
    chown "$SERVICE_USER:$SERVICE_USER" "$KIOSK_DIR/kiosk_config.json"
    echo "  ✓ Default kiosk_config.json created"
else
    echo "  ✓ kiosk_config.json already exists — keeping"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 6. Runtime directories & log file
# ══════════════════════════════════════════════════════════════════════════════
step "Creating runtime directories"
mkdir -p "$KIOSK_DIR/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$KIOSK_DIR/data"
touch /var/log/engirent-kiosk.log
chown "$SERVICE_USER:$SERVICE_USER" /var/log/engirent-kiosk.log
echo "  ✓ $KIOSK_DIR/data/ and /var/log/engirent-kiosk.log ready"

# ══════════════════════════════════════════════════════════════════════════════
# 7. Systemd service
# ══════════════════════════════════════════════════════════════════════════════
step "Installing systemd service"
sed \
    -e "s|/home/pi/engirent/server/kiosk|$KIOSK_DIR|g" \
    -e "s|User=pi|User=$SERVICE_USER|g" \
    "$KIOSK_DIR/systemd/engirent-kiosk.service" \
    > /etc/systemd/system/engirent-kiosk.service

systemctl daemon-reload
systemctl enable engirent-kiosk.service
echo "  ✓ engirent-kiosk.service installed and enabled"

# ══════════════════════════════════════════════════════════════════════════════
# 8. Chromium kiosk browser autostart
#    Waits for the Flask UI to be ready before opening the browser.
# ══════════════════════════════════════════════════════════════════════════════
step "Installing Chromium autostart"
AUTOSTART_DIR="$USER_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_DIR/engirent-browser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=EngiRent Kiosk Browser
Exec=bash -c 'until curl -sf http://localhost:8080 >/dev/null 2>&1; do sleep 1; done && /usr/bin/chromium --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --disable-pinch --overscroll-history-navigation=0 --ozone-platform-hint=auto --password-store=basic --kiosk --start-fullscreen --start-maximized --window-size=1920,1080 --force-device-scale-factor=1 --app=http://localhost:8080 --check-for-update-interval=31536000'
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

chown -R "$SERVICE_USER:$SERVICE_USER" "$AUTOSTART_DIR"
echo "  ✓ Chromium autostart installed at $AUTOSTART_DIR/engirent-browser.desktop"

# ══════════════════════════════════════════════════════════════════════════════
# 9. Desktop auto-login + disable screen blanking
# ══════════════════════════════════════════════════════════════════════════════
step "Configuring auto-login and screen blanking"

if command -v raspi-config &>/dev/null; then
    raspi-config nonint do_boot_behaviour B4 2>/dev/null \
        && echo "  ✓ Desktop auto-login enabled" \
        || echo "  ⚠  raspi-config auto-login failed — enable via: sudo raspi-config → System Options → Boot"
else
    echo "  ⚠  raspi-config not found — enable auto-login manually"
fi

# Disable screen blanking in LXDE session
LXDE_DIR="$USER_HOME/.config/lxsession/LXDE-pi"
mkdir -p "$LXDE_DIR"
for LINE in "@xset s off" "@xset -dpms" "@xset s noblank" "@unclutter -idle 0 -root"; do
    grep -qxF "$LINE" "$LXDE_DIR/autostart" 2>/dev/null || echo "$LINE" >> "$LXDE_DIR/autostart"
done
chown -R "$SERVICE_USER:$SERVICE_USER" "$LXDE_DIR"
echo "  ✓ Screen blanking disabled"

# ══════════════════════════════════════════════════════════════════════════════
# 10. Camera device check
# ══════════════════════════════════════════════════════════════════════════════
step "Checking USB cameras"
echo ""
if command -v v4l2-ctl &>/dev/null; then
    CAMS="$(v4l2-ctl --list-devices 2>/dev/null || true)"
    if [ -n "$CAMS" ]; then
        echo "$CAMS" | head -40
        echo ""
        CAM_COUNT="$(echo "$CAMS" | grep -c '/dev/video' || true)"
        echo "  $CAM_COUNT video device node(s) found"
    else
        echo "  ⚠  No cameras detected yet — plug in all 5 USB cameras and check with:"
        echo "     v4l2-ctl --list-devices"
    fi
else
    echo "  ⚠  v4l2-ctl not available"
fi

echo ""
echo "  Expected device map (capture nodes only — even-numbered or first listed):"
echo "    /dev/video0  → Locker 1"
echo "    /dev/video2  → Locker 2"
echo "    /dev/video4  → Locker 3"
echo "    /dev/video7  → Locker 4"
echo "    /dev/video10 → Face cam"
echo ""
echo "  If your nodes differ, update USB_DEVICE_MAP in:"
echo "    $KIOSK_DIR/hardware/camera_manager.py"
echo ""
echo "  Test a camera:"
echo "    ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video0 -frames:v 1 /tmp/cam0.jpg -y"

# ══════════════════════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              Setup Complete!                     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Warn if .env still has unfilled placeholder values
if grep -qE "your-service-role-key|PASTE_YOUR|your-" "$KIOSK_DIR/.env" 2>/dev/null; then
    echo "  ⚠  .env has unfilled values — edit before starting:"
    grep -nE "your-service-role-key|PASTE_YOUR|your-" "$KIOSK_DIR/.env" | sed 's/^/     /'
    echo ""
fi

echo "  Next steps:"
echo ""
echo "  1. Reboot to apply camera_auto_detect=0 and auto-login:"
echo "       sudo reboot"
echo ""
echo "  2. After reboot, start the kiosk and watch logs:"
echo "       sudo systemctl start engirent-kiosk.service"
echo "       sudo journalctl -u engirent-kiosk.service -f"
echo ""
echo "  3. Run hardware diagnostics:"
echo "       cd $KIOSK_DIR && source venv/bin/activate && python3 diagnose.py"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl restart engirent-kiosk.service    # after code changes"
echo "    git -C $KIOSK_DIR/../.. pull                     # pull latest code"
echo "    v4l2-ctl --list-devices                           # list cameras"
echo "    sudo journalctl -u engirent-kiosk.service -f     # live logs"
echo ""
