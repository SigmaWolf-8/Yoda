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

echo "Starting YODA API server on ${BIND_ADDR:-0.0.0.0}:${BIND_PORT:-3000}"
cargo run --bin yoda-api
