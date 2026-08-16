#!/usr/bin/env bash
# YODA — Replit startup script
#
# 1. Runs database migrations (if DATABASE_URL is set)
# 2. Builds the React frontend (if dist/ is missing or stale)
# 3. Starts the cached binary immediately so port 3000 opens fast
# 4. Builds the updated binary and swaps it in, reverting if it will not boot
#
# The overriding rule: never leave the port closed. When nothing listens on
# ${BIND_PORT}, the Replit proxy serves its own "We couldn't reach this app"
# page and there are no application logs to explain why, because the process is
# gone. Serving slightly stale code is always the better failure.
#
# Note the absence of `set -e`. It was here originally and silently defeated the
# build-failure fallback: the script aborted the instant `cargo build` returned
# non-zero, so the branch meant to keep the previous binary serving was
# unreachable dead code and every compile error closed the port. Failures are
# checked explicitly instead.
set -uo pipefail

echo "=== YODA Starting ==="

BIND_ADDR="${BIND_ADDR:-0.0.0.0}"
BIND_PORT="${BIND_PORT:-3000}"
BIN="target/debug/yoda-api"
# Kept outside target/ so a rebuild or `cargo clean` cannot remove the only copy
# that is known to boot.
LAST_GOOD="/tmp/yoda-api.last-good"

API_PID=""        # the API child currently expected to be serving
CRS_BUILD_PID=""

# ── Process helpers ───────────────────────────────────────────────────
#
# start_api sets the global API_PID rather than echoing it. Returning the pid
# through command substitution looks tidier but hangs: the backgrounded child
# inherits the substitution's stdout pipe, so `$(start_api …)` blocks until the
# API itself exits — i.e. forever, before the build step is ever reached.

start_api() {
    RUST_LOG="${RUST_LOG:-info}" \
    BIND_ADDR="$BIND_ADDR" \
    BIND_PORT="$BIND_PORT" \
    "$1" &
    API_PID=$!
}

stop_api() {
    [ -n "$API_PID" ] || return 0
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null
    API_PID=""
}

# Readiness must be tied to the process we launched. A bare port check can be
# satisfied by a lingering older instance, which would let a dead new binary
# look healthy and get promoted to last-known-good.
api_ready() {
    kill -0 "$1" 2>/dev/null || return 1
    if command -v curl >/dev/null 2>&1; then
        # /api/health reports the responder's own pid. Accepting any 200 here
        # would let an orphaned instance from an earlier run vouch for a child
        # that never bound the port — the app then looks healthy while serving
        # a different, older binary.
        local body
        body=$(curl -fsS -m 2 "http://127.0.0.1:${BIND_PORT}/api/health" 2>/dev/null) || return 1
        case "$body" in
            *'"pid":'*) echo "$body" | grep -q "\"pid\":$1[,}]" ;;
            # Older builds predate the pid field; fall back to liveness alone.
            *) return 0 ;;
        esac
    else
        (exec 3<>"/dev/tcp/127.0.0.1/${BIND_PORT}") 2>/dev/null
    fi
}

# A workflow restart does not always give the previous script time to run its
# EXIT trap, so its API child can survive and keep holding ${BIND_PORT}. Every
# start after that dies with EADDRINUSE while curl still answers — from the
# stale process — so the workflow reports failure while quietly serving old
# code. Reclaim the port before launching anything.
release_port() {
    local waited=0
    while (exec 3<>"/dev/tcp/127.0.0.1/${BIND_PORT}") 2>/dev/null; do
        exec 3>&- 2>/dev/null
        case "$waited" in
            0)
                echo "Port ${BIND_PORT} is held by an earlier instance — reclaiming it."
                pkill -x yoda-api 2>/dev/null
                ;;
            8)
                echo "  Still held after 4s — escalating."
                pkill -9 -x yoda-api 2>/dev/null
                fuser -k "${BIND_PORT}/tcp" 2>/dev/null
                ;;
            16)
                echo "⚠ Port ${BIND_PORT} is still held by something this script cannot stop."
                return 1
                ;;
        esac
        sleep 0.5
        waited=$(( waited + 1 ))
    done
    [ "$waited" -gt 0 ] && echo "Port ${BIND_PORT} released."
    return 0
}

# Wait up to $2 seconds for pid $1 to serve. Fails early if the process dies.
wait_for_api() {
    local pid="$1" deadline=$(( SECONDS + $2 ))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if ! kill -0 "$pid" 2>/dev/null; then return 1; fi
        if api_ready "$pid"; then return 0; fi
        sleep 0.5
    done
    return 1
}

# Only a binary observed serving is worth reverting to later.
promote_last_good() {
    cp -f "$1" "$LAST_GOOD" 2>/dev/null || true
}

# Bring up $1, and on failure fall back to the last verified-good binary.
# Leaves API_PID pointing at whatever is serving; returns non-zero if nothing is.
serve_or_revert() {
    local candidate="$1" label="$2"
    start_api "$candidate"
    if wait_for_api "$API_PID" 45; then
        promote_last_good "$candidate"
        return 0
    fi

    echo "✗ ${label} did not serve on port ${BIND_PORT} within 45s."
    stop_api

    if [ -f "$LAST_GOOD" ] && ! cmp -s "$LAST_GOOD" "$candidate"; then
        echo "↩ Reverting to the last binary known to boot so the app stays reachable."
        echo "  The running code is now BEHIND the source tree — see the errors above."
        start_api "$LAST_GOOD"
        if wait_for_api "$API_PID" 45; then
            return 0
        fi
        echo "✗ The last-known-good binary will not boot either."
        stop_api
    fi
    return 1
}

cleanup() {
    trap - EXIT INT TERM
    if [ -n "$CRS_BUILD_PID" ]; then
        pkill -P "$CRS_BUILD_PID" 2>/dev/null
        kill "$CRS_BUILD_PID" 2>/dev/null
    fi
    pkill -x yoda-crs 2>/dev/null
    # Must outlive nothing: a surviving child keeps holding the port and the
    # next start fails to bind, turning one bad restart into a permanent outage.
    stop_api
}
# Installed before anything is launched so a SIGTERM during the build — not just
# during the final wait — still takes the API child down with it.
trap cleanup EXIT INT TERM

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
    if (
        cd frontend || exit 1
        if [ ! -d "node_modules" ]; then npm ci || exit 1; fi
        npm run build
    ); then
        echo "Frontend built → frontend/dist/"
    elif [ -d "frontend/dist" ]; then
        echo "⚠ Frontend build failed — serving the previously built frontend/dist"
    else
        echo "✗ Frontend build failed and there is no previous frontend/dist to serve."
        exit 1
    fi
else
    echo "Frontend dist/ exists — skipping rebuild (set REBUILD_FRONTEND=1 to force)"
fi

# ── 3. Hot-start the cached binary so the port opens immediately ──────
release_port

if [ -f "$BIN" ]; then
    echo "Hot-starting cached binary so port ${BIND_PORT} opens immediately..."
    start_api "$BIN"
    if wait_for_api "$API_PID" 45; then
        echo "Cached API serving as PID $API_PID"
        # Snapshot only now that it has been seen serving. Copying before this
        # point would promote a binary that may never have booted.
        promote_last_good "$BIN"
    else
        echo "⚠ Cached binary did not come up — continuing to the rebuild."
        stop_api
    fi
fi

# ── 4. Build the updated backend ──────────────────────────────────────
echo "Building updated Axum backend..."
cargo build --bin yoda-api 2>&1
BUILD_EXIT=$?

if [ "$BUILD_EXIT" -ne 0 ]; then
    echo "⚠ Backend build failed (exit $BUILD_EXIT)."
    if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
        echo "  Keeping the cached binary serving — the app stays reachable."
        echo "  Fix the compile error and restart."
        wait "$API_PID"
        exit $?
    fi
    echo "  Nothing is serving; trying the last binary known to boot."
    if [ -f "$LAST_GOOD" ]; then
        start_api "$LAST_GOOD"
        if wait_for_api "$API_PID" 45; then
            echo "↩ Serving the last-known-good binary. Running code is BEHIND the source."
            wait "$API_PID"
            exit $?
        fi
        stop_api
    fi
    echo "✗ No binary available to serve."
    exit 1
fi

# ── 5. Swap in the freshly built binary ───────────────────────────────
# One process, one port, so the old instance must release it before the new one
# can bind: a brief gap here is unavoidable. What matters is that the gap always
# ends — either the new binary serves, or the previous one is put back.
if [ -n "$API_PID" ]; then
    echo "Build complete — swapping to the updated binary..."
    stop_api
fi

# ── 6. Build and start the CRS daemon (non-fatal) ─────────────────────
echo "Building YODA CRS daemon (release, background)..."
(
    if cargo build --release --bin yoda-crs 2>&1; then
        CRS_PORT="${CUBE_API_PORT:-8081}"
        pkill -x yoda-crs 2>/dev/null
        fuser -k "${CRS_PORT}/tcp" 2>/dev/null
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

# ── 7. Serve, reverting if the new binary will not boot ───────────────
echo "Starting YODA API server on ${BIND_ADDR}:${BIND_PORT}"
if ! serve_or_revert "$BIN" "New binary"; then
    echo "✗ Nothing is serving on port ${BIND_PORT}."
    exit 1
fi

echo "✓ API serving on ${BIND_ADDR}:${BIND_PORT} (PID $API_PID)"
wait "$API_PID"
