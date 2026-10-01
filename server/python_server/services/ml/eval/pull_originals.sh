#!/usr/bin/env bash
# Run FROM THE DEV PC (Git Bash). Copies the server's kiosk verification captures
# (storage/verifications ONLY, never storage/users: those are faces) into the
# gitignored eval folder, so eval/rebuild_dataset.py can restore the 13 frames the
# first copy overwrote. Nothing here is committed: eval/data/ is gitignored and the
# repo is public.
#
#   bash server/python_server/services/ml/eval/pull_originals.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/data/real_2026-09-24/_orig_verifications"
git -C "$HERE" check-ignore -q "$DEST" || { echo "refusing: $DEST is not gitignored" >&2; exit 1; }
mkdir -p "$DEST"
scp -q -r 'transfer@desktop-gklhcri:D:/ENG/EngiRent/server/node_server/storage/verifications/*' "$DEST/"
echo "pulled $(find "$DEST" -type f | wc -l) files into $DEST"
