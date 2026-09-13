#!/usr/bin/env bash
# server-repoint-tunnels.sh — re-point the rotated tunnel URLs on the server PC,
# then restart Node and the admin console so they use them. Nothing else.
#
# Exists so a Claude Code permission rule can allow exactly this action
# (`Bash(bash scripts/ops/server-repoint-tunnels.sh)`) instead of a wildcard over
# ssh. Takes NO arguments on purpose.
#
# Steps, each of which aborts the rest on failure:
#   1. read-only safety check (sweepcheck.js): refuse if a locker retrieval is
#      in flight — Node owns the E4.6 sweep that issues drop_item (G11)
#   2. repoint-tunnels.ps1: backs up node .env and admin .env.local, rewrites
#      API_PUBLIC_URL / CLIENT_WEB_URL / CLIENT_ADMIN_URL / NEXT_PUBLIC_API_URL
#      from this run's tunnel logs, prints only those keys
#   3. restart-node-admin.ps1: kill the real port owners, start the two tasks
#
# Every helper is copied to the server, run, and deleted.

set -euo pipefail
cd "$(dirname "$0")/../.."

SERVER=transfer@desktop-gklhcri
REMOTE_TMP='D:/ENG/startbat-logs'
REMOTE_NODE='D:/ENG/EngiRent/server/node_server'

ssh -o ConnectTimeout=20 -o BatchMode=yes "$SERVER" hostname >/dev/null \
  || { echo "ABORT: server unreachable" >&2; exit 2; }

echo "== 1. safety check (read-only)"
scp -q scripts/ops/sweepcheck.js "$SERVER:$REMOTE_NODE/sweepcheck.tmp.js"
CHECK=$(ssh -o BatchMode=yes "$SERVER" 'Set-Location D:\ENG\EngiRent\server\node_server; node sweepcheck.tmp.js; Remove-Item sweepcheck.tmp.js' 2>&1 | tr -d '\r')
echo "$CHECK"
IN_FLIGHT=$(printf '%s\n' "$CHECK" | sed -n 's/^IN_FLIGHT //p')
if [ -z "$IN_FLIGHT" ]; then echo "ABORT: safety check unreadable — not touching the server." >&2; exit 3; fi
if [ "$IN_FLIGHT" != "0" ]; then echo "ABORT: $IN_FLIGHT retrieval(s) in flight — not restarting Node." >&2; exit 3; fi

echo "== 2. re-point tunnel URLs (with backups)"
scp -q scripts/ops/repoint-tunnels.ps1 "$SERVER:$REMOTE_TMP/repoint.tmp.ps1"
ssh -o BatchMode=yes "$SERVER" 'powershell -NoProfile -ExecutionPolicy Bypass -File D:\ENG\startbat-logs\repoint.tmp.ps1; $rc = $LASTEXITCODE; Remove-Item D:\ENG\startbat-logs\repoint.tmp.ps1; exit $rc' \
  || { echo "ABORT: re-point failed — Node and admin NOT restarted." >&2; exit 4; }

echo "== 3. restart Node and admin"
scp -q scripts/ops/restart-node-admin.ps1 "$SERVER:$REMOTE_TMP/restart.tmp.ps1"
ssh -o BatchMode=yes "$SERVER" 'powershell -NoProfile -ExecutionPolicy Bypass -File D:\ENG\startbat-logs\restart.tmp.ps1; Remove-Item D:\ENG\startbat-logs\restart.tmp.ps1'

echo "done — verify separately: new PIDs on 5000/3001, API 200 through the new tunnel, and ACAO for the LIVE admin origin."
