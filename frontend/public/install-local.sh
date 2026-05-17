#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  YODA · Local Install Script
#  Run: bash install-local.sh
# ══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $1"; }
info() { echo -e "${CYAN}→${NC}  $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
die()  { echo -e "${RED}✗${NC}  $1"; exit 1; }

echo ""
echo "  YODA · Local Setup"
echo "  ══════════════════"
echo ""

# ── 1. Check Rust ─────────────────────────────────────────────
if command -v cargo &>/dev/null; then
  ok "Rust found: $(rustc --version)"
else
  warn "Rust not found. Installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  ok "Rust installed: $(rustc --version)"
fi

# ── 2. Check Node.js ──────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//')
  MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$MAJOR" -lt 20 ]; then
    die "Node.js $NODE_VER found but 20+ is required. Install from https://nodejs.org"
  fi
  ok "Node.js found: $(node --version)"
else
  die "Node.js not found. Install from https://nodejs.org then re-run this script."
fi

# ── 3. Build frontend ─────────────────────────────────────────
info "Building React frontend..."
cd frontend
npm install --silent
npm run build
cd ..
ok "Frontend built → frontend/dist/"

# ── 4. Build backend ──────────────────────────────────────────
info "Building Rust backend (first run: 2-5 min)..."
cargo build --bin yoda-api
ok "Backend built → target/debug/yoda-api"

# ── 5. Done ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══ Ready ══${NC}"
echo ""
echo "  Start the server:"
echo ""
echo "    export BIND_ADDR=127.0.0.1"
echo "    export BIND_PORT=3000"
echo "    export RUST_LOG=info"
echo "    ./target/debug/yoda-api"
echo ""
echo "  Then open:  http://localhost:3000"
echo ""
