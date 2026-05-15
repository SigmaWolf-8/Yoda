#!/usr/bin/env bash
# YODA — Replit startup script
#
# 1. Runs database migrations (if DATABASE_URL is set)
# 2. Builds the React frontend (if dist/ is missing or stale)
# 3. If a cached binary exists, starts it immediately so port 3000 opens fast
# 4. Builds the updated binary in the background; hot-swaps it on completion

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

# ── 3. Hot-start: run existing binary immediately if present ──────────
HOT_PID=""
if [ -f "target/debug/yoda-api" ]; then
    echo "Hot-starting cached binary so port 3000 opens immediately..."
    RUST_LOG="${RUST_LOG:-info}" \
    BIND_ADDR="${BIND_ADDR:-0.0.0.0}" \
    BIND_PORT="${BIND_PORT:-3000}" \
    ./target/debug/yoda-api &
    HOT_PID=$!
    echo "Cached API running as PID $HOT_PID"
fi

# ── 4. Build updated backend (background while hot binary serves) ──────
echo "Building updated Axum backend in background..."
cargo build --bin yoda-api 2>&1
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
    echo "⚠ Backend build failed — keeping cached binary if running"
    if [ -n "$HOT_PID" ]; then
        wait $HOT_PID
    fi
    exit 1
fi

# ── 5. Swap: kill hot binary, start fresh one ─────────────────────────
if [ -n "$HOT_PID" ]; then
    echo "Build complete — swapping to updated binary..."
    kill "$HOT_PID" 2>/dev/null || true
    sleep 1
fi

# ── 6. Build and start CRS daemon (non-fatal) ─────────────────────────
echo "Building YODA CRS daemon (release, background)..."
(
    if cargo build --release --bin yoda-crs 2>&1; then
        CRS_PORT="${CUBE_API_PORT:-8081}"
        pkill -x yoda-crs 2>/dev/null || true
        fuser -k "${CRS_PORT}/tcp" 2>/dev/null || true
        sleep 1
        echo "Starting YODA CRS on port $CRS_PORT..."
        CUBE_MODE=crs \
        CUBE_API_PORT="$CRS_PORT" \
        RUST_LOG="${RUST_LOG:-info}" \
        ./target/release/yoda-crs &
        echo "CRS daemon started (PID $!)"
    else
        echo "⚠ yoda-crs build failed — CRS features will be unavailable"
    fi
) &
CRS_BUILD_PID=$!

# Ensure CRS build process is cleaned up on exit
trap 'kill "$CRS_BUILD_PID" 2>/dev/null; pkill -x yoda-crs 2>/dev/null || true' EXIT INT TERM

# ── 7. Run updated API (foreground) ───────────────────────────────────
echo "Starting YODA API server on ${BIND_ADDR:-0.0.0.0}:${BIND_PORT:-3000}"
RUST_LOG="${RUST_LOG:-info}" \
BIND_ADDR="${BIND_ADDR:-0.0.0.0}" \
BIND_PORT="${BIND_PORT:-3000}" \
./target/debug/yoda-api
