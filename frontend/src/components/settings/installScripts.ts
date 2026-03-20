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
 * lines decoded by certutil.  Double-clicking the .bat runs without any
 * execution-policy prompt because we invoke powershell.exe with -ExecutionPolicy
 * Bypass ourselves.
 */
export function makeBatWrapper(psScript: string, modelName: string): string {
  // UTF-8 → base64
  const bytes  = new TextEncoder().encode(psScript);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const b64    = btoa(binary);
  // certutil wants the base64 split into ≤76-char lines
  const echos  = (b64.match(/.{1,76}/g) ?? []).map((l) => `echo ${l}`).join('\r\n');

  return [
    '@echo off',
    `title YODA Installer -- ${modelName}`,
    'setlocal',
    'set "BF=%TEMP%\\yoda_%RANDOM%.b64"',
    'set "PF=%TEMP%\\yoda_%RANDOM%.ps1"',
    '(',
    echos,
    ') > "%BF%"',
    'certutil -decode "%BF%" "%PF%" >nul 2>&1',
    'del "%BF%"',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PF%"',
    'del "%PF%" 2>nul',
    'pause',
  ].join('\r\n') + '\r\n';
}

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
# YODA — llama-server + PlenumNET installer
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

echo ""
echo "=============================="
echo "  Setup complete!"
echo "  Model  : ${modelName}"
echo "  Server : http://localhost:\$SERVER_PORT  (OpenAI-compatible)"
echo "  Tunnel : \$CUBE_ENDPOINT → YODA CRS"
echo "=============================="
echo ""
echo "NOTE: Both processes stop when this terminal closes."
echo "Use the Connect script to restart after reboot."
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
  return `# YODA — llama-server + PlenumNET installer (Windows)
# Model: ${modelName}  |  Port: ${port}  |  Token: ${token}
$ErrorActionPreference = "Stop"

$SESSION_TOKEN = "${token}"
$CRS_URL       = "${crsUrl}"
$GGUF_REPO     = "${ggufRepo}"
$GGUF_FILE     = "${ggufFile}"
$SERVER_PORT   = ${port}
$MODELS_DIR    = "$env:USERPROFILE\\yoda-models"
$MODEL_PATH    = "$MODELS_DIR\\$GGUF_FILE"
$LLAMA_DIR     = "$env:USERPROFILE\\llama.cpp"

# ── Locate PlenumNET ─────────────────────────────────────────────────
$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"
if ((-not (Test-Path $PLENUMNET_DIR)) -and (Test-Path "C:\\PlenumNET")) {
  $PLENUMNET_DIR = "C:\\PlenumNET"
}
$DAEMON_PATH = "$PLENUMNET_DIR\\target\\release\\inter-cube-daemon.exe"

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

# ── 4. Install llama.cpp ──────────────────────────────────────────────
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
Write-Host "  OK Daemon built at: $DAEMON_PATH"

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
$env:CUBE_MODE          = "cube"
$env:CUBE_CRS_URL       = $CRS_URL
$env:CUBE_ENDPOINT      = $CUBE_ENDPOINT
$env:CUBE_SESSION_TOKEN = $SESSION_TOKEN
$env:CUBE_ROLE          = "inference"
$daemonProc = Start-Process -FilePath $DAEMON_PATH -NoNewWindow -PassThru
Write-Host "  OK Daemon started (PID $($daemonProc.Id))"

Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Model  : ${modelName}" -ForegroundColor Green
Write-Host "  Server : http://localhost:$SERVER_PORT  (OpenAI-compatible)" -ForegroundColor Green
Write-Host "  Tunnel : $CUBE_ENDPOINT -> YODA CRS" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""
Write-Host "NOTE: Both processes stop when this window closes." -ForegroundColor Yellow
Write-Host "Use the Connect script to restart after reboot."
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
# YODA — llama-server + PlenumNET reconnect
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

echo "=== YODA Reconnect ==="
echo "Model : ${modelName}"
echo "Port  : \$SERVER_PORT"
echo ""

if [[ ! -f "\$DAEMON" ]]; then
  echo "  ✗ PlenumNET daemon not found. Run the Install script first."
  exit 1
fi
if [[ ! -f "\$MODEL_PATH" ]]; then
  echo "  ✗ Model file not found. Run the Install script first."
  exit 1
fi

OS=\$(uname -s)
if [[ "\$OS" == "Darwin" ]]; then
  LOCAL_IP=\$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
else
  LOCAL_IP=\$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if(\$i=="src") print \$(i+1)}' | head -1)
  [[ -z "\$LOCAL_IP" ]] && LOCAL_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}')
fi
LOCAL_IP=\${LOCAL_IP:-"0.0.0.0"}
CUBE_ENDPOINT="\${LOCAL_IP}:51820"

if [[ "\$OS" == "Darwin" ]]; then
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | shasum -a 256 | cut -d' ' -f1)
else
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | sha256sum | cut -d' ' -f1)
fi
curl -sf -X POST "\${CRS_URL}/api/salvi/inter-cube/crs/register" \\
  -H "Content-Type: application/json" \\
  -d '{"endpoint":"'\$CUBE_ENDPOINT'","publicKey":"'\$PUB_KEY'","sessionToken":"'\$SESSION_TOKEN'"}' \\
  > /dev/null || { echo "  ✗ Registration failed."; exit 1; }
echo "  ✓ Registered with YODA CRS"

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
echo "  Both processes running. YODA will update within 10s."
echo "  Keep this terminal open to maintain the tunnel."
`;
}

export function makePsReconnectScript(
  modelName : string,
  ggufFile  : string,
  port      : number,
  token     : string,
  crsUrl    : string,
): string {
  return `# YODA — llama-server + PlenumNET reconnect (Windows)
# Model: ${modelName}  |  Port: ${port}  |  Token: ${token}
$ErrorActionPreference = "Stop"

$SESSION_TOKEN = "${token}"
$CRS_URL       = "${crsUrl}"
$GGUF_FILE     = "${ggufFile}"
$SERVER_PORT   = ${port}
$MODELS_DIR    = "$env:USERPROFILE\\yoda-models"
$MODEL_PATH    = "$MODELS_DIR\\$GGUF_FILE"
$LLAMA_DIR     = "$env:USERPROFILE\\llama.cpp"

$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"
if ((-not (Test-Path "$PLENUMNET_DIR\\target\\release\\inter-cube-daemon.exe")) -and
    (Test-Path "C:\\PlenumNET\\target\\release\\inter-cube-daemon.exe")) {
  $PLENUMNET_DIR = "C:\\PlenumNET"
}
$DAEMON_PATH = "$PLENUMNET_DIR\\target\\release\\inter-cube-daemon.exe"

Write-Host "=== YODA Reconnect ===" -ForegroundColor Cyan
Write-Host "Model : ${modelName}"
Write-Host "Port  : $SERVER_PORT"
Write-Host ""

if (-not (Test-Path $DAEMON_PATH)) {
  Write-Host "  FAIL PlenumNET daemon not found." -ForegroundColor Red
  Write-Host "  Run the Install script first (Settings -> AI Engines -> Install & Connect)." -ForegroundColor Yellow
  exit 1
}
if (-not (Test-Path $MODEL_PATH)) {
  Write-Host "  FAIL Model not found at: $MODEL_PATH" -ForegroundColor Red
  Write-Host "  Run the Install script first." -ForegroundColor Yellow
  exit 1
}
$llamaServer = Get-ChildItem -Path $LLAMA_DIR -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $llamaServer) {
  Write-Host "  FAIL llama-server.exe not found. Run the Install script first." -ForegroundColor Red
  exit 1
}
$LLAMA_SERVER = $llamaServer.FullName

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^127\\.' -and $_.IPAddress -notmatch '^169\\.254' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object @{ Expression = { switch -Wildcard ($_.InterfaceAlias) { 'Wi-Fi*' { 0 } 'Ethernet*' { 1 } default { 2 } } } } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "0.0.0.0" }
$CUBE_ENDPOINT = "$ip:51820"
Write-Host "Local endpoint : $CUBE_ENDPOINT"

$pubKey  = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
  [System.Text.Encoding]::UTF8.GetBytes($CUBE_ENDPOINT)) |
  ForEach-Object { $_.ToString("x2") }) -join ""
$regBody = ConvertTo-Json @{ endpoint = $CUBE_ENDPOINT; publicKey = $pubKey; sessionToken = $SESSION_TOKEN }
try {
  Invoke-RestMethod \`
    -Uri "$CRS_URL/api/salvi/inter-cube/crs/register" \`
    -Method Post -ContentType "application/json" -Body $regBody | Out-Null
  Write-Host "  OK Registered with YODA CRS"
} catch {
  Write-Host "  FAIL Registration failed: $_" -ForegroundColor Red; exit 1
}

Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$serverProc = Start-Process -FilePath $LLAMA_SERVER \`
  -ArgumentList "--model \`"$MODEL_PATH\`" --port $SERVER_PORT --host 0.0.0.0 -c 4096 --parallel 4 -ngl 99 --log-disable" \`
  -NoNewWindow -PassThru
Write-Host "  OK llama-server started (PID $($serverProc.Id))"
Start-Sleep -Seconds 2

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
Write-Host "  Both processes running. YODA will update within 10s." -ForegroundColor Green
Write-Host "  Keep this window open to maintain the tunnel." -ForegroundColor Yellow
`;
}
