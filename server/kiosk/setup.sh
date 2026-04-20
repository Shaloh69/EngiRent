#!/bin/bash
# EngiRent Kiosk – One-shot setup script for Raspberry Pi OS Trixie
# Run once after cloning the repo:  bash setup.sh

set -e
KIOSK_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"

echo "======================================================"
echo "  EngiRent Kiosk Setup"
echo "  Directory : $KIOSK_DIR"
echo "  User      : $SERVICE_USER"
echo "======================================================"

# ── 1. System packages ─────────────────────────────────────────────────────────
echo "[1/7] Installing system packages…"
apt-get update -qq
apt-get install -y -qq \
    python3-lgpio python3-gpiozero \
    python3-picamera2 python3-opencv \
    git python3-pip python3-venv \
    chromium unclutter \
    v4l-utils ffmpeg \
    network-manager

# ── 2. Python venv ─────────────────────────────────────────────────────────────
echo "[2/7] Setting up Python virtual environment…"
if [ ! -d "$KIOSK_DIR/venv" ]; then
    sudo -u "$SERVICE_USER" python3 -m venv "$KIOSK_DIR/venv" --system-site-packages
fi
sudo -u "$SERVICE_USER" "$KIOSK_DIR/venv/bin/pip" install --quiet -r "$KIOSK_DIR/requirements.txt"

# ── 3. .env file ───────────────────────────────────────────────────────────────
echo "[3/7] Checking .env…"
if [ ! -f "$KIOSK_DIR/.env" ]; then
    cp "$KIOSK_DIR/.env.example" "$KIOSK_DIR/.env"
    echo "  ⚠  .env created from .env.example — edit it before starting:"
    echo "     nano $KIOSK_DIR/.env"
else
    echo "  .env already exists, skipping."
fi

# ── 4. Log file ────────────────────────────────────────────────────────────────
echo "[4/7] Creating log file…"
touch /var/log/engirent-kiosk.log
chown "$SERVICE_USER":"$SERVICE_USER" /var/log/engirent-kiosk.log

# ── 5. Systemd services ────────────────────────────────────────────────────────
echo "[5/7] Installing systemd services…"

# Patch WorkingDirectory and User to match actual install path and user
sed \
    -e "s|/home/pi/engirent/server/kiosk|$KIOSK_DIR|g" \
    -e "s|User=pi|User=$SERVICE_USER|g" \
    "$KIOSK_DIR/systemd/engirent-kiosk.service" \
    > /etc/systemd/system/engirent-kiosk.service

sed \
    -e "s|User=pi|User=$SERVICE_USER|g" \
    "$KIOSK_DIR/systemd/engirent-kiosk-browser.service" \
    > /etc/systemd/system/engirent-kiosk-browser.service

systemctl daemon-reload
systemctl enable engirent-kiosk.service
systemctl enable engirent-kiosk-browser.service
echo "  Services enabled (will start on next boot)."

# ── 6. Desktop auto-login ──────────────────────────────────────────────────────
echo "[6/7] Configuring desktop auto-login…"
raspi-config nonint do_boot_behaviour B4   # Desktop autologin

# ── 7. Disable screen blanking ─────────────────────────────────────────────────
echo "[7/7] Disabling screen blanking…"
AUTOSTART_DIR="/home/$SERVICE_USER/.config/lxsession/LXDE-pi"
AUTOSTART_FILE="$AUTOSTART_DIR/autostart"
mkdir -p "$AUTOSTART_DIR"

for LINE in \
    "@xset s off" \
    "@xset -dpms" \
    "@xset s noblank" \
    "@unclutter -idle 0 -root"; do
    grep -qxF "$LINE" "$AUTOSTART_FILE" 2>/dev/null || echo "$LINE" >> "$AUTOSTART_FILE"
done

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit your credentials:  nano $KIOSK_DIR/.env"
echo "  2. Start the kiosk now:    sudo systemctl start engirent-kiosk.service"
echo "  3. Check logs:             journalctl -u engirent-kiosk.service -f"
echo "  4. Reboot to test full auto-start: sudo reboot"
echo "======================================================"
