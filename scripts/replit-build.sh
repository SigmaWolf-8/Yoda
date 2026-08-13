#!/usr/bin/env bash
# YODA — publish build step. Runs in the deployment builder, never at runtime.
#
# Produces everything the published image needs:
#   1. agents/compiled/*.json  — the agent roster the API loads at startup
#   2. frontend/dist/          — the React SPA the API serves
#   3. deploy-bin/yoda-api     — an optimised backend binary
#
# The binary is copied out of target/ deliberately. target/ is ~15 GB of build
# cache and is excluded from the published image by .replitignore — the publish
# that prompted this script died mid-upload on an object file inside
# target/debug/deps. Anything that must reach the image has to live outside
# target/, so deploy-bin/ is where the artefact lands.
#
# Every failure here is fatal. A publish that quietly ships a stale frontend or
# an empty agent roster fails later, in production, where it is far harder to
# read than a build that stops and says which step broke.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== 1/3 Compiling the agent roster ==="
bash scripts/compile-agents.sh

echo "=== 2/3 Building the frontend ==="
(
    cd frontend
    npm ci
    npm run build
)
if [ ! -f frontend/dist/index.html ]; then
    echo "✗ frontend/dist/index.html is missing after the build."
    exit 1
fi

echo "=== 3/3 Building the backend (release) ==="
cargo build --release --bin yoda-api

mkdir -p deploy-bin
cp -f target/release/yoda-api deploy-bin/yoda-api
chmod +x deploy-bin/yoda-api

echo "✓ Publish build complete — deploy-bin/yoda-api ($(du -h deploy-bin/yoda-api | cut -f1))"
