#!/usr/bin/env bash
# Run FROM THE DEV PC (Git Bash), at the repo root or anywhere:
#
#   bash server/python_server/services/ml/deploy/deploy_v2.sh            # switch EngiRentMl to v2
#   bash server/python_server/services/ml/deploy/deploy_v2.sh --rollback # back to v1
#
# Packs the committed app/ (no __pycache__), uploads it and server_switch_v2.ps1,
# and runs the switch on the server. Refuses if app/ has uncommitted changes, so
# what runs on the server is exactly a commit. Check for a live kiosk flow first:
# a restart drops any verify in progress (and face checks for ~1 minute).
set -euo pipefail
HOST=transfer@desktop-gklhcri
ML_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_ML='D:/ENG/EngiRent/server/python_server/services/ml'

scp -q "$ML_DIR/deploy/server_switch_v2.ps1" "$HOST:D:/ENG/server_switch_v2.ps1"

if [[ "${1:-}" == "--rollback" ]]; then
  ssh "$HOST" 'powershell -NoProfile -ExecutionPolicy Bypass -File D:\ENG\server_switch_v2.ps1 -Rollback'
  exit 0
fi

cd "$ML_DIR"
if ! git diff --quiet HEAD -- app; then
  echo "app/ has uncommitted changes: commit first, so the server runs a known commit" >&2
  exit 1
fi
echo "deploying app/ at commit $(git rev-parse --short HEAD)"
TAR="$(mktemp -d)/app_v2.tar"
tar --force-local --exclude=__pycache__ -cf "$TAR" app
scp -q "$TAR" "$HOST:$REMOTE_ML/app_v2.tar"
ssh "$HOST" 'powershell -NoProfile -ExecutionPolicy Bypass -File D:\ENG\server_switch_v2.ps1'
