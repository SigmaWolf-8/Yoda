#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  YODA — local development bootstrap
#
#  Verifies every prerequisite for running YODA on your own machine, then
#  prepares the parts that can be prepared automatically:
#
#    * .env.local          (copied from .env.local.example, secrets generated)
#    * PostgreSQL          (docker compose --profile db up -d)
#    * frontend/node_modules
#    * agents/compiled     (agent roster)
#
#  It never installs a toolchain behind your back — a missing prerequisite
#  prints the exact command to install it and the script stops.
#
#  Usage:
#    bash scripts/local-setup.sh            # check + prepare
#    bash scripts/local-setup.sh --check    # check only, change nothing
#
#  Windows: run under Git Bash or WSL, or follow LOCAL_SETUP.md by hand.
#
#  Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division
# ══════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

if [ -t 1 ]; then
  RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; CYN=$'\033[0;36m'; DIM=$'\033[2m'; NC=$'\033[0m'
else
  RED=""; GRN=""; YLW=""; CYN=""; DIM=""; NC=""
fi

# MISSING blocks setup entirely; DESKTOP_MISSING only rules out the Tauri app —
# a developer with no GTK headers can still run YODA in a browser, so that must
# not stop the database and frontend from being prepared.
MISSING=0
DESKTOP_MISSING=0
ok()   { echo "  ${GRN}✓${NC} $1"; }
info() { echo "  ${CYN}→${NC} $1"; }
warn() { echo "  ${YLW}!${NC} $1"; }
bad()  { echo "  ${RED}✗${NC} $1"; MISSING=$((MISSING + 1)); }
desk() { echo "  ${YLW}!${NC} $1"; DESKTOP_MISSING=$((DESKTOP_MISSING + 1)); }
hint() { echo "    ${DIM}$1${NC}"; }
head2() { echo ""; echo "${CYN}$1${NC}"; }

echo ""
echo "  YODA · local setup"
echo "  ══════════════════"

# ── 1. Prerequisites ─────────────────────────────────────────────────
head2 "1. Prerequisites"

# Rust — 1.77.2 is the floor for Tauri v2.
if command -v rustc >/dev/null 2>&1; then
  RUST_VER="$(rustc --version | awk '{print $2}')"
  RUST_MIN="1.77.2"
  if [ "$(printf '%s\n%s\n' "$RUST_MIN" "$RUST_VER" | sort -V | head -1)" = "$RUST_MIN" ]; then
    ok "Rust $RUST_VER"
  else
    bad "Rust $RUST_VER is too old (Tauri v2 needs >= $RUST_MIN)"
    hint "rustup update stable"
  fi
else
  bad "Rust toolchain not found"
  hint "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi

# Node — 20+ for the Vite 8 toolchain.
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
    ok "Node $(node --version)"
  else
    bad "Node $(node --version) is too old (need >= 20)"
    hint "https://nodejs.org  —  or: nvm install 20"
  fi
else
  bad "Node.js not found"
  hint "https://nodejs.org  —  or: nvm install 20"
fi

command -v npm >/dev/null 2>&1 && ok "npm $(npm --version)" || {
  bad "npm not found (ships with Node.js)"
  hint "https://nodejs.org"
}

# Tauri CLI — the desktop wrapper only.
if cargo tauri --version >/dev/null 2>&1; then
  ok "Tauri CLI $(cargo tauri --version 2>/dev/null | tail -1)"
else
  desk "cargo-tauri not found — needed only for the desktop app"
  hint "cargo install tauri-cli --version '^2.0.0' --locked"
fi

# Docker — supplies PostgreSQL.
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) (daemon running)"
    DOCKER_UP=1
  else
    bad "Docker is installed but the daemon is not running"
    hint "Start Docker Desktop, or: sudo systemctl start docker"
    DOCKER_UP=0
  fi
else
  bad "Docker not found — required for local PostgreSQL"
  hint "https://docs.docker.com/get-docker/"
  hint "Already have PostgreSQL 16 + pgvector? Point DATABASE_URL at it and skip Docker."
  DOCKER_UP=0
fi

# Platform-specific Tauri system libraries.
head2 "2. Platform Tauri dependencies"
case "$(uname -s)" in
  Linux)
    if command -v pkg-config >/dev/null 2>&1; then
      LIBS_OK=1
      for lib in webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0 gtk+-3.0; do
        pkg-config --exists "$lib" || { LIBS_OK=0; desk "missing dev library: $lib"; }
      done
      [ "$LIBS_OK" = "1" ] && ok "webkit2gtk / gtk3 / libsoup3 development headers present"
      [ "$LIBS_OK" = "1" ] || hint "Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file"
    else
      warn "pkg-config not found — cannot verify the GTK/WebKit headers"
      hint "sudo apt install pkg-config"
    fi
    ;;
  Darwin)
    if xcode-select -p >/dev/null 2>&1; then
      ok "Xcode command line tools"
    else
      desk "Xcode command line tools not installed"
      hint "xcode-select --install"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    warn "Windows: Tauri needs the WebView2 runtime and the MSVC C++ build tools"
    hint "https://developer.microsoft.com/microsoft-edge/webview2/"
    hint "https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    ;;
  *) warn "Unrecognised platform $(uname -s) — see https://tauri.app/start/prerequisites/" ;;
esac

if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo "${RED}$MISSING prerequisite(s) missing.${NC} Install them and re-run this script."
  echo "Full details: LOCAL_SETUP.md"
  echo ""
  exit 1
fi

if [ "$DESKTOP_MISSING" -gt 0 ]; then
  echo ""
  echo "  ${YLW}$DESKTOP_MISSING desktop-only prerequisite(s) missing.${NC}"
  echo "  ${DIM}YODA will run in the browser; \`cargo tauri dev\` will not.${NC}"
fi

if [ "$CHECK_ONLY" = "1" ]; then
  echo ""
  if [ "$DESKTOP_MISSING" -gt 0 ]; then
    echo "${GRN}Web prerequisites satisfied.${NC} (--check: nothing was changed)"
  else
    echo "${GRN}All prerequisites satisfied.${NC} (--check: nothing was changed)"
  fi
  echo ""
  exit 0
fi

# ── 3. Environment file ──────────────────────────────────────────────
head2 "3. Environment (.env.local)"
if [ -f .env.local ]; then
  ok ".env.local exists — leaving it untouched"
  if grep -q "CHANGE_ME" .env.local; then
    warn "it still contains CHANGE_ME placeholders — replace them before first login"
    hint "openssl rand -hex 32"
  fi
else
  cp .env.local.example .env.local
  if command -v openssl >/dev/null 2>&1; then
    JWT="$(openssl rand -hex 32)"
    JWT_R="$(openssl rand -hex 32)"
    # BSD sed (macOS) needs an explicit empty suffix for -i.
    if sed --version >/dev/null 2>&1; then SED_I=(-i); else SED_I=(-i ''); fi
    sed "${SED_I[@]}" "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env.local
    sed "${SED_I[@]}" "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$JWT_R|" .env.local
    ok ".env.local created with freshly generated JWT secrets"
  else
    warn ".env.local created, but openssl is missing — set the JWT secrets by hand"
  fi
fi

# ── 4. PostgreSQL ────────────────────────────────────────────────────
head2 "4. PostgreSQL (Docker)"
if [ "${DOCKER_UP:-0}" = "1" ]; then
  info "docker compose --profile db up -d"
  if docker compose --profile db up -d; then
    ok "PostgreSQL container is up on localhost:5432"
    info "waiting for it to accept connections..."
    for _ in $(seq 1 30); do
      if docker compose exec -T postgres pg_isready -U yoda -d yoda >/dev/null 2>&1; then
        ok "PostgreSQL ready"
        break
      fi
      sleep 1
    done
  else
    warn "could not start the database container — start it yourself with:"
    hint "docker compose --profile db up -d"
  fi
else
  warn "Docker daemon unavailable — start PostgreSQL yourself and set DATABASE_URL"
fi

# ── 5. Frontend dependencies ─────────────────────────────────────────
head2 "5. Frontend dependencies"
if [ -d frontend/node_modules ]; then
  ok "frontend/node_modules present"
else
  info "npm ci (frontend/)"
  (cd frontend && npm ci) && ok "frontend dependencies installed" \
    || { warn "npm ci failed — trying npm install"; (cd frontend && npm install); }
fi

# ── 6. Agent roster ──────────────────────────────────────────────────
head2 "6. Agent roster"
if ls agents/compiled/*.json >/dev/null 2>&1; then
  ok "$(ls agents/compiled/*.json | wc -l | tr -d ' ') compiled agents"
else
  info "compiling agents (first run builds the compiler — a few minutes)"
  bash scripts/compile-agents.sh && ok "agent roster compiled" \
    || warn "agent compilation failed — YODA runs with generic prompts until it succeeds"
fi

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo "${GRN}Setup complete.${NC}"
echo ""
echo "  Web (two terminals):"
echo "    ${DIM}set -a; . ./.env.local; set +a; cargo run --bin yoda-api${NC}"
echo "    ${DIM}cd frontend && npm run dev${NC}          → http://localhost:5173"
echo ""
echo "  Desktop:"
echo "    ${DIM}cd tauri && cargo tauri dev${NC}"
echo ""
echo "  Details and troubleshooting: LOCAL_SETUP.md"
echo ""
