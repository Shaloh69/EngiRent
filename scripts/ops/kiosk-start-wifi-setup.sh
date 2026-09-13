#!/usr/bin/env bash
# kiosk-start-wifi-setup.sh — put the kiosk into Wi-Fi setup mode. Nothing else.
#
# Starts provisioning/setup_mode.py as a transient ROOT unit (the service user
# cannot run the portal — D-76). The kiosk raises the `EngiRent-Kiosk-Setup`
# hotspot; join it from a phone and open http://192.168.4.1.
#
# CONSEQUENCES, stated before anything runs:
#   * The Pi has ONE radio. The hotspot replaces its Wi-Fi connection, so
#     remote access (Tailscale and the LAN jump) is LOST until it joins a network.
#   * Choosing a network in the portal REBOOTS the Pi.
#   * If nobody chooses within 20 min, the hotspot is removed and the Pi
#     reconnects to its saved Wi-Fi on its own.
#   * If a chosen network fails, power-cycle the Pi; it rejoins saved networks.
#   * No GPIO is touched; the controller keeps running with every relay locked.
#
# Refuses unless the kiosk is idle, no locker is active, and all 8 doors report
# locked. No arguments on purpose.

set -euo pipefail
cd "$(dirname "$0")/../.."

PI_USER=engirent; TS_HOST=engirent-kiosk; JUMP=transfer@desktop-gklhcri; LAN_IP=192.168.1.65
D=/home/engirent/Desktop/EngiRent/server/kiosk
SSH_BASE=(-o ConnectTimeout=12 -o BatchMode=yes -o HostKeyAlias=engirent-kiosk -o StrictHostKeyChecking=yes)

if ssh "${SSH_BASE[@]}" "$PI_USER@$TS_HOST" true 2>/dev/null; then
  TARGET=(ssh "${SSH_BASE[@]}" "$PI_USER@$TS_HOST"); SCP_ROUTE=()
  DEST="$PI_USER@$TS_HOST"; echo "route: tailscale"
elif ssh "${SSH_BASE[@]}" -J "$JUMP" "$PI_USER@$LAN_IP" true 2>/dev/null; then
  TARGET=(ssh "${SSH_BASE[@]}" -J "$JUMP" "$PI_USER@$LAN_IP"); SCP_ROUTE=(-o "ProxyJump $JUMP")
  DEST="$PI_USER@$LAN_IP"; echo "route: LAN via $JUMP"
else
  echo "ABORT: kiosk unreachable." >&2; exit 2
fi

STATE_JSON=$("${TARGET[@]}" 'curl -s -m 5 http://localhost:8080/api/state' || true)
VERDICT=$(printf '%s' "$STATE_JSON" | python -c 'import json,sys
try:
    s = json.load(sys.stdin)
except Exception:
    print("UNREADABLE"); sys.exit()
status, active = s.get("status",""), s.get("active_locker")
doors = [v for l in (s.get("lockers") or {}).values() for v in l.values()]
if status not in ("idle","online","offline","error"): print("status=" + str(status))
elif active is not None: print("active_locker=" + str(active))
elif len(doors) != 8 or any(d != "locked" for d in doors): print("doors=" + ",".join(doors))
else: print("OK")')
echo "safety gate: $VERDICT"
[ "$VERDICT" = "OK" ] || { echo "ABORT: kiosk not idle with all doors locked." >&2; exit 3; }

# ship the entry point (new file) and confirm it compiles with the Pi's own Python
scp -q -o HostKeyAlias=engirent-kiosk -o StrictHostKeyChecking=yes "${SCP_ROUTE[@]}" \
  server/kiosk/provisioning/setup_mode.py "$DEST:$D/provisioning/setup_mode.py"
"${TARGET[@]}" "cd $D && venv/bin/python -m py_compile provisioning/setup_mode.py && echo 'setup_mode.py compiles on the Pi'"
# Captive-portal auto-open needs NetworkManager's shared-mode dnsmasq directory.
# Without it setup mode still works, but the phone won't open the page by itself.
"${TARGET[@]}" "test -d /etc/NetworkManager/dnsmasq-shared.d && echo 'captive auto-open: dnsmasq-shared.d present' || echo 'captive auto-open: /etc/NetworkManager/dnsmasq-shared.d MISSING — phone must open http://192.168.4.1 by hand'"

PW=$(grep '^KIOSK_SUDO_PASSWORD=' .env.local | head -1 | cut -d= -f2- | tr -d '\r' \
      | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
[ -n "$PW" ] || { echo "ABORT: KIOSK_SUDO_PASSWORD missing from .env.local" >&2; exit 4; }

echo "starting setup mode — this SSH link will drop when the hotspot takes the radio"
printf '%s\n' "$PW" | "${TARGET[@]}" "sudo -S -p '' systemd-run --unit=engirent-wifi-setup --collect -p EnvironmentFile=$D/.env -p WorkingDirectory=$D $D/venv/bin/python -m provisioning.setup_mode && sleep 4 && systemctl is-active engirent-wifi-setup && journalctl -u engirent-wifi-setup --no-pager -n 5" || true
unset PW
echo "If the link dropped just now, that is expected. On your phone: join 'EngiRent-Kiosk-Setup', open http://192.168.4.1"
