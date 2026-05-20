#!/usr/bin/env bash
# Array3 Monitor — drop-in apply script (Linux / macOS / WSL)
# Run from the repo root:
#   bash array3-monitor-fix-bundle/apply-fix.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="frontend/public/array3-monitor.html"
SRC="${SCRIPT_DIR}/array3-monitor.html.fixed"

if [[ ! -f "$TARGET" ]]; then
  echo "ERROR: $TARGET not found. Run this script from the repo root." >&2
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: bundled fixed file not found at $SRC" >&2
  exit 1
fi

BACKUP="${TARGET}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$TARGET" "$BACKUP"
echo "Backup written to: $BACKUP"

cp "$SRC" "$TARGET"
echo "Patched: $TARGET"

cat <<'EOF'

Next steps:
  1. Restart (or hard-refresh) your frontend so the new HTML is served.
  2. Load /monitoring from your machine's hostname (LAN IP, public IP, or localhost).
  3. Open DevTools - Network and confirm requests go to <your-host>:11488/11515/11906.

See verify.md in this bundle for the full checklist.
EOF
