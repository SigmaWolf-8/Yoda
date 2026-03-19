#!/usr/bin/env bash
# Compile all agent markdown definitions into JSON configs.
#
# Runs the yoda-agent-compiler CLI tool which:
# 1. Audits MIT license headers on all upstream agents
# 2. Parses markdown agent files
# 3. Builds system prompts and competency tags
# 4. Outputs structured JSON to agents/compiled/
#
# Usage: ./scripts/compile-agents.sh

set -euo pipefail

echo "=== YODA Agent Compiler ==="

# Ensure output directory exists
mkdir -p agents/compiled

# Run the compiler
cargo run --bin yoda-agent-compiler -- \
    --upstream agents/upstream/ \
    --custom agents/capomastro/ \
    --output agents/compiled/

COMPILED=$(ls agents/compiled/*.json 2>/dev/null | wc -l)
echo ""
echo "Compiled $COMPILED agent configs → agents/compiled/"
