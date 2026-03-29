#!/bin/bash
# bootstrap-agents.sh — One-time setup: pull The Agency fork + compile all agents.
#
# This script:
#   1. Clones msitarzewski/agency-agents into agents/upstream/
#   2. Runs compile-agents.sh to produce agents/compiled/*.json
#   3. Reports agent roster count per division
#
# After running this, restart yoda-api to load the full agent roster.
#
# Usage:
#   bash scripts/bootstrap-agents.sh
#
# Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "=== YODA Agent Bootstrap ==="
echo ""

# ── Step 1: Pull The Agency ──────────────────────────────────────────
if [ -d "agents/upstream/.git" ] || [ -d "agents/upstream/engineering" ]; then
    echo "[1/3] agents/upstream/ already exists — pulling latest..."
    cd agents/upstream
    git pull origin main 2>/dev/null || git pull 2>/dev/null || echo "  (pull failed — using existing files)"
    cd "$REPO_ROOT"
else
    echo "[1/3] Cloning The Agency (msitarzewski/agency-agents)..."
    mkdir -p agents/upstream

    # Clone into a secure temp directory (unpredictable name, auto-cleaned)
    TMPDIR=$(mktemp -d)
    trap 'rm -rf "$TMPDIR"' EXIT

    git clone --depth 1 https://github.com/msitarzewski/agency-agents.git "$TMPDIR/agency-agents"

    # Copy agent directories (skip non-agent dirs: scripts, integrations, examples, .github)
    for div in "$TMPDIR/agency-agents"/*/; do
        dirname=$(basename "$div")
        case "$dirname" in scripts|integrations|examples|.github) continue;; esac
        if ls "$div"/*.md &>/dev/null 2>&1; then
            cp -r "$div" "agents/upstream/"
            echo "  Copied division: $dirname"
        fi
    done

    # Copy license
    cp "$TMPDIR/agency-agents/LICENSE" agents/upstream/ 2>/dev/null || true

    rm -rf "$TMPDIR"
    trap - EXIT
    echo "  Done."
fi

echo ""

# ── Step 2: Verify Capomastro agents ─────────────────────────────────
echo "[2/3] Checking Capomastro proprietary agents..."
CAPOMASTRO_COUNT=$(find agents/capomastro -name '*.md' ! -name '.gitkeep' 2>/dev/null | wc -l)
echo "  Found $CAPOMASTRO_COUNT Capomastro agents"
if [ "$CAPOMASTRO_COUNT" -eq 0 ]; then
    echo "  WARNING: No Capomastro agents found in agents/capomastro/"
fi

echo ""

# ── Step 3: Compile ──────────────────────────────────────────────────
echo "[3/3] Compiling all agents..."
bash "$SCRIPT_DIR/compile-agents.sh"

echo ""

# ── Report ───────────────────────────────────────────────────────────
echo "=== Agent Roster ==="
for jsonfile in agents/compiled/*.json; do
    [ -f "$jsonfile" ] || continue
    div=$(python3 -c "import json,sys; print(json.load(open('$jsonfile'))['division'])" 2>/dev/null || echo "unknown")
    echo "  $div"
done | sort | uniq -c | sort -rn | while read count div; do
    printf "  %-24s %s agents\n" "$div" "$count"
done

TOTAL=$(find agents/compiled -name '*.json' | wc -l)
echo ""
echo "Total: $TOTAL agents compiled and ready."
echo ""
echo "=== Next Steps ==="
echo "  1. Restart yoda-api: cargo run --bin yoda-api"
echo "  2. Verify: curl localhost:3000/api/agents | jq '.total'"
echo "  3. The orchestrator will now match agents by competency per query."
echo ""
echo "Così sia."
