// ── Shared script generators for YODA self-hosted engine install / reconnect ──
// Imported by both ModelInstallModal (reconnect modal) and EngineSlot (direct
// install download).  Keep this file free of React imports.

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect broad OS category from navigator.userAgent. */
export function detectOS(): 'windows' | 'mac' | 'linux' {
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  return 'linux';
}

/** Trigger a browser file download. */
export function triggerDownload(content: string, filename: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Wrap a PowerShell script in a self-executing Windows batch file.
 *
 * The PS1 content is base64-encoded (UTF-8) and embedded in the .bat as echo
 * lines decoded by certutil at runtime.  Double-clicking the .bat runs without
 * any execution-policy prompt because we invoke powershell.exe ourselves with
 * -ExecutionPolicy Bypass.
 */
export function makeBatWrapper(psScript: string, _modelName: string): string {
  // Encode the full PS install script as UTF-8 base64, split into 76-char echo lines.
  // Base64 alphabet (A-Z a-z 0-9 + / =) contains no cmd.exe metacharacters, so
  // plain echo is safe here.
  const bytes  = new TextEncoder().encode(psScript);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const b64    = btoa(binary);
  const echos  = (b64.match(/.{1,76}/g) ?? []).map((l) => `echo ${l}`).join('\r\n');

  // Decode step: read $env:BF (temp .b64 file), strip non-base64 chars, decode,
  // prepend UTF-8 BOM, and write to $env:PF (temp .ps1).
  // Using -EncodedCommand (UTF-16LE base64) avoids ALL cmd.exe quoting fragility —
  // no nested quote contexts, no %var% expansion inside powershell strings.
  // BF and PF are set as cmd env vars and are visible to PowerShell as $env:BF/$env:PF.
  const decodePs = `$b=([IO.File]::ReadAllText($env:BF) -replace '[^A-Za-z0-9+/=]','');` +
                   `[IO.File]::WriteAllBytes($env:PF,[Text.Encoding]::UTF8.GetPreamble()+[Convert]::FromBase64String($b))`;
  const utf16le  = Array.from(decodePs).flatMap(c => {
    const code = c.charCodeAt(0);
    return [code & 0xFF, (code >> 8) & 0xFF];
  });
  const encodedCmd = btoa(String.fromCharCode(...utf16le));

  return [
    '@echo off',
    'title YODA Installer',           // no user data in title — avoids metachar issues
    'setlocal',
    'set "BF=%TEMP%\\yoda_%RANDOM%.b64"',
    'set "PF=%TEMP%\\yoda_%RANDOM%.ps1"',
    '(',
    echos,
    ') > "%BF%"',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedCmd}`,
    'del "%BF%" 2>nul',
    'if not exist "%PF%" ( echo ERROR: Failed to decode installer script. & pause & exit /b 1 )',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PF%"',
    'del "%PF%" 2>nul',
    'pause',
  ].join('\r\n') + '\r\n';
}

// ── Shared bash helpers (embedded verbatim in every bash script) ───────────────

const BASH_FIND_LLAMA = `
# Find llama-server in known locations
_find_llama_server() {
  local candidates=(
    "$(command -v llama-server 2>/dev/null || true)"
    "$HOME/.local/bin/llama-server"
    "/usr/local/bin/llama-server"
    "/opt/homebrew/bin/llama-server"
    "$(find "$HOME/llama.cpp" -name "llama-server" -type f 2>/dev/null | head -1 || true)"
  )
  for c in "\${candidates[@]}"; do
    [[ -n "$c" && -x "$c" ]] && { echo "$c"; return 0; }
  done
  return 1
}`.trim();

// ── Install scripts (full: llama-server + PlenumNET + model download) ─────────

export function makeBashInstallScript(
  modelName : string,
  ggufRepo  : string,
  ggufFile  : string,
  port      : number,
  token     : string,
  crsUrl    : string,
): string {
  return `#!/usr/bin/env bash
# YODA Self-Host Installer
# Model: ${modelName}  |  Port: ${port}  |  Token: ${token}
set -euo pipefail

SESSION_TOKEN="${token}"
CRS_URL="${crsUrl}"
GGUF_REPO="${ggufRepo}"
GGUF_FILE="${ggufFile}"
SERVER_PORT="${port}"
PLENUMNET_DIR="\$HOME/PlenumNET"
MODELS_DIR="\$HOME/yoda-models"
MODEL_PATH="\$MODELS_DIR/\$GGUF_FILE"
LOG_DIR="\$HOME/yoda-models/logs"
IDENTITY_DIR="\$HOME/.plenumnet/identity"

echo "=== YODA Self-Host Installer ==="
echo "Model  : ${modelName}"
echo "Port   : \$SERVER_PORT"
echo ""

# ── 1. Detect local IP ────────────────────────────────────────────────
OS=\$(uname -s)
if [[ "\$OS" == "Darwin" ]]; then
  LOCAL_IP=\$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
else
  LOCAL_IP=\$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if(\$i=="src") print \$(i+1)}' | head -1)
  [[ -z "\$LOCAL_IP" ]] && LOCAL_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}')
fi
LOCAL_IP=\${LOCAL_IP:-"0.0.0.0"}
CUBE_ENDPOINT="\${LOCAL_IP}:51820"
echo "Local endpoint : \$CUBE_ENDPOINT"
[[ "\$LOCAL_IP" == "0.0.0.0" ]] && echo "  ⚠ Could not detect local IP — routing may not work."

# ── 2. Check / install Rust ───────────────────────────────────────────
echo ""
echo "Checking Rust/Cargo..."
if ! command -v cargo &>/dev/null && [[ ! -f "\$HOME/.cargo/bin/cargo" ]]; then
  echo "  → Rust not found — installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
  echo "  ✓ Rust installed"
else
  echo "  → Cargo already present"
fi
# Always ensure cargo is on PATH for this session
[[ -f "\$HOME/.cargo/env" ]] && source "\$HOME/.cargo/env"
export PATH="\$HOME/.cargo/bin:\$PATH"
if ! command -v cargo &>/dev/null; then
  echo "  ✗ cargo still not found after install — check rustup completed cleanly."
  exit 1
fi

# ── 3. Check Git ──────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo "  ✗ Git is not installed."
  if [[ "\$OS" == "Darwin" ]]; then
    echo "  → Run: brew install git"
  else
    echo "  → Run: sudo apt install git  (or equivalent for your distro)"
  fi
  exit 1
fi

# ── 4. Clone/update PlenumNET and build daemon ────────────────────────
echo ""
echo "Installing PlenumNET (inter-cube)..."
if [[ -d "\$PLENUMNET_DIR/.git" ]]; then
  echo "  → Repository exists, updating..."
  git -C "\$PLENUMNET_DIR" pull --ff-only 2>/dev/null || true
else
  echo "  → Cloning PlenumNET..."
  git clone \\
    --depth 1 \\
    --filter=blob:none \\
    --sparse \\
    https://github.com/SigmaWolf-8/Ternary \\
    "\$PLENUMNET_DIR"
  git -C "\$PLENUMNET_DIR" sparse-checkout set inter-cube ternary-math
fi

# Check each required workspace Cargo.toml individually — fetch that path if missing.
# In a partial clone (--filter=blob:none) sparse-checkout add + explicit fetch
# is required to pull blobs that were never downloaded in a previous sparse clone.
for member in "inter-cube/Cargo.toml" "ternary-math/Cargo.toml"; do
  dir="\${member%%/*}"
  if [[ ! -f "\$PLENUMNET_DIR/\$member" ]]; then
    echo "  → \$member missing — fetching from remote..."
    git -C "\$PLENUMNET_DIR" sparse-checkout add "\$dir" 2>/dev/null || true
    git -C "\$PLENUMNET_DIR" fetch --filter=blob:none origin 2>/dev/null || true
    git -C "\$PLENUMNET_DIR" checkout origin/HEAD -- "\$dir" 2>/dev/null || true
    if [[ ! -f "\$PLENUMNET_DIR/\$member" ]]; then
      echo "  ✗ \$member still missing after fetch — delete \$PLENUMNET_DIR and re-run."
      exit 1
    fi
    echo "  ✓ \$dir fetched"
  fi
done

echo "  → Building inter-cube daemon (first build takes a few minutes)..."
mkdir -p "\$LOG_DIR"
(cd "\$PLENUMNET_DIR" && cargo build --release --package inter-cube)
DAEMON=\$(find "\$PLENUMNET_DIR/target/release" -maxdepth 1 -name "inter-cube*" ! -name "*.d" -type f 2>/dev/null | head -1)
[[ -n "\$DAEMON" && -x "\$DAEMON" ]] || { echo "  ✗ Build completed but no inter-cube binary found in \$PLENUMNET_DIR/target/release"; exit 1; }
echo "  ✓ Daemon built: \$DAEMON"

# ── 5. Identity passphrase + PT26-DSA keygen ─────────────────────────
echo ""
echo "Setting up PlenumNET identity..."
mkdir -p "\$IDENTITY_DIR"
chmod 700 "\$IDENTITY_DIR"
PASSPHRASE_FILE="\$IDENTITY_DIR/.passphrase"

if [[ -f "\$PASSPHRASE_FILE" ]]; then
  CUBE_PASSPHRASE=\$(cat "\$PASSPHRASE_FILE")
  echo "  → Loaded existing identity passphrase"
else
  # openssl preferred; python fallbacks avoid tr|head SIGPIPE under set -o pipefail
  CUBE_PASSPHRASE=\$(openssl rand -hex 24 2>/dev/null \
    || python3 -c "import os,sys; sys.stdout.write(os.urandom(24).hex())" 2>/dev/null \
    || python  -c "import os,binascii,sys; sys.stdout.write(binascii.hexlify(os.urandom(24)).decode())" 2>/dev/null \
    || echo "")
  printf '%s' "\$CUBE_PASSPHRASE" > "\$PASSPHRASE_FILE"
  chmod 600 "\$PASSPHRASE_FILE"
  echo "  ✓ Generated and saved identity passphrase"
fi
export CUBE_IDENTITY_PASSPHRASE="\$CUBE_PASSPHRASE"

echo "  → Generating PT26-DSA identity keypair..."
PUB_KEY=\$(CUBE_MODE=keygen "\$DAEMON" 2>"\$LOG_DIR/keygen.log" | tail -1 | tr -d '[:space:]')
[[ -n "\$PUB_KEY" ]] || { echo "  ✗ keygen produced no output — check \$LOG_DIR/keygen.log"; exit 1; }
echo "  ✓ Public key: \${PUB_KEY:0:16}..."

# ── 6. Install llama.cpp (llama-server) ──────────────────────────────
echo ""
echo "Installing llama.cpp..."
${BASH_FIND_LLAMA}

LLAMA_SERVER=\$(_find_llama_server || true)
if [[ -n "\$LLAMA_SERVER" ]]; then
  echo "  → llama-server already installed: \$LLAMA_SERVER"
else
  if [[ "\$OS" == "Darwin" ]]; then
    brew install llama.cpp
    LLAMA_SERVER=\$(command -v llama-server)
  else
    LLAMA_VER=\$(curl -sf "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
    [[ -z "\$LLAMA_VER" ]] && { echo "  ✗ Could not fetch llama.cpp release info."; exit 1; }
    LLAMA_URL="https://github.com/ggerganov/llama.cpp/releases/download/\${LLAMA_VER}/llama-\${LLAMA_VER}-bin-ubuntu-x64.zip"
    echo "  → Downloading llama.cpp \$LLAMA_VER..."
    curl -fL "\$LLAMA_URL" -o /tmp/llamacpp.zip
    mkdir -p "\$HOME/llama.cpp"
    unzip -o /tmp/llamacpp.zip -d "\$HOME/llama.cpp" >/dev/null
    rm -f /tmp/llamacpp.zip
    LLAMA_BIN=\$(find "\$HOME/llama.cpp" -name "llama-server" -type f | head -1)
    [[ -z "\$LLAMA_BIN" ]] && { echo "  ✗ llama-server binary not found after extraction."; exit 1; }
    mkdir -p "\$HOME/.local/bin"
    cp "\$LLAMA_BIN" "\$HOME/.local/bin/llama-server"
    chmod +x "\$HOME/.local/bin/llama-server"
    LLAMA_SERVER="\$HOME/.local/bin/llama-server"
    export PATH="\$HOME/.local/bin:\$PATH"
  fi
fi
echo "  ✓ llama-server: \$LLAMA_SERVER"

# ── 7. Register with YODA CRS (with retry) ────────────────────────────
echo ""
echo "Registering with YODA CRS..."
REG_OK=0
for attempt in 1 2 3; do
  HTTP=\$(curl -s -o /dev/null -w "%{http_code}" -X POST "\${CRS_URL}/api/salvi/inter-cube/crs/register" \\
    -H "Content-Type: application/json" \\
    -d '{"endpoint":"'\$CUBE_ENDPOINT'","publicKey":"'\$PUB_KEY'","sessionToken":"'\$SESSION_TOKEN'"}' || echo "000")
  if [[ "\$HTTP" == "200" || "\$HTTP" == "201" ]]; then
    REG_OK=1; break
  fi
  echo "  Attempt \$attempt failed (HTTP \$HTTP) — retrying in 3s..."
  sleep 3
done
[[ "\$REG_OK" == "1" ]] || { echo "  ✗ CRS registration failed after 3 attempts."; exit 1; }
echo "  ✓ Registered with YODA CRS"

# ── 8. Download GGUF model ───────────────────────────────────────────
echo ""
echo "Downloading model: \$GGUF_FILE"
echo "  Source : https://huggingface.co/\$GGUF_REPO"
echo "  Dest   : \$MODEL_PATH"
mkdir -p "\$MODELS_DIR"
if [[ -f "\$MODEL_PATH" && -s "\$MODEL_PATH" ]]; then
  echo "  → Already downloaded (\$(du -sh "\$MODEL_PATH" | cut -f1)), skipping"
else
  echo "  (This may be several GB — download resumes automatically if interrupted)"
  # -C - resumes an interrupted download; exits 0 if already complete
  curl -fL --progress-bar -C - \\
    "https://huggingface.co/\${GGUF_REPO}/resolve/main/\${GGUF_FILE}" \\
    -o "\$MODEL_PATH" || {
      echo "  ✗ Download failed."
      [[ -f "\$MODEL_PATH" && ! -s "\$MODEL_PATH" ]] && rm -f "\$MODEL_PATH"
      exit 1
    }
fi
[[ -s "\$MODEL_PATH" ]] || { echo "  ✗ Model file is empty after download."; exit 1; }
echo "  ✓ Model ready (\$(du -sh "\$MODEL_PATH" | cut -f1))"

# ── 9. Start llama-server ─────────────────────────────────────────────
echo ""
echo "Starting llama-server on port \$SERVER_PORT..."
pkill -f "llama-server.*\$SERVER_PORT" 2>/dev/null || true
sleep 1
nohup "\$LLAMA_SERVER" \\
  --model "\$MODEL_PATH" \\
  --port "\$SERVER_PORT" \\
  --host 0.0.0.0 \\
  -c 4096 \\
  --parallel 4 \\
  -ngl 99 \\
  --log-disable \\
  >> "\$LOG_DIR/llama-server-\${SERVER_PORT}.log" 2>&1 &
SERVER_PID=\$!
echo "  ✓ llama-server started (PID \$SERVER_PID) — log: \$LOG_DIR/llama-server-\${SERVER_PORT}.log"
sleep 2

# ── 10. Start PlenumNET tunnel daemon ─────────────────────────────────
echo ""
echo "Starting PlenumNET tunnel daemon..."
pkill -f "inter-cube-daemon" 2>/dev/null || true
sleep 1
export CUBE_MODE=cube
export CUBE_CRS_URL="\$CRS_URL"
export CUBE_ENDPOINT="\$CUBE_ENDPOINT"
export CUBE_SESSION_TOKEN="\$SESSION_TOKEN"
export CUBE_ROLE=inference
nohup "\$DAEMON" >> "\$LOG_DIR/intercube.log" 2>&1 &
DAEMON_PID=\$!
echo "  ✓ Daemon started (PID \$DAEMON_PID) — log: \$LOG_DIR/intercube.log"

echo ""
echo "=============================="
echo "  Setup complete!"
echo "  Model  : ${modelName}"
echo "  Server : http://localhost:\$SERVER_PORT  (OpenAI-compatible)"
echo "  Tunnel : \$CUBE_ENDPOINT → YODA CRS"
echo "=============================="
echo ""
echo "Both processes run in the background — they survive terminal close."
echo "Logs : \$LOG_DIR/"
echo "Use the Connect button in YODA to reconnect after reboot."
`;
}

export function makePsInstallScript(
  modelName : string,
  ggufRepo  : string,
  ggufFile  : string,
  port      : number,
  token     : string,
  crsUrl    : string,
): string {
  return `# YODA Self-Host Installer (Windows)
# Model: ${modelName}  |  Port: ${port}  |  Token: ${token}
$ErrorActionPreference = "Stop"
trap {
  Write-Host ""
  Write-Host "=== INSTALLER ERROR ===" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  break
}

$SESSION_TOKEN = "${token}"
$CRS_URL       = "${crsUrl}"
$GGUF_REPO     = "${ggufRepo}"
$GGUF_FILE     = "${ggufFile}"
$SERVER_PORT   = ${port}
$MODELS_DIR    = "$env:USERPROFILE\\yoda-models"
$MODEL_PATH    = "$MODELS_DIR\\$GGUF_FILE"
$LOG_DIR       = "$MODELS_DIR\\logs"
$LLAMA_DIR     = "$env:USERPROFILE\\llama.cpp"
$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"
$IDENTITY_DIR  = "$env:USERPROFILE\\.plenumnet\\identity"
# $DAEMON_PATH is resolved after build (binary name may be inter-cube.exe or inter-cube-daemon.exe)

Write-Host "=== YODA Self-Host Installer ===" -ForegroundColor Cyan
Write-Host "Model  : ${modelName}"
Write-Host "Port   : $SERVER_PORT"
Write-Host ""

# ── 1. Detect local IP ────────────────────────────────────────────────
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^127\\.' -and $_.IPAddress -notmatch '^169\\.254' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object @{ Expression = { switch -Wildcard ($_.InterfaceAlias) { 'Wi-Fi*' { 0 } 'Ethernet*' { 1 } default { 2 } } } } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "0.0.0.0" }
$CUBE_ENDPOINT = "$ip:51820"
Write-Host "Local endpoint : $CUBE_ENDPOINT"
if ($ip -eq "0.0.0.0") {
  Write-Host "  WARN Could not detect local IP — routing may fail." -ForegroundColor Yellow
}

# ── 2. Check / install Rust ───────────────────────────────────────────
Write-Host ""
Write-Host "Checking Rust/Cargo..."
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host "  -> Rust not found — installing rustup..."
  $rustupExe = "$env:TEMP\\rustup-init.exe"
  Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe -UseBasicParsing
  Start-Process -FilePath $rustupExe -ArgumentList "-y" -Wait -NoNewWindow
  Remove-Item $rustupExe -Force -ErrorAction SilentlyContinue
  $env:PATH += ";$env:USERPROFILE\\.cargo\\bin"
  Write-Host "  OK Rust installed"
} else {
  Write-Host "  OK Cargo already installed: $(cargo --version 2>$null)"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo not found after install — restart this script in a new terminal so PATH is refreshed."
}

# ── 3. Check Git ──────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is not installed. Install it from https://git-scm.com/download/win then re-run this installer."
}

# ── 4. Clone/update PlenumNET and build daemon ────────────────────────
Write-Host ""
Write-Host "Installing PlenumNET (inter-cube)..."
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
if (Test-Path "$PLENUMNET_DIR\\.git") {
  Write-Host "  -> Repository exists, updating..."
  git -C $PLENUMNET_DIR pull --ff-only 2>$null
} else {
  Write-Host "  -> Cloning PlenumNET..."
  git clone \`
    --depth 1 \`
    --filter=blob:none \`
    --sparse \`
    https://github.com/SigmaWolf-8/Ternary \`
    $PLENUMNET_DIR
  git -C $PLENUMNET_DIR sparse-checkout set inter-cube ternary-math
}

# Check each required workspace Cargo.toml individually.
# In a partial clone (--filter=blob:none) a path that was never in the sparse
# checkout has no local blobs — sparse-checkout add + fetch + checkout HEAD
# forces git to download and write exactly those files.
foreach ($member in @("inter-cube\Cargo.toml", "ternary-math\Cargo.toml")) {
  $memberPath = "$PLENUMNET_DIR\$member"
  if (-not (Test-Path $memberPath)) {
    $dir = ($member -split "\\")[0]
    Write-Host "  -> $member missing — fetching from remote..."
    git -C $PLENUMNET_DIR sparse-checkout add $dir 2>$null
    git -C $PLENUMNET_DIR fetch --filter=blob:none origin 2>$null
    git -C $PLENUMNET_DIR checkout origin/HEAD -- $dir 2>$null
    if (-not (Test-Path $memberPath)) {
      throw "$member still missing after fetch — delete $PLENUMNET_DIR and re-run."
    }
    Write-Host "  OK $dir fetched"
  }
}
Write-Host "  -> Building inter-cube daemon (first build takes a few minutes)..."
Push-Location $PLENUMNET_DIR
cargo build --release --package inter-cube
Pop-Location
# Locate the binary — cargo may name it inter-cube.exe or inter-cube-daemon.exe
$daemonBin = Get-ChildItem -Path "$PLENUMNET_DIR\\target\\release" -Filter "inter-cube*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "*.d" } | Select-Object -First 1
if (-not $daemonBin) {
  throw "Build completed but no inter-cube binary found in $PLENUMNET_DIR\target\release — check cargo output above for errors."
}
$DAEMON_PATH = $daemonBin.FullName
Write-Host "  OK Daemon built: $DAEMON_PATH"

# ── 5. Identity passphrase + PT26-DSA keygen ─────────────────────────
Write-Host ""
Write-Host "Setting up PlenumNET identity..."
New-Item -ItemType Directory -Force -Path $IDENTITY_DIR | Out-Null
$PASSPHRASE_FILE = "$IDENTITY_DIR\\.passphrase"

if (Test-Path $PASSPHRASE_FILE) {
  $CUBE_PASSPHRASE = (Get-Content $PASSPHRASE_FILE -Raw).Trim()
  Write-Host "  -> Loaded existing identity passphrase"
} else {
  # Use RNGCryptoServiceProvider for OS-level CSPRNG (PowerShell 5+ / Windows 10+)
  $rng   = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  $bytes = [byte[]]::new(24)
  $rng.GetBytes($bytes)
  $CUBE_PASSPHRASE = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  $rng.Dispose()
  $CUBE_PASSPHRASE | Set-Content -Path $PASSPHRASE_FILE -NoNewline
  # Restrict passphrase file to current user only
  $acl = Get-Acl $PASSPHRASE_FILE
  $acl.SetAccessRuleProtection($true, $false)
  $userRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
    "FullControl", "Allow"
  )
  $acl.SetAccessRule($userRule)
  Set-Acl $PASSPHRASE_FILE $acl
  Write-Host "  OK Generated and saved identity passphrase"
}
$env:CUBE_IDENTITY_PASSPHRASE = $CUBE_PASSPHRASE

Write-Host "  -> Generating PT26-DSA identity keypair..."
$env:CUBE_MODE = "keygen"
$keygenLog = "$LOG_DIR\\keygen.log"
$keygenOutput = & $DAEMON_PATH 2>$keygenLog
$env:CUBE_MODE = $null
$PUB_KEY = ($keygenOutput | Select-Object -Last 1).Trim()
if (-not $PUB_KEY) {
  throw "Daemon keygen produced no output — check $keygenLog for details."
}
Write-Host "  OK Public key: $($PUB_KEY.Substring(0, [Math]::Min(16, $PUB_KEY.Length)))..."

# ── 6. Install llama.cpp ──────────────────────────────────────────────
Write-Host ""
Write-Host "Installing llama.cpp..."
$llamaServer = Get-ChildItem -Path $LLAMA_DIR -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($llamaServer) {
  Write-Host "  OK llama-server.exe: $($llamaServer.FullName)"
} else {
  New-Item -ItemType Directory -Force -Path $LLAMA_DIR | Out-Null
  $release = (Invoke-RestMethod "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest").tag_name
  $zipUrl  = "https://github.com/ggerganov/llama.cpp/releases/download/$release/llama-$release-bin-win-avx2-x64.zip"
  Write-Host "  -> Downloading llama.cpp $release..."
  $zipPath = "$env:TEMP\\llamacpp.zip"
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    curl.exe -fL "$zipUrl" -o "$zipPath"
  } else {
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  }
  Expand-Archive -Path $zipPath -DestinationPath $LLAMA_DIR -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  $llamaServer = Get-ChildItem -Path $LLAMA_DIR -Recurse -Filter "llama-server.exe" | Select-Object -First 1
  if (-not $llamaServer) { throw "llama-server.exe not found after extraction — the zip may be for a different CPU architecture." }
}
$LLAMA_SERVER = $llamaServer.FullName

# ── 7. Register with YODA CRS (with retry) ────────────────────────────
Write-Host ""
Write-Host "Registering with YODA CRS..."
$regBody = ConvertTo-Json @{ endpoint = $CUBE_ENDPOINT; publicKey = $PUB_KEY; sessionToken = $SESSION_TOKEN }
$regOk = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  try {
    Invoke-RestMethod \`
      -Uri "$CRS_URL/api/salvi/inter-cube/crs/register" \`
      -Method Post -ContentType "application/json" -Body $regBody | Out-Null
    $regOk = $true; break
  } catch {
    Write-Host "  Attempt $attempt failed: $_ — retrying in 3s..."
    Start-Sleep -Seconds 3
  }
}
if (-not $regOk) { throw "CRS registration failed after 3 attempts — check your internet connection and that the YODA server is reachable." }
Write-Host "  OK Registered with YODA CRS"

# ── 8. Download GGUF model ────────────────────────────────────────────
Write-Host ""
Write-Host "Downloading model: $GGUF_FILE"
Write-Host "  Source : https://huggingface.co/$GGUF_REPO"
Write-Host "  Dest   : $MODEL_PATH"
New-Item -ItemType Directory -Force -Path $MODELS_DIR | Out-Null
if ((Test-Path $MODEL_PATH) -and (Get-Item $MODEL_PATH).Length -gt 0) {
  $sz = [math]::Round((Get-Item $MODEL_PATH).Length / 1GB, 2)
  Write-Host "  OK Already downloaded ($sz GB), skipping"
} else {
  Write-Host "  (This may be several GB — download resumes if interrupted)"
  $modelUrl = "https://huggingface.co/$GGUF_REPO/resolve/main/$GGUF_FILE"
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    # curl.exe supports -C - for resume on Windows 10 1803+
    curl.exe -fL -C - --progress-bar "$modelUrl" -o "$MODEL_PATH"
  } else {
    # Fallback: BITS transfer (supports auto-resume)
    try {
      Start-BitsTransfer -Source $modelUrl -Destination $MODEL_PATH -Priority Normal
    } catch {
      Write-Host "  -> BITS unavailable, falling back to direct download..."
      $wc = New-Object System.Net.WebClient
      $wc.DownloadFile($modelUrl, $MODEL_PATH)
    }
  }
}
if (-not (Test-Path $MODEL_PATH) -or (Get-Item $MODEL_PATH).Length -eq 0) {
  throw "Model file missing or empty after download — check your internet connection and disk space."
}
$modelSz = [math]::Round((Get-Item $MODEL_PATH).Length / 1GB, 2)
Write-Host "  OK Model ready ($modelSz GB)"

# ── 9. Start llama-server ─────────────────────────────────────────────
Write-Host ""
Write-Host "Starting llama-server on port $SERVER_PORT..."
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$serverOutLog = "$LOG_DIR\\llama-server-$SERVER_PORT-out.log"
$serverErrLog = "$LOG_DIR\\llama-server-$SERVER_PORT-err.log"
$serverProc = Start-Process -FilePath $LLAMA_SERVER \`
  -ArgumentList "--model \`"$MODEL_PATH\`" --port $SERVER_PORT --host 0.0.0.0 -c 4096 --parallel 4 -ngl 99 --log-disable" \`
  -NoNewWindow -PassThru -RedirectStandardOutput $serverOutLog -RedirectStandardError $serverErrLog
Write-Host "  OK llama-server started (PID $($serverProc.Id)) — log: $serverOutLog"
Start-Sleep -Seconds 2

# ── 10. Start PlenumNET tunnel daemon ─────────────────────────────────
Write-Host ""
Write-Host "Starting PlenumNET tunnel daemon..."
Get-Process | Where-Object { $_.Name -like "inter-cube*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$env:CUBE_MODE          = "cube"
$env:CUBE_CRS_URL       = $CRS_URL
$env:CUBE_ENDPOINT      = $CUBE_ENDPOINT
$env:CUBE_SESSION_TOKEN = $SESSION_TOKEN
$env:CUBE_ROLE          = "inference"
$daemonOutLog = "$LOG_DIR\\intercube-out.log"
$daemonErrLog = "$LOG_DIR\\intercube-err.log"
$daemonProc = Start-Process -FilePath $DAEMON_PATH \`
  -NoNewWindow -PassThru -RedirectStandardOutput $daemonOutLog -RedirectStandardError $daemonErrLog
Write-Host "  OK Daemon started (PID $($daemonProc.Id)) — log: $daemonOutLog"

Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Model  : ${modelName}" -ForegroundColor Green
Write-Host "  Server : http://localhost:$SERVER_PORT  (OpenAI-compatible)" -ForegroundColor Green
Write-Host "  Tunnel : $CUBE_ENDPOINT -> YODA CRS" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""
Write-Host "Both processes run in the background." -ForegroundColor Yellow
Write-Host "Logs: $LOG_DIR" -ForegroundColor Yellow
Write-Host "Use the Connect button in YODA to reconnect after reboot."
`;
}

// ── Reconnect scripts (skip install — just restart both processes) ─────────────

export function makeBashReconnectScript(
  modelName : string,
  ggufFile  : string,
  port      : number,
  token     : string,
  crsUrl    : string,
): string {
  return `#!/usr/bin/env bash
# YODA Reconnect
# Model: ${modelName}  |  Port: ${port}  |  Token: ${token}
set -euo pipefail

SESSION_TOKEN="${token}"
CRS_URL="${crsUrl}"
GGUF_FILE="${ggufFile}"
SERVER_PORT="${port}"
PLENUMNET_DIR="\$HOME/PlenumNET"
MODELS_DIR="\$HOME/yoda-models"
MODEL_PATH="\$MODELS_DIR/\$GGUF_FILE"
DAEMON="\$PLENUMNET_DIR/target/release/inter-cube-daemon"
LOG_DIR="\$HOME/yoda-models/logs"
IDENTITY_DIR="\$HOME/.plenumnet/identity"

echo "=== YODA Reconnect ==="
echo "Model : ${modelName}"
echo "Port  : \$SERVER_PORT"
echo ""

# ── Preflight checks ──────────────────────────────────────────────────
[[ -x "\$DAEMON" ]] || { echo "  ✗ PlenumNET daemon not found. Run the Install script first."; exit 1; }
[[ -s "\$MODEL_PATH" ]] || { echo "  ✗ Model file not found or empty. Run the Install script first."; exit 1; }

# ── Find llama-server ─────────────────────────────────────────────────
${BASH_FIND_LLAMA}
LLAMA_SERVER=\$(_find_llama_server || true)
if [[ -z "\$LLAMA_SERVER" ]]; then
  echo "  ✗ llama-server not found. Run the Install script first."
  exit 1
fi
echo "  ✓ llama-server: \$LLAMA_SERVER"

# ── Detect IP ─────────────────────────────────────────────────────────
OS=\$(uname -s)
if [[ "\$OS" == "Darwin" ]]; then
  LOCAL_IP=\$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
else
  LOCAL_IP=\$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if(\$i=="src") print \$(i+1)}' | head -1)
  [[ -z "\$LOCAL_IP" ]] && LOCAL_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}')
fi
LOCAL_IP=\${LOCAL_IP:-"0.0.0.0"}
CUBE_ENDPOINT="\${LOCAL_IP}:51820"

# ── Load identity passphrase ──────────────────────────────────────────
PASSPHRASE_FILE="\$IDENTITY_DIR/.passphrase"
if [[ -f "\$PASSPHRASE_FILE" ]]; then
  export CUBE_IDENTITY_PASSPHRASE=\$(cat "\$PASSPHRASE_FILE")
  echo "  ✓ Identity passphrase loaded"
else
  echo "  ⚠ No passphrase file found at \$PASSPHRASE_FILE — daemon will use hostname-derived fallback."
  echo "    If the daemon fails to start, run the Install script again to regenerate identity."
fi

# ── Restart llama-server ──────────────────────────────────────────────
mkdir -p "\$LOG_DIR"
pkill -f "llama-server.*\$SERVER_PORT" 2>/dev/null || true
sleep 1
nohup "\$LLAMA_SERVER" \\
  --model "\$MODEL_PATH" \\
  --port "\$SERVER_PORT" \\
  --host 0.0.0.0 \\
  -c 4096 \\
  --parallel 4 \\
  -ngl 99 \\
  --log-disable \\
  >> "\$LOG_DIR/llama-server-\${SERVER_PORT}.log" 2>&1 &
echo "  ✓ llama-server started (PID \$!)"
sleep 2

# ── Restart PlenumNET daemon ──────────────────────────────────────────
# The daemon self-registers with the CRS on startup using CUBE_CRS_URL +
# CUBE_SESSION_TOKEN, so no explicit registration call is needed here.
pkill -f "inter-cube-daemon" 2>/dev/null || true
sleep 1
export CUBE_MODE=cube
export CUBE_CRS_URL="\$CRS_URL"
export CUBE_ENDPOINT="\$CUBE_ENDPOINT"
export CUBE_SESSION_TOKEN="\$SESSION_TOKEN"
export CUBE_ROLE=inference
nohup "\$DAEMON" >> "\$LOG_DIR/intercube.log" 2>&1 &
echo "  ✓ Daemon started (PID \$!)"

echo ""
echo "  Both processes running in background. YODA will update within 10s."
echo "  Logs : \$LOG_DIR/"
`;
}

export function makePsReconnectScript(
  modelName : string,
  ggufFile  : string,
  port      : number,
  token     : string,
  crsUrl    : string,
): string {
  return `# YODA Reconnect (Windows)
# Model: ${modelName}  |  Port: ${port}  |  Token: ${token}
$ErrorActionPreference = "Stop"
trap {
  Write-Host ""
  Write-Host "=== RECONNECT ERROR ===" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  break
}

$SESSION_TOKEN = "${token}"
$CRS_URL       = "${crsUrl}"
$GGUF_FILE     = "${ggufFile}"
$SERVER_PORT   = ${port}
$MODELS_DIR    = "$env:USERPROFILE\\yoda-models"
$MODEL_PATH    = "$MODELS_DIR\\$GGUF_FILE"
$LOG_DIR       = "$MODELS_DIR\\logs"
$LLAMA_DIR     = "$env:USERPROFILE\\llama.cpp"
$IDENTITY_DIR  = "$env:USERPROFILE\\.plenumnet\\identity"

# Locate PlenumNET daemon (binary may be inter-cube.exe or inter-cube-daemon.exe)
$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"
if (-not (Test-Path "$PLENUMNET_DIR\\target\\release")) {
  if (Test-Path "C:\\PlenumNET\\target\\release") { $PLENUMNET_DIR = "C:\\PlenumNET" }
}
$daemonBin = Get-ChildItem -Path "$PLENUMNET_DIR\\target\\release" -Filter "inter-cube*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "*.d" } | Select-Object -First 1
$DAEMON_PATH = if ($daemonBin) { $daemonBin.FullName } else { "" }

Write-Host "=== YODA Reconnect ===" -ForegroundColor Cyan
Write-Host "Model : ${modelName}"
Write-Host "Port  : $SERVER_PORT"
Write-Host ""

# ── Preflight checks ──────────────────────────────────────────────────
if (-not $DAEMON_PATH -or -not (Test-Path $DAEMON_PATH)) {
  throw "PlenumNET daemon not found in $PLENUMNET_DIR\target\release — run the Install script first (Settings -> AI Engines -> Install)."
}
if (-not (Test-Path $MODEL_PATH) -or (Get-Item $MODEL_PATH).Length -eq 0) {
  throw "Model not found or empty at $MODEL_PATH — run the Install script first."
}
$llamaServer = Get-ChildItem -Path $LLAMA_DIR -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $llamaServer) {
  throw "llama-server.exe not found in $LLAMA_DIR — run the Install script first."
}
$LLAMA_SERVER = $llamaServer.FullName
Write-Host "  OK llama-server: $LLAMA_SERVER"

# ── Detect IP ─────────────────────────────────────────────────────────
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^127\\.' -and $_.IPAddress -notmatch '^169\\.254' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object @{ Expression = { switch -Wildcard ($_.InterfaceAlias) { 'Wi-Fi*' { 0 } 'Ethernet*' { 1 } default { 2 } } } } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "0.0.0.0" }
$CUBE_ENDPOINT = "$ip:51820"
Write-Host "  Local endpoint : $CUBE_ENDPOINT"

# ── Load identity passphrase ──────────────────────────────────────────
$PASSPHRASE_FILE = "$IDENTITY_DIR\\.passphrase"
if (Test-Path $PASSPHRASE_FILE) {
  $env:CUBE_IDENTITY_PASSPHRASE = (Get-Content $PASSPHRASE_FILE -Raw).Trim()
  Write-Host "  OK Identity passphrase loaded"
} else {
  Write-Host "  WARN No passphrase file at $PASSPHRASE_FILE — daemon will use hostname-derived fallback." -ForegroundColor Yellow
  Write-Host "       If daemon fails, run the Install script to regenerate identity." -ForegroundColor Yellow
}

# ── Restart llama-server ──────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$serverLog  = "$LOG_DIR\\llama-server-$SERVER_PORT.log"
$serverProc = Start-Process -FilePath $LLAMA_SERVER \`
  -ArgumentList "--model \`"$MODEL_PATH\`" --port $SERVER_PORT --host 0.0.0.0 -c 4096 --parallel 4 -ngl 99 --log-disable" \`
  -NoNewWindow -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverLog
Write-Host "  OK llama-server started (PID $($serverProc.Id)) — log: $serverLog"
Start-Sleep -Seconds 2

# ── Restart PlenumNET daemon ──────────────────────────────────────────
# The daemon self-registers with the CRS on startup using CUBE_CRS_URL +
# CUBE_SESSION_TOKEN, so no explicit registration call is needed here.
Get-Process | Where-Object { $_.Name -like "inter-cube*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$env:CUBE_MODE          = "cube"
$env:CUBE_CRS_URL       = $CRS_URL
$env:CUBE_ENDPOINT      = $CUBE_ENDPOINT
$env:CUBE_SESSION_TOKEN = $SESSION_TOKEN
$env:CUBE_ROLE          = "inference"
$daemonOutLog = "$LOG_DIR\\intercube-out.log"
$daemonErrLog = "$LOG_DIR\\intercube-err.log"
$daemonProc = Start-Process -FilePath $DAEMON_PATH \`
  -NoNewWindow -PassThru -RedirectStandardOutput $daemonOutLog -RedirectStandardError $daemonErrLog
Write-Host "  OK Daemon started (PID $($daemonProc.Id)) — log: $daemonOutLog"

Write-Host ""
Write-Host "  Both processes running in background. YODA will update within 10s." -ForegroundColor Green
Write-Host "  Logs: $LOG_DIR" -ForegroundColor Yellow
`;
}
