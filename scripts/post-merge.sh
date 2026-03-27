#!/bin/bash
set -e

echo "=== Post-merge setup ==="

# Rebuild the frontend so merged UI changes are served immediately.
# DB migrations intentionally skipped — sqlx-cli checksum is corrupted;
# apply schema changes via: psql "$DATABASE_URL" -c "..."
echo "Building frontend..."
cd frontend && npm run build
echo "Frontend built."
