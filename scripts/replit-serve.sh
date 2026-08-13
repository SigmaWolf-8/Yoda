#!/usr/bin/env bash
# YODA — published run command.
#
# Starts the binary that scripts/replit-build.sh already produced, and compiles
# nothing. The development script (scripts/replit-run.sh) builds on startup on
# purpose, so a restart always picks up the latest source; that behaviour would
# be wrong here twice over — cargo and target/ are not in the published image,
# and on autoscale a container is started to answer a request, so a build would
# blow the startup probe on every cold start.
set -uo pipefail

cd "$(dirname "$0")/.."

BIN="deploy-bin/yoda-api"
if [ ! -x "$BIN" ]; then
    echo "✗ $BIN is missing or not executable."
    echo "  The publish build step (scripts/replit-build.sh) did not run or did not finish."
    exit 1
fi

# Autoscale hands the port in $PORT. Fall back to the development default so the
# same script still works if it is ever run by hand.
export BIND_ADDR="${BIND_ADDR:-0.0.0.0}"
export BIND_PORT="${PORT:-${BIND_PORT:-3000}}"
export RUST_LOG="${RUST_LOG:-info}"
export AGENTS_COMPILED_PATH="${AGENTS_COMPILED_PATH:-./agents/compiled}"
export MODEL_LINEAGES_PATH="${MODEL_LINEAGES_PATH:-./model_lineages.json}"
export FRONTEND_DIST_PATH="${FRONTEND_DIST_PATH:-./frontend/dist}"

# The production schema is copied from the development database at publish time,
# so a missing sqlx-cli is survivable — but it is announced rather than passed
# over in silence, so a schema surprise later has something to point at.
if [ -n "${DATABASE_URL:-}" ]; then
    if command -v sqlx >/dev/null 2>&1; then
        sqlx migrate run --source migrations/ \
            || echo "⚠ Migrations failed — continuing with the schema already in the database."
    else
        echo "⚠ sqlx-cli is not in the image — skipping migrations."
    fi
else
    echo "⚠ DATABASE_URL is not set — skipping migrations."
fi

echo "Starting YODA API on ${BIND_ADDR}:${BIND_PORT}"
# exec so the server is PID 1's direct child and receives shutdown signals
# itself, rather than this shell swallowing them.
exec "$BIN"
