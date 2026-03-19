#!/usr/bin/env bash
# YODA — PostgreSQL initialization for Replit
#
# Run this ONCE after creating the Replit instance.
# Enables required extensions and verifies connectivity.
#
# Replit provides PostgreSQL 16.10 with pgvector 0.8.0 available.
# The DATABASE_URL is automatically set in Replit Secrets.
#
# Usage: bash scripts/init-db.sh

set -euo pipefail

echo "=== YODA Database Initialization ==="

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL not set."
    echo ""
    echo "On Replit:"
    echo "  1. Go to Tools → Database (PostgreSQL)"
    echo "  2. Create a database — Replit sets DATABASE_URL automatically"
    echo "  3. Or set it manually in Secrets: DATABASE_URL=postgres://user:pass@host:5432/dbname"
    exit 1
fi

echo "Connecting to PostgreSQL..."
echo "DATABASE_URL is set (not printing for security)"

# Enable required extensions
echo "Enabling extensions..."

psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" 2>&1 && \
    echo "  ✓ pg_trgm (trigram fuzzy matching)" || \
    echo "  ✗ pg_trgm failed"

psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;' 2>&1 && \
    echo "  ✓ pgvector (vector similarity search)" || \
    echo "  ✗ pgvector failed"

psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' 2>&1 && \
    echo '  ✓ uuid-ossp (UUID generation)' || \
    echo '  ✗ uuid-ossp failed'

# Verify
echo ""
echo "Verifying extensions..."
psql "$DATABASE_URL" -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm', 'vector', 'uuid-ossp');"

echo ""
echo "Running migrations..."
sqlx migrate run --source migrations/

echo ""
echo "✓ Database initialization complete."
echo "  Run 'sqlx prepare' to generate compile-time SQL cache."
