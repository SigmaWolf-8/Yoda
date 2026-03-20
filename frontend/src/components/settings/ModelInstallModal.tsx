import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Copy,
  Download,
  Check,
  Loader2,
  AlertTriangle,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { GGUF_INFO } from './EngineSlot';

// ── Types ──────────────────────────────────────────────────────────────────────

type OS = 'bash' | 'powershell';

type PollingState =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'connected'; address: string }
  | { phase: 'timeout' }
  | { phase: 'error'; message: string };

interface Props {
  modelName: string;
  port?: number;
  onClose: () => void;
  mode?: 'install' | 'connect';
}

// ── Script generators ─────────────────────────────────────────────────────────
// NOTE: Inside these template literals, bash/PowerShell variable references
// that use ${VAR} syntax MUST be escaped as \${VAR} so TypeScript does not
// treat them as template expressions. PowerShell backtick continuations are
// written as \` (escaped backtick) so they don't close the TS template.

function makeBashScript(
  modelName: string,
  ggufRepo: string,
  ggufFile: string,
  port: number,
  sessionToken: string,
  crsUrl: string,
): string {
  return `#!/usr/bin/env bash
# YODA — llama-server + PlenumNET installer
# Model: ${modelName}  |  Port: ${port}  |  Token: ${sessionToken}
set -euo pipefail

SESSION_TOKEN="${sessionToken}"
CRS_URL="${crsUrl}"
GGUF_REPO="${ggufRepo}"
GGUF_FILE="${ggufFile}"
SERVER_PORT="${port}"
PLENUMNET_DIR="\$HOME/PlenumNET"
MODELS_DIR="\$HOME/yoda-models"
MODEL_PATH="\$MODELS_DIR/\$GGUF_FILE"

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
[[ "\$LOCAL_IP" == "0.0.0.0" ]] && echo "  ⚠ Could not detect local IP — routing may not work correctly."

# ── 2. Install llama.cpp (llama-server) ──────────────────────────────
echo ""
echo "Installing llama.cpp..."
if command -v llama-server &>/dev/null; then
  echo "  → llama-server already installed"
else
  if [[ "\$OS" == "Darwin" ]]; then
    brew install llama.cpp
  else
    LLAMA_VER=\$(curl -sf "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
    LLAMA_URL="https://github.com/ggerganov/llama.cpp/releases/download/\${LLAMA_VER}/llama-\${LLAMA_VER}-bin-ubuntu-x64.zip"
    echo "  → Downloading llama.cpp \$LLAMA_VER..."
    curl -L "\$LLAMA_URL" -o /tmp/llamacpp.zip
    mkdir -p "\$HOME/llama.cpp"
    unzip -o /tmp/llamacpp.zip -d "\$HOME/llama.cpp" >/dev/null
    LLAMA_BIN=\$(find "\$HOME/llama.cpp" -name "llama-server" -type f | head -1)
    mkdir -p "\$HOME/.local/bin"
    cp "\$LLAMA_BIN" "\$HOME/.local/bin/llama-server"
    chmod +x "\$HOME/.local/bin/llama-server"
    export PATH="\$HOME/.local/bin:\$PATH"
  fi
fi
echo "  ✓ llama-server ready"

# ── 3. Download GGUF model ───────────────────────────────────────────
echo ""
echo "Downloading model: \$GGUF_FILE"
echo "  Source : https://huggingface.co/\$GGUF_REPO"
echo "  Dest   : \$MODEL_PATH"
echo "  (This may be several GB — please wait)"
mkdir -p "\$MODELS_DIR"
if [[ -f "\$MODEL_PATH" ]]; then
  echo "  → Already downloaded, skipping"
else
  curl -L --progress-bar \\
    "https://huggingface.co/\${GGUF_REPO}/resolve/main/\${GGUF_FILE}" \\
    -o "\$MODEL_PATH"
fi
echo "  ✓ Model ready"

# ── 4. Install PlenumNET daemon ───────────────────────────────────────
echo ""
echo "Installing PlenumNET (inter-cube)..."
if [[ -d "\$PLENUMNET_DIR" ]]; then
  echo "  → Directory exists, pulling latest..."
  git -C "\$PLENUMNET_DIR" pull --ff-only || true
else
  git clone https://github.com/SigmaWolf-8/Ternary "\$PLENUMNET_DIR"
fi
echo "  → Building inter-cube daemon (a few minutes)..."
cd "\$PLENUMNET_DIR"
cargo build --release --package inter-cube
DAEMON="\$PLENUMNET_DIR/target/release/inter-cube-daemon"
echo "  ✓ Daemon built"

# ── 5. Register with YODA CRS ─────────────────────────────────────────
echo ""
echo "Registering with YODA CRS..."
if [[ "\$OS" == "Darwin" ]]; then
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | shasum -a 256 | cut -d' ' -f1)
else
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | sha256sum | cut -d' ' -f1)
fi
curl -sf -X POST "\${CRS_URL}/api/salvi/inter-cube/crs/register" \\
  -H "Content-Type: application/json" \\
  -d '{"endpoint":"'\$CUBE_ENDPOINT'","publicKey":"'\$PUB_KEY'","sessionToken":"'\$SESSION_TOKEN'"}' \\
  > /dev/null || { echo "  ✗ Registration failed. Check your internet connection."; exit 1; }
echo "  ✓ Registered with YODA CRS"

# ── 6. Start llama-server ─────────────────────────────────────────────
echo ""
echo "Starting llama-server on port \$SERVER_PORT..."
pkill -f "llama-server.*\$SERVER_PORT" 2>/dev/null || true
sleep 0.5
llama-server \\
  --model "\$MODEL_PATH" \\
  --port "\$SERVER_PORT" \\
  --host 0.0.0.0 \\
  -c 4096 \\
  --parallel 4 \\
  -ngl 99 \\
  --log-disable &
SERVER_PID=\$!
echo "  ✓ llama-server started (PID \$SERVER_PID)"
sleep 2

# ── 7. Start PlenumNET tunnel daemon ──────────────────────────────────
echo ""
echo "Starting PlenumNET tunnel daemon..."
pkill -f "inter-cube-daemon" 2>/dev/null || true
sleep 0.5
CUBE_MODE=cube \\
CUBE_CRS_URL="\$CRS_URL" \\
CUBE_ENDPOINT="\$CUBE_ENDPOINT" \\
CUBE_SESSION_TOKEN="\$SESSION_TOKEN" \\
CUBE_ROLE=inference \\
"\$DAEMON" &
echo "  ✓ Daemon started (PID \$!)"

# ── 8. Done ───────────────────────────────────────────────────────────
echo ""
echo "=============================="
echo "  Setup complete!"
echo "  Model  : ${modelName}"
echo "  Server : http://localhost:\$SERVER_PORT  (OpenAI-compatible)"
echo "  Tunnel : \$CUBE_ENDPOINT → YODA CRS"
echo "=============================="
echo ""
echo "In YODA Settings, set this engine's Endpoint to:"
echo "  http://localhost:\$SERVER_PORT"
echo ""
echo "NOTE: Both processes stop when this terminal closes."
echo "Use the Connect script to restart after reboot."
`;
}

function makePsScript(
  modelName: string,
  ggufRepo: string,
  ggufFile: string,
  port: number,
  sessionToken: string,
  crsUrl: string,
): string {
  return `# YODA — llama-server + PlenumNET installer (Windows)
# Model: ${modelName}  |  Port: ${port}  |  Token: ${sessionToken}
$ErrorActionPreference = "Stop"

$SESSION_TOKEN = "${sessionToken}"
$CRS_URL       = "${crsUrl}"
$GGUF_REPO     = "${ggufRepo}"
$GGUF_FILE     = "${ggufFile}"
$SERVER_PORT   = ${port}
$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"
$MODELS_DIR    = "$env:USERPROFILE\\yoda-models"
$MODEL_PATH    = "$MODELS_DIR\\$GGUF_FILE"
$LLAMA_DIR     = "$env:USERPROFILE\\llama.cpp"

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
Write-Host "Checking Rust..."
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host "  -> Rust not found — installing rustup..."
  $rustupExe = "$env:TEMP\\rustup-init.exe"
  Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe
  Start-Process -FilePath $rustupExe -ArgumentList "-y" -Wait -NoNewWindow
  $env:PATH += ";$env:USERPROFILE\\.cargo\\bin"
  Write-Host "  OK Rust installed"
} else {
  Write-Host "  OK Rust already installed"
}

# ── 3. Check Git ──────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git not found. Install Git for Windows:" -ForegroundColor Yellow
  Write-Host "  https://git-scm.com/download/win" -ForegroundColor Cyan
  exit 1
}

# ── 4. Install llama.cpp (llama-server.exe) ───────────────────────────
Write-Host ""
Write-Host "Installing llama.cpp..."
$llamaServer = Get-ChildItem -Path $LLAMA_DIR -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($llamaServer) {
  Write-Host "  -> llama-server.exe already installed"
} else {
  New-Item -ItemType Directory -Force -Path $LLAMA_DIR | Out-Null
  $release = (Invoke-RestMethod "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest").tag_name
  $zipUrl  = "https://github.com/ggerganov/llama.cpp/releases/download/$release/llama-$release-bin-win-avx2-x64.zip"
  Write-Host "  -> Downloading llama.cpp $release..."
  Invoke-WebRequest -Uri $zipUrl -OutFile "$env:TEMP\\llamacpp.zip"
  Expand-Archive -Path "$env:TEMP\\llamacpp.zip" -DestinationPath $LLAMA_DIR -Force
  $llamaServer = Get-ChildItem -Path $LLAMA_DIR -Recurse -Filter "llama-server.exe" | Select-Object -First 1
}
$LLAMA_SERVER = $llamaServer.FullName
Write-Host "  OK llama-server ready: $LLAMA_SERVER"

# ── 5. Download GGUF model ────────────────────────────────────────────
Write-Host ""
Write-Host "Downloading model: $GGUF_FILE"
Write-Host "  Source : https://huggingface.co/$GGUF_REPO"
Write-Host "  Dest   : $MODEL_PATH"
Write-Host "  (This may be several GB — please wait)"
New-Item -ItemType Directory -Force -Path $MODELS_DIR | Out-Null
if (Test-Path $MODEL_PATH) {
  Write-Host "  -> Already downloaded, skipping"
} else {
  $wc = New-Object System.Net.WebClient
  $wc.DownloadFile("https://huggingface.co/$GGUF_REPO/resolve/main/$GGUF_FILE", $MODEL_PATH)
}
Write-Host "  OK Model ready"

# ── 6. Install PlenumNET daemon ───────────────────────────────────────
Write-Host ""
Write-Host "Installing PlenumNET (inter-cube)..."
if (Test-Path $PLENUMNET_DIR) {
  Write-Host "  -> Directory exists, pulling latest..."
  git -C $PLENUMNET_DIR pull --ff-only 2>$null
} else {
  git clone https://github.com/SigmaWolf-8/Ternary $PLENUMNET_DIR
}
Write-Host "  -> Building inter-cube daemon (a few minutes)..."
Push-Location $PLENUMNET_DIR
cargo build --release --package inter-cube
Pop-Location
$DAEMON_PATH = "$PLENUMNET_DIR\\target\\release\\inter-cube-daemon.exe"
Write-Host "  OK Daemon built"

# ── 7. Register with YODA CRS ─────────────────────────────────────────
Write-Host ""
Write-Host "Registering with YODA CRS..."
$pubKey  = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
  [System.Text.Encoding]::UTF8.GetBytes($CUBE_ENDPOINT)) |
  ForEach-Object { $_.ToString("x2") }) -join ""
$regBody = ConvertTo-Json @{ endpoint = $CUBE_ENDPOINT; publicKey = $pubKey; sessionToken = $SESSION_TOKEN }
try {
  $regResp = Invoke-RestMethod \`
    -Uri "$CRS_URL/api/salvi/inter-cube/crs/register" \`
    -Method Post -ContentType "application/json" -Body $regBody
  Write-Host "  OK Registered as $($regResp.address)"
} catch {
  Write-Host "  FAIL Registration failed: $_" -ForegroundColor Red; exit 1
}

# ── 8. Start llama-server ─────────────────────────────────────────────
Write-Host ""
Write-Host "Starting llama-server on port $SERVER_PORT..."
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$serverProc = Start-Process -FilePath $LLAMA_SERVER \`
  -ArgumentList "--model \`"$MODEL_PATH\`" --port $SERVER_PORT --host 0.0.0.0 -c 4096 --parallel 4 -ngl 99 --log-disable" \`
  -NoNewWindow -PassThru
Write-Host "  OK llama-server started (PID $($serverProc.Id))"
Start-Sleep -Seconds 2

# ── 9. Start PlenumNET tunnel daemon ──────────────────────────────────
Write-Host ""
Write-Host "Starting PlenumNET tunnel daemon..."
Get-Process -Name "inter-cube-daemon" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$env:CUBE_MODE         = "cube"
$env:CUBE_CRS_URL      = $CRS_URL
$env:CUBE_ENDPOINT     = $CUBE_ENDPOINT
$env:CUBE_SESSION_TOKEN = $SESSION_TOKEN
$env:CUBE_ROLE         = "inference"
$daemonProc = Start-Process -FilePath $DAEMON_PATH -NoNewWindow -PassThru
Write-Host "  OK Daemon started (PID $($daemonProc.Id))"

# ── 10. Done ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Model  : ${modelName}" -ForegroundColor Green
Write-Host "  Server : http://localhost:$SERVER_PORT  (OpenAI-compatible)" -ForegroundColor Green
Write-Host "  Tunnel : $CUBE_ENDPOINT -> YODA CRS" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""
Write-Host "In YODA Settings, set this engine's Endpoint to:" -ForegroundColor Cyan
Write-Host "  http://localhost:$SERVER_PORT"
Write-Host ""
Write-Host "NOTE: Both processes stop when this window closes." -ForegroundColor Yellow
Write-Host "Use the Connect script to restart after reboot."
`;
}

// ── Reconnect-only scripts (no Ollama install / model pull) ──────────────────

function makeReconnectBashScript(
  modelName: string,
  ggufFile: string,
  port: number,
  sessionToken: string,
  crsUrl: string,
): string {
  return `#!/usr/bin/env bash
# YODA — llama-server + PlenumNET reconnect
# Model: ${modelName}  |  Port: ${port}  |  Token: ${sessionToken}
set -euo pipefail

SESSION_TOKEN="${sessionToken}"
CRS_URL="${crsUrl}"
GGUF_FILE="${ggufFile}"
SERVER_PORT="${port}"
PLENUMNET_DIR="\$HOME/PlenumNET"
MODELS_DIR="\$HOME/yoda-models"
MODEL_PATH="\$MODELS_DIR/\$GGUF_FILE"
DAEMON="\$PLENUMNET_DIR/target/release/inter-cube-daemon"

echo "=== YODA Reconnect ==="
echo "Model : ${modelName}"
echo "Port  : \$SERVER_PORT"
echo ""

# ── 0. Pre-flight checks ──────────────────────────────────────────────
if [[ ! -f "\$DAEMON" ]]; then
  echo "  ✗ PlenumNET daemon not found. Run the Install script first."
  exit 1
fi
if [[ ! -f "\$MODEL_PATH" ]]; then
  echo "  ✗ Model file not found at: \$MODEL_PATH"
  echo "    Run the Install script first to download the model."
  exit 1
fi

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
[[ "\$LOCAL_IP" == "0.0.0.0" ]] && echo "  ⚠ Could not detect local IP — routing may not work correctly."

# ── 2. Register with YODA CRS ─────────────────────────────────────────
echo ""
echo "Registering with YODA CRS..."
if [[ "\$OS" == "Darwin" ]]; then
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | shasum -a 256 | cut -d' ' -f1)
else
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | sha256sum | cut -d' ' -f1)
fi
curl -sf -X POST "\${CRS_URL}/api/salvi/inter-cube/crs/register" \\
  -H "Content-Type: application/json" \\
  -d '{"endpoint":"'\$CUBE_ENDPOINT'","publicKey":"'\$PUB_KEY'","sessionToken":"'\$SESSION_TOKEN'"}' \\
  > /dev/null || { echo "  ✗ Registration failed. Is your internet connected?"; exit 1; }
echo "  ✓ Registered with YODA CRS"

# ── 3. Restart llama-server ───────────────────────────────────────────
echo ""
echo "Starting llama-server on port \$SERVER_PORT..."
pkill -f "llama-server.*\$SERVER_PORT" 2>/dev/null || true
sleep 0.5
llama-server \\
  --model "\$MODEL_PATH" \\
  --port "\$SERVER_PORT" \\
  --host 0.0.0.0 \\
  -c 4096 \\
  --parallel 4 \\
  -ngl 99 \\
  --log-disable &
echo "  ✓ llama-server started (PID \$!)"
sleep 2

# ── 4. Restart PlenumNET tunnel daemon ────────────────────────────────
echo ""
echo "Starting PlenumNET tunnel daemon..."
pkill -f "inter-cube-daemon" 2>/dev/null || true
sleep 0.5
CUBE_MODE=cube \\
CUBE_CRS_URL="\$CRS_URL" \\
CUBE_ENDPOINT="\$CUBE_ENDPOINT" \\
CUBE_SESSION_TOKEN="\$SESSION_TOKEN" \\
CUBE_ROLE=inference \\
"\$DAEMON" &
echo "  ✓ Daemon started (PID \$!)"

echo ""
echo "  Both processes running. YODA Monitoring will update within 10s."
echo "  Keep this terminal open to maintain the tunnel."
`;
}

function makeReconnectPsScript(
  modelName: string,
  ggufFile: string,
  port: number,
  sessionToken: string,
  crsUrl: string,
): string {
  return `# YODA — llama-server + PlenumNET reconnect (Windows)
# Model: ${modelName}  |  Port: ${port}  |  Token: ${sessionToken}
$ErrorActionPreference = "Stop"

$SESSION_TOKEN = "${sessionToken}"
$CRS_URL       = "${crsUrl}"
$GGUF_FILE     = "${ggufFile}"
$SERVER_PORT   = ${port}
$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"
$MODELS_DIR    = "$env:USERPROFILE\\yoda-models"
$MODEL_PATH    = "$MODELS_DIR\\$GGUF_FILE"
$LLAMA_DIR     = "$env:USERPROFILE\\llama.cpp"
$DAEMON_PATH   = "$PLENUMNET_DIR\\target\\release\\inter-cube-daemon.exe"

Write-Host "=== YODA Reconnect ===" -ForegroundColor Cyan
Write-Host "Model : ${modelName}"
Write-Host "Port  : $SERVER_PORT"
Write-Host ""

# ── 0. Pre-flight checks ──────────────────────────────────────────────
if (-not (Test-Path $DAEMON_PATH)) {
  Write-Host "  FAIL PlenumNET daemon not found. Run the Install script first." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $MODEL_PATH)) {
  Write-Host "  FAIL Model not found at: $MODEL_PATH" -ForegroundColor Red
  Write-Host "    Run the Install script first to download the model." -ForegroundColor Yellow
  exit 1
}
$llamaServer = Get-ChildItem -Path $LLAMA_DIR -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $llamaServer) {
  Write-Host "  FAIL llama-server.exe not found. Run the Install script first." -ForegroundColor Red
  exit 1
}
$LLAMA_SERVER = $llamaServer.FullName

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

# ── 2. Register with YODA CRS ─────────────────────────────────────────
Write-Host ""
Write-Host "Registering with YODA CRS..."
$pubKey  = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
  [System.Text.Encoding]::UTF8.GetBytes($CUBE_ENDPOINT)) |
  ForEach-Object { $_.ToString("x2") }) -join ""
$regBody = ConvertTo-Json @{ endpoint = $CUBE_ENDPOINT; publicKey = $pubKey; sessionToken = $SESSION_TOKEN }
try {
  $regResp = Invoke-RestMethod \`
    -Uri "$CRS_URL/api/salvi/inter-cube/crs/register" \`
    -Method Post -ContentType "application/json" -Body $regBody
  Write-Host "  OK Registered as $($regResp.address)"
} catch {
  Write-Host "  FAIL Registration failed: $_" -ForegroundColor Red; exit 1
}

# ── 3. Restart llama-server ───────────────────────────────────────────
Write-Host ""
Write-Host "Starting llama-server on port $SERVER_PORT..."
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$serverProc = Start-Process -FilePath $LLAMA_SERVER \`
  -ArgumentList "--model \`"$MODEL_PATH\`" --port $SERVER_PORT --host 0.0.0.0 -c 4096 --parallel 4 -ngl 99 --log-disable" \`
  -NoNewWindow -PassThru
Write-Host "  OK llama-server started (PID $($serverProc.Id))"
Start-Sleep -Seconds 2

# ── 4. Restart PlenumNET tunnel daemon ────────────────────────────────
Write-Host ""
Write-Host "Starting PlenumNET tunnel daemon..."
Get-Process -Name "inter-cube-daemon" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$env:CUBE_MODE          = "cube"
$env:CUBE_CRS_URL       = $CRS_URL
$env:CUBE_ENDPOINT      = $CUBE_ENDPOINT
$env:CUBE_SESSION_TOKEN = $SESSION_TOKEN
$env:CUBE_ROLE          = "inference"
$daemonProc = Start-Process -FilePath $DAEMON_PATH -NoNewWindow -PassThru
Write-Host "  OK Daemon started (PID $($daemonProc.Id))"

Write-Host ""
Write-Host "  Both processes running. YODA Monitoring will update within 10s." -ForegroundColor Green
Write-Host "  Keep this window open to maintain the tunnel." -ForegroundColor Yellow
`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelInstallModal({ modelName, port = 8080, onClose, mode = 'install' }: Props) {
  const crsUrl   = (import.meta.env.VITE_CRS_URL as string | undefined) ?? '';
  const ggufInfo = GGUF_INFO[modelName];
  const ggufRepo = ggufInfo?.repo ?? '';
  const ggufFile = ggufInfo?.file ?? '';

  const [sessionToken] = useState<string>(() => crypto.randomUUID());
  const [os, setOs] = useState<OS>(() =>
    /Win/i.test(navigator.userAgent) ? 'powershell' : 'bash',
  );
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState<PollingState>({ phase: 'idle' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const isConnect = mode === 'connect';

  const bashScript = isConnect
    ? makeReconnectBashScript(modelName, ggufFile, port, sessionToken, crsUrl)
    : makeBashScript(modelName, ggufRepo, ggufFile, port, sessionToken, crsUrl);
  const psScript = isConnect
    ? makeReconnectPsScript(modelName, ggufFile, port, sessionToken, crsUrl)
    : makePsScript(modelName, ggufRepo, ggufFile, port, sessionToken, crsUrl);
  const script = os === 'bash' ? bashScript : psScript;
  const fileName = os === 'bash'
    ? (isConnect ? 'yoda-reconnect.sh' : 'yoda-setup.sh')
    : (isConnect ? 'yoda-reconnect.ps1' : 'yoda-setup.ps1');
  const mime = os === 'bash' ? 'text/x-shellscript' : 'text/plain';

  const startPolling = useCallback(() => {
    if (!crsUrl) return;
    setPolling({ phase: 'waiting' });
    pollCount.current = 0;

    pollRef.current = setInterval(async () => {
      pollCount.current += 1;
      if (pollCount.current > 200) {
        clearInterval(pollRef.current!);
        setPolling({ phase: 'timeout' });
        return;
      }
      try {
        const res = await fetch(`${crsUrl}/api/yoda/crs/session/${sessionToken}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { status: string; address?: string } = await res.json();
        if (data.status === 'registered' && data.address) {
          clearInterval(pollRef.current!);
          setPolling({ phase: 'connected', address: data.address });
        }
      } catch (e) {
        clearInterval(pollRef.current!);
        setPolling({ phase: 'error', message: String(e) });
      }
    }, 3000);
  }, [crsUrl, sessionToken]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const FOCUSABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const getFocusable = () =>
      Array.from(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    const firstFocusable = getFocusable()[0];
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (pollRef.current) clearInterval(pollRef.current);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    startPolling();
  };

  const handleDownload = () => {
    const blob = new Blob([script], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    startPolling();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isConnect ? `Reconnect ${modelName} to PlenumNET` : `Install ${modelName}`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div ref={modalRef} className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isConnect ? 'bg-blue-500/15' : 'bg-[var(--color-gold-500)]/15'}`}>
              <Terminal className={`w-4 h-4 ${isConnect ? 'text-blue-400' : 'text-[var(--color-gold-400)]'}`} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {isConnect ? <>Reconnect to PlenumNET — {modelName}</> : <>Install &amp; Connect — {modelName}</>}
              </h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {isConnect
                  ? 'Re-run the tunnel script on your machine to restore the connection'
                  : 'Run the script on your server to establish a PlenumNET tunnel'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors text-[var(--color-text-muted)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 flex-1">

          {/* CRS URL warning */}
          {!crsUrl && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                <strong>CRS URL not configured.</strong> The generated script will only work when YODA is deployed.
                Set the <code className="bg-amber-500/20 px-1 rounded">VITE_CRS_URL</code> environment variable to your deployed domain.
              </span>
            </div>
          )}

          {/* Script panel */}
          {(() => (
            <>
              {/* OS tabs */}
              <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-surface-secondary)] w-fit">
                {(['bash', 'powershell'] as OS[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setOs(tab)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      os === tab
                        ? 'bg-[var(--color-surface-primary)] text-[var(--color-text-primary)] shadow-sm'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {tab === 'bash' ? 'macOS / Linux' : 'Windows'}
                  </button>
                ))}
              </div>

              {/* Script block */}
              <div className="relative">
                <pre className="w-full h-64 overflow-auto p-3 rounded-xl bg-[var(--color-navy-950)] border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-secondary)] font-mono leading-relaxed whitespace-pre select-all">
                  {script}
                </pre>
              </div>

              {/* Copy / Download */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-xs font-semibold hover:bg-[var(--color-gold-400)] transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy script'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-surface-hover)] transition-colors border border-[var(--color-border-default)]"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download {fileName}
                </button>
              </div>

              {/* Polling state */}
              {polling.phase !== 'idle' && (
                <div className={`flex items-start gap-3 p-3.5 rounded-xl border text-xs ${
                  polling.phase === 'waiting'
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                    : polling.phase === 'connected'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                  {polling.phase === 'waiting' && (
                    <>
                      <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin mt-0.5" />
                      <div>
                        <p className="font-medium">Waiting for your server to connect…</p>
                        <p className="mt-0.5 opacity-75">Run the script on your server, then come back here.</p>
                      </div>
                    </>
                  )}
                  {polling.phase === 'connected' && (
                    <>
                      <Wifi className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">
                          Connected — registered as <code className="bg-emerald-500/20 px-1 rounded">{polling.address}</code>
                        </p>
                        <p className="mt-0.5 opacity-75">
                          Tunnel is live. Set this engine's Endpoint in YODA Settings to{' '}
                          <code className="bg-emerald-500/20 px-1 rounded">http://localhost:{port}</code>.
                        </p>
                      </div>
                    </>
                  )}
                  {polling.phase === 'timeout' && (
                    <>
                      <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">No connection after 10 minutes.</p>
                        <p className="mt-0.5 opacity-75">Re-run the script and try again. Make sure it completed without errors.</p>
                      </div>
                    </>
                  )}
                  {polling.phase === 'error' && (
                    <>
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Connection check failed</p>
                        <p className="mt-0.5 opacity-75">{polling.message}</p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Instructions */}
              <div className="p-3 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] space-y-1.5">
                <p className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">What the script does</p>
                {isConnect ? (
                  <ol className="text-xs text-[var(--color-text-muted)] space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Checks that llama-server and the model file are already present</li>
                    <li>Restarts <code className="bg-[var(--color-surface-primary)] px-1 rounded">llama-server</code> on port <code className="bg-[var(--color-surface-primary)] px-1 rounded">{port}</code></li>
                    <li>Re-registers with YODA CRS and restarts the PlenumNET tunnel daemon</li>
                  </ol>
                ) : (
                  <ol className="text-xs text-[var(--color-text-muted)] space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Downloads and installs <strong>llama.cpp</strong> (llama-server binary)</li>
                    <li>Downloads <code className="bg-[var(--color-surface-primary)] px-1 rounded">{ggufFile}</code> from HuggingFace</li>
                    <li>Clones &amp; builds the PlenumNET tunnel daemon</li>
                    <li>Starts <code className="bg-[var(--color-surface-primary)] px-1 rounded">llama-server</code> on <code className="bg-[var(--color-surface-primary)] px-1 rounded">localhost:{port}</code> — OpenAI-compatible, never public</li>
                    <li>Opens an outbound PlenumNET tunnel to YODA — <strong>no ports need opening</strong></li>
                  </ol>
                )}
              </div>
            </>
          ))()}
        </div>
      </div>
    </div>
  );
}
