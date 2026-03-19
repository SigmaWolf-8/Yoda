#!/usr/bin/env bash
# Deploy YODA to production.
#
# Steps:
# 1. Compile agents (if needed)
# 2. Build Rust backend (release mode)
# 3. Build React frontend (production)
# 4. Run database migrations
# 5. Start the server
#
# Usage: ./scripts/deploy.sh

set -euo pipefail

echo "=== YODA Deploy ==="

# 1. Compile agents if compiled/ is empty
if [ -z "$(ls agents/compiled/*.json 2>/dev/null)" ]; then
    echo "No compiled agents found. Running compiler..."
    ./scripts/compile-agents.sh
fi

# 2. Build backend
echo "Building Axum backend (release)..."
cargo build --release --bin yoda-api

# 3. Build frontend
echo "Building React frontend..."
cd frontend
npm ci
npm run build
cd ..

# 4. Run migrations
echo "Running database migrations..."
sqlx migrate run

# 5. Start
echo "Starting YODA..."
./target/release/yoda-api
