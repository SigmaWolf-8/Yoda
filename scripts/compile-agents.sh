#!/bin/bash
# compile-agents.sh — Compile all agent markdown definitions into JSON configs.
#
# Usage:
#   bash scripts/compile-agents.sh
#
# Reads from:
#   agents/upstream/   (MIT-licensed agents from The Agency fork)
#   agents/capomastro/ (proprietary Capomastro agents)
#
# Writes to:
#   agents/compiled/*.json
#
# The YODA API server loads these at startup via AgentRegistry::load().
#
# Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPILER="$REPO_ROOT/tools/yoda-agent-compiler"

cd "$REPO_ROOT"

# Workflow restarts and post-merge checks may compile concurrently. Serialize
# publication, and never share a staging directory with another invocation.
exec 9>"$REPO_ROOT/agents/.compile.lock"
flock -x 9
STAGING=$(mktemp -d "$REPO_ROOT/agents/.compiled-stage.XXXXXX")
trap 'rm -rf -- "$STAGING"' EXIT

echo "=== YODA Agent Compiler ==="

# Check if the compiler binary exists, build if not
if ! cargo metadata --manifest-path "$COMPILER/Cargo.toml" &>/dev/null 2>&1; then
    echo "ERROR: Cannot find agent compiler at $COMPILER"
    exit 1
fi

# Check for .agent-skip file (agents excluded during review)
SKIP_FLAG=""
if [ -f agents/.agent-skip ]; then
    echo "Skip list found: agents/.agent-skip"
fi

# Build the compiler (release for speed)
echo "Building agent compiler..."
cargo build --release --manifest-path "$COMPILER/Cargo.toml" 2> agents/compile-warnings.log || {
    echo "ERROR: Agent compiler build failed. See agents/compile-warnings.log"
    exit 1
}

BINARY="$REPO_ROOT/target/release/yoda-agent-compiler"

if [ ! -x "$BINARY" ]; then
    echo "ERROR: Compiler binary not found or not executable at $BINARY"
    exit 1
fi

# Run the compiler into the temp directory
echo "Compiling agents..."
"$BINARY" \
    --upstream agents/upstream \
    --custom agents/capomastro \
    --output "$STAGING"

# Count results
COMPILED=$(find "$STAGING" -name '*.json' | wc -l)
UPSTREAM=$(find agents/upstream -name '*.md' 2>/dev/null | wc -l)
CAPOMASTRO=$(find agents/capomastro -name '*.md' ! -name '.gitkeep' 2>/dev/null | wc -l)

if [ "$COMPILED" -eq 0 ]; then
    echo "ERROR: No agents compiled. Aborting — existing roster preserved."
    exit 1
fi

# Publish only a complete roster; restore the previous one if publication fails.
BACKUP=$(mktemp -d "$REPO_ROOT/agents/.compiled-backup.XXXXXX")
rmdir "$BACKUP"
if [ -d agents/compiled ]; then
    mv agents/compiled "$BACKUP"
fi
if ! mv "$STAGING" agents/compiled; then
    if [ -d "$BACKUP" ]; then mv "$BACKUP" agents/compiled; fi
    exit 1
fi
rm -rf -- "$BACKUP"

echo ""
echo "=== Results ==="
echo "  Upstream agents found:   $UPSTREAM"
echo "  Capomastro agents found: $CAPOMASTRO"
echo "  Compiled $COMPILED agent configs → agents/compiled/"
echo ""

echo "Done. Restart yoda-api to load new agents."
