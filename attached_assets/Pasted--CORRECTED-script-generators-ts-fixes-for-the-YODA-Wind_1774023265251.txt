// CORRECTED script-generators.ts — fixes for the YODA Windows installer
//
// CHANGES FROM ORIGINAL:
// 1. makeBatWrapper: Fixed %RANDOM% race (BF and PF got different random numbers),
//    switched to single random seed. Runs the PS1 inline via -EncodedCommand so
//    double-clicking the .bat auto-executes immediately — no intermediate .ps1 file.
// 2. makePsInstallScript: git pull wrapped in try/catch so network hiccups don't
//    kill the script when the repo already exists locally.
// 3. makePsInstallScript: Path checks corrected — "inter-cube/Cargo.toml" →
//    "services\inter-cube\Cargo.toml" to match actual repo structure.
//
// Replace makeBatWrapper and makePsInstallScript in your script-generators.ts

// ── Helpers (unchanged) ───────────────────────────────────────────────

export function detectOS(): 'windows' | 'mac' | 'linux' {
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  return 'linux';
}

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
 * Double-clicking the .bat auto-executes the full installer — no prompts,
 * no extra clicks.  The PS1 is UTF-16LE base64-encoded and passed directly
 * via powershell.exe -EncodedCommand, so there is no intermediate .ps1 file
 * on disk and no execution-policy issues.
 *
 * FIXED: The original used two separate %RANDOM% expansions for BF and PF
 * which generated different random numbers, causing the decode step to write
 * to a path that didn't match the execute step.  This version encodes the
 * entire PS1 as a single -EncodedCommand, eliminating the temp-file dance.
 */
export function makeBatWrapper(psScript: string, _modelName: string): string {
  // For scripts under ~8KB (the -EncodedCommand limit is ~32KB of base64),
  // we can inline the entire PS1 as a single -EncodedCommand call.
  // This is the simplest, most reliable approach — no temp files at all.

  // Convert PS1 to UTF-16LE bytes (what -EncodedCommand expects)
  const utf16leBytes: number[] = [];
  for (const char of psScript) {
    const code = char.charCodeAt(0);
    utf16leBytes.push(code & 0xFF, (code >> 8) & 0xFF);
  }
  const encodedScript = btoa(String.fromCharCode(...utf16leBytes));

  // If the encoded script is small enough for a single command line (~32KB),
  // use the simple inline approach
  if (encodedScript.length < 30000) {
    return [
      '@echo off',
      'title YODA Installer',
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + encodedScript,
      'pause',
    ].join('\r\n') + '\r\n';
  }

  // For very large scripts, fall back to temp-file approach with a single
  // %RANDOM% expansion captured once
  const bytes  = new TextEncoder().encode(psScript);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const b64    = btoa(binary);
  const echos  = (b64.match(/.{1,76}/g) ?? []).map((l) => `echo ${l}`).join('\r\n');

  return [
    '@echo off',
    'title YODA Installer',
    'setlocal',
    // Capture %RANDOM% once into a variable so BF and PF share the same suffix
    'set "RND=%RANDOM%%RANDOM%"',
    'set "BF=%TEMP%\\yoda_%RND%.b64"',
    'set "PF=%TEMP%\\yoda_%RND%.ps1"',
    '(',
    echos,
    ') > "%BF%"',
    // Decode: read the .b64, strip non-base64 chars, decode to .ps1
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "' +
      '$b=([IO.File]::ReadAllText($env:BF) -replace \'[^A-Za-z0-9+/=]\',\'\');' +
      '[IO.File]::WriteAllBytes($env:PF,[Convert]::FromBase64String($b))"',
    'del "%BF%" 2>nul',
    'if not exist "%PF%" ( echo ERROR: Failed to decode installer script. & pause & exit /b 1 )',
    // Execute the decoded PS1
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PF%"',
    'del "%PF%" 2>nul',
    'pause',
  ].join('\r\n') + '\r\n';
}

// ── makePsInstallScript (CORRECTED) ───────────────────────────────────

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
function Invoke-ClonePlenumNET {
  Write-Host "  -> Cloning PlenumNET..."
  git clone --depth 1 https://github.com/SigmaWolf-8/Ternary $PLENUMNET_DIR
}
if (Test-Path "$PLENUMNET_DIR\\.git") {
  Write-Host "  -> Repository exists, updating..."
  # FIX-1: Wrap git pull in try/catch — a network hiccup should NOT kill the
  #        entire script when the repo already exists locally.  We can build
  #        from the local checkout even if pull fails.
  try {
    $pullOutput = git -C $PLENUMNET_DIR pull --ff-only 2>&1
    Write-Host "  -> $pullOutput"
  } catch {
    Write-Host "  -> git pull failed (network issue?) — continuing with existing checkout" -ForegroundColor Yellow
  }
  # FIX-2: Correct path — inter-cube lives under services/ in the repo
  if (-not (Test-Path "$PLENUMNET_DIR\\services\\inter-cube\\Cargo.toml")) {
    Write-Host "  -> Existing checkout is incomplete — re-cloning..."
    Remove-Item -Recurse -Force $PLENUMNET_DIR
    Invoke-ClonePlenumNET
  }
} else {
  Invoke-ClonePlenumNET
}
# FIX-2: Correct paths — inter-cube is under services/, ternary-math is at root
foreach ($member in @("services\\inter-cube\\Cargo.toml", "ternary-math\\Cargo.toml")) {
  if (-not (Test-Path "$PLENUMNET_DIR\\$member")) {
    throw "$member missing after clone — check network and try again."
  }
}
Write-Host "  -> Building inter-cube daemon (first build takes a few minutes)..."
Push-Location $PLENUMNET_DIR
cargo build --release --package inter-cube
Pop-Location
$daemonBin = Get-ChildItem -Path "$PLENUMNET_DIR\\target\\release" -Filter "inter-cube*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "*.d" } | Select-Object -First 1
if (-not $daemonBin) {
  throw "Build completed but no inter-cube binary found in $PLENUMNET_DIR\\target\\release — check cargo output above for errors."
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
  $rng   = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  $bytes = [byte[]]::new(24)
  $rng.GetBytes($bytes)
  $CUBE_PASSPHRASE = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  $rng.Dispose()
  $CUBE_PASSPHRASE | Set-Content -Path $PASSPHRASE_FILE -NoNewline
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
    curl.exe -fL -C - --progress-bar "$modelUrl" -o "$MODEL_PATH"
  } else {
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
