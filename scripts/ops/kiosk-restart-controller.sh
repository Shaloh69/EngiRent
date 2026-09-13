#!/usr/bin/env bash
# kiosk-restart-controller.sh — restart ONE service on the kiosk Pi, and nothing else.
#
# Exists so a Claude Code permission rule can allow exactly this action
# (`Bash(bash scripts/ops/kiosk-restart-controller.sh)`) instead of a wildcard
# like `ssh engirent@engirent-kiosk *`, which would also allow opening a door.
# Takes NO arguments on purpose: an allowed invocation cannot be steered into a
# different command.
#
# What moving parts this touches (G11, checked 2026-09-13):
#   `systemctl restart engirent-kiosk` re-runs main.py's init_hardware(). Both
#   relay classes claim their GPIO lines with `gpio_claim_output(h, pin,
#   _RELAY_OFF)` — de-energised = locked. No door opens, no actuator strokes.
#
# Refuses unless the kiosk is idle: /api/state status must be one of
# idle/online/offline/error AND active_locker must be null. Anything else — a
# door cycle, a face scan, a session — or an unreadable state means NO.
#
# Secrets: KIOSK_SUDO_PASSWORD is read from the gitignored .env.local and piped
# over SSH stdin into `sudo -S`. Never argv, never printed.

set -euo pipefail
cd "$(dirname "$0")/../.."

PI_USER=engirent
TS_HOST=engirent-kiosk
JUMP=transfer@desktop-gklhcri
LAN_IP=192.168.1.65          # DHCP — update if the kiosk's screen shows a different IP

SSH_BASE=(-o ConnectTimeout=12 -o BatchMode=yes -o HostKeyAlias=engirent-kiosk -o StrictHostKeyChecking=yes)

# ── reach the Pi: Tailscale first, then the LAN through the server PC ─────────
if ssh "${SSH_BASE[@]}" "$PI_USER@$TS_HOST" true 2>/dev/null; then
  TARGET=(ssh "${SSH_BASE[@]}" "$PI_USER@$TS_HOST")
  echo "route: tailscale ($TS_HOST)"
elif ssh "${SSH_BASE[@]}" -J "$JUMP" "$PI_USER@$LAN_IP" true 2>/dev/null; then
  TARGET=(ssh "${SSH_BASE[@]}" -J "$JUMP" "$PI_USER@$LAN_IP")
  echo "route: LAN via $JUMP → $LAN_IP"
else
  echo "ABORT: kiosk unreachable over Tailscale and over the LAN jump." >&2
  exit 2
fi

# ── safety gate: only restart an idle kiosk ───────────────────────────────────
STATE_JSON=$("${TARGET[@]}" 'curl -s -m 5 http://localhost:8080/api/state' || true)
STATUS=$(printf '%s' "$STATE_JSON" | python -c 'import json,sys
try: print(json.load(sys.stdin).get("status",""))
except Exception: print("")' 2>/dev/null || echo "")
ACTIVE=$(printf '%s' "$STATE_JSON" | python -c 'import json,sys
try: print(json.load(sys.stdin).get("active_locker"))
except Exception: print("UNREADABLE")' 2>/dev/null || echo "UNREADABLE")

echo "kiosk state: status='${STATUS}' active_locker=${ACTIVE}"
case "$STATUS" in
  idle|online|offline|error) ;;
  *) echo "ABORT: status '${STATUS:-<unreadable>}' is not idle — possibly mid-handover. Not restarting." >&2; exit 3 ;;
esac
if [ "$ACTIVE" != "None" ]; then
  echo "ABORT: active_locker=${ACTIVE} — a bay is in use. Not restarting." >&2
  exit 3
fi

OLD_PID=$("${TARGET[@]}" 'systemctl show engirent-kiosk -p MainPID --value')
echo "controller PID before: $OLD_PID"

# ── the one action ────────────────────────────────────────────────────────────
PW=$(grep '^KIOSK_SUDO_PASSWORD=' .env.local | head -1 | cut -d= -f2- | tr -d '\r' \
      | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
if [ -z "$PW" ]; then echo "ABORT: KIOSK_SUDO_PASSWORD missing from .env.local" >&2; exit 4; fi
printf '%s\n' "$PW" | "${TARGET[@]}" 'sudo -S -p "" systemctl restart engirent-kiosk'
unset PW

# ── prove it: PID must change, then show what the new process logged ─────────
NEW_PID=""
for _ in $(seq 1 15); do
  NEW_PID=$("${TARGET[@]}" 'systemctl show engirent-kiosk -p MainPID --value' || true)
  if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "0" ] && [ "$NEW_PID" != "$OLD_PID" ]; then break; fi
  sleep 2
done
if [ -z "$NEW_PID" ] || [ "$NEW_PID" = "$OLD_PID" ] || [ "$NEW_PID" = "0" ]; then
  echo "WARNING: PID did not change ($OLD_PID → ${NEW_PID:-none}). Restart NOT proven." >&2
  exit 5
fi
echo "controller PID after : $NEW_PID  (restart proven by PID change)"
echo "active: $("${TARGET[@]}" 'systemctl is-active engirent-kiosk')"
echo "(allow ~20s, then check the journal of PID $NEW_PID for 'Uplink watchdog started' and for any UNLOCK/EXTEND/RETRACT lines — there should be none)"
