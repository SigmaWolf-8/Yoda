#!/usr/bin/env bash
# YODA — Replit startup script
#
# 1. Runs database migrations (if DATABASE_URL is set)
# 2. Builds the React frontend (if dist/ is missing or stale)
# 3. Builds and runs the Axum backend (which serves React dist/ as static files)
#
# The backend serves the frontend at / and API at /api/*, so only port 3000
# is exposed. No separate frontend server needed.

set -euo pipefail

echo "=== YODA Starting ==="

# ── 1. Database migrations ────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
    echo "Running database migrations..."
    sqlx migrate run --source migrations/ 2>&1 || {
        echo "⚠ Migration failed or sqlx-cli not available. Continuing..."
    }
else
    echo "⚠ DATABASE_URL not set — skipping migrations"
fi

# ── 2. Build frontend (if needed) ────────────────────────────────────
if [ ! -d "frontend/dist" ] || [ -n "${REBUILD_FRONTEND:-}" ]; then
    echo "Building React frontend..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        npm ci
    fi
    npm run build
    cd ..
    echo "Frontend built → frontend/dist/"
else
    echo "Frontend dist/ exists — skipping rebuild (set REBUILD_FRONTEND=1 to force)"
fi

# ── 3. Build and run backend ─────────────────────────────────────────
echo "Building Axum backend..."
cargo build --bin yoda-api 2>&1

# ── 4. Build and start CRS daemon (non-fatal) ─────────────────────────
echo "Building YODA CRS daemon (release)..."
if cargo build --release --bin yoda-crs 2>&1; then
    CRS_PORT="${CUBE_API_PORT:-8081}"

    # Kill any previous yoda-crs still holding the port (survives SIGTERM to shell)
    OLD_PID=$(lsof -ti tcp:"$CRS_PORT" 2>/dev/null || true)
    if [ -n "$OLD_PID" ]; then
        echo "Releasing port $CRS_PORT from PID $OLD_PID..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi

    echo "Starting YODA CRS on port $CRS_PORT..."
    CUBE_MODE=crs \
    CUBE_API_PORT="$CRS_PORT" \
    RUST_LOG="${RUST_LOG:-info}" \
    ./target/release/yoda-crs &
    CRS_PID=$!
    echo "CRS daemon started (PID $CRS_PID)"

    # Ensure CRS is killed when this script exits
    trap 'kill "$CRS_PID" 2>/dev/null || true' EXIT INT TERM
else
    echo "⚠ yoda-crs build failed — CRS features will be unavailable"
fi

echo "Starting YODA API server on ${BIND_ADDR:-0.0.0.0}:${BIND_PORT:-3000}"
cargo run --bin yoda-api
