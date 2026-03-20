#Requires -Version 5.1
# ============================================================
#  YODA -- Mathstral-7B Setup Script
#  Downloads Mathstral-7B-v0.1-GGUF and starts llama-server.
#  Run from any directory: .\scripts\setup-mathstral.ps1
# ============================================================

# ── Configurable options ────────────────────────────────────
$QUANT        = "Q4_K_M"          # Q4_K_M ~4.4 GB  |  Q5_K_M ~5.1 GB
$LLAMA_PORT   = 8081              # Engine B slot (matches YODA default)
$CTX_SIZE     = 8192              # Context window tokens
$GPU_LAYERS   = 0                 # Set >0 if you have a GPU (e.g. 33)
$MODELS_DIR   = "$HOME\yoda-models"
$REPO         = "bartowski/mathstral-7B-v0.1-GGUF"
$FILENAME     = "mathstral-7B-v0.1-$QUANT.gguf"
$POLL_TIMEOUT = 120               # Seconds to wait for llama-server to be ready
# ────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

function Write-Step  { param($msg) Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "  OK  $msg"    -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  !!  $msg"    -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  XX  $msg"    -ForegroundColor Red }

Write-Host ""
Write-Host "  YODA -- Mathstral-7B Setup" -ForegroundColor White
Write-Host "  Quant   : $QUANT"
Write-Host "  Port    : $LLAMA_PORT"
Write-Host "  Models  : $MODELS_DIR"
Write-Host ""

# ── Step 1: Check Python ────────────────────────────────────
Write-Step "Checking Python"

$python = $null
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $ver -match "Python 3") {
            $python = $cmd
            Write-OK "Found: $ver"
            break
        }
    } catch {}
}

if (-not $python) {
    Write-Fail "Python 3 not found. Install from https://python.org and re-run."
    exit 1
}

# ── Step 2: Ensure huggingface_hub is installed ─────────────
Write-Step "Checking huggingface_hub"

$ErrorActionPreference = "Continue"
$hfCheck = & $python -c "import huggingface_hub; print(huggingface_hub.__version__)" 2>&1
$ErrorActionPreference = "Stop"

if ($LASTEXITCODE -ne 0) {
    Write-Warn "huggingface_hub not found -- installing..."
    & $python -m pip install --quiet huggingface-hub
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "pip install failed. Try: $python -m pip install huggingface-hub"
        exit 1
    }
    Write-OK "huggingface_hub installed"
} else {
    Write-OK "huggingface_hub $hfCheck"
}

# ── Step 3: Create models directory ─────────────────────────
Write-Step "Preparing models directory"

if (-not (Test-Path -LiteralPath $MODELS_DIR)) {
    New-Item -ItemType Directory -Path $MODELS_DIR | Out-Null
    Write-OK "Created $MODELS_DIR"
} else {
    Write-OK "Exists: $MODELS_DIR"
}

# ── Step 4: Download the GGUF ───────────────────────────────
Write-Step "Downloading $FILENAME"

$modelPath = Join-Path $MODELS_DIR $FILENAME

if (Test-Path -LiteralPath $modelPath) {
    Write-OK "Already downloaded: $modelPath"
    Write-Warn "Delete the file and re-run if you want a fresh download."
} else {
    Write-Host "  Downloading from $REPO ..."
    Write-Host "  This may take several minutes on first run."
    Write-Host ""

    $ErrorActionPreference = "Continue"
    & $python -m huggingface_hub download `
        "$REPO" `
        "$FILENAME" `
        --local-dir "$MODELS_DIR"
    $dlExit = $LASTEXITCODE
    $ErrorActionPreference = "Stop"

    if ($dlExit -ne 0) {
        Write-Fail "Download failed (exit $dlExit)."
        Write-Warn "You can also download manually from:"
        Write-Warn "  https://huggingface.co/$REPO"
        Write-Warn "Place $FILENAME in: $MODELS_DIR"
        exit 1
    }

    if (-not (Test-Path -LiteralPath $modelPath)) {
        Write-Fail "File not found after download: $modelPath"
        Write-Warn "huggingface_hub may have placed it in a subdirectory."
        Write-Warn "Check inside $MODELS_DIR and move the .gguf file there."
        exit 1
    }

    $sizeMB = [math]::Round((Get-Item -LiteralPath $modelPath).Length / 1MB, 0)
    Write-OK "Downloaded: $FILENAME ($sizeMB MB)"
}

# ── Step 5: Find llama-server ───────────────────────────────
Write-Step "Finding llama-server"

$llamaServer = $null

# Check PATH first
$ErrorActionPreference = "Continue"
$inPath = Get-Command "llama-server" -ErrorAction SilentlyContinue
$ErrorActionPreference = "Stop"

if ($inPath) {
    $llamaServer = $inPath.Source
    Write-OK "Found in PATH: $llamaServer"
} else {
    # Check common install locations
    $searchRoots = @(
        "C:\llama.cpp",
        "C:\tools\llama.cpp",
        "C:\tools",
        "$HOME\llama.cpp",
        "$HOME\tools\llama.cpp",
        "$HOME\AppData\Local\llama.cpp"
    )
    $candidates = @("llama-server.exe", "build\bin\Release\llama-server.exe", "build\bin\llama-server.exe")

    foreach ($root in $searchRoots) {
        if (Test-Path -LiteralPath $root -ErrorAction SilentlyContinue) {
            foreach ($rel in $candidates) {
                $full = Join-Path $root $rel
                if (Test-Path -LiteralPath $full) {
                    $llamaServer = $full
                    break
                }
            }
        }
        if ($llamaServer) { break }
    }

    if ($llamaServer) {
        Write-OK "Found: $llamaServer"
    } else {
        Write-Host ""
        Write-Warn "llama-server.exe not found automatically."
        Write-Host "  Enter the full path to llama-server.exe" -ForegroundColor White
        Write-Host "  (e.g. C:\llama.cpp\build\bin\Release\llama-server.exe)" -ForegroundColor Gray
        Write-Host ""
        $llamaServer = Read-Host "  Path"
        $llamaServer = $llamaServer.Trim('"').Trim()
        if (-not (Test-Path -LiteralPath $llamaServer)) {
            Write-Fail "Not found: $llamaServer"
            exit 1
        }
        Write-OK "Using: $llamaServer"
    }
}

# ── Step 6: Check if port is already in use ─────────────────
Write-Step "Checking port $LLAMA_PORT"

$ErrorActionPreference = "Continue"
$portInUse = netstat -ano 2>$null | Select-String ":$LLAMA_PORT " | Select-String "LISTENING"
$ErrorActionPreference = "Stop"

if ($portInUse) {
    Write-Warn "Port $LLAMA_PORT is already in use."
    Write-Warn "If another llama-server is running there, stop it first."
    Write-Host ""
    $cont = Read-Host "  Continue anyway? (y/N)"
    if ($cont -notmatch "^[Yy]") {
        Write-Host "  Exiting." -ForegroundColor Gray
        exit 0
    }
} else {
    Write-OK "Port $LLAMA_PORT is free"
}

# ── Step 7: Build llama-server arguments ────────────────────
Write-Step "Starting llama-server"

$args = @(
    "--model",   $modelPath,
    "--port",    $LLAMA_PORT,
    "--ctx-size", $CTX_SIZE,
    "--host",    "0.0.0.0"
)

if ($GPU_LAYERS -gt 0) {
    $args += "--n-gpu-layers"
    $args += $GPU_LAYERS
}

Write-Host "  Command: llama-server $($args -join ' ')" -ForegroundColor Gray
Write-Host ""

# Launch in a new window so this terminal stays usable
$startArgs = @{
    FilePath         = $llamaServer
    ArgumentList     = $args
    WindowStyle      = "Normal"
    PassThru         = $true
}

$ErrorActionPreference = "Continue"
$proc = Start-Process @startArgs
$ErrorActionPreference = "Stop"

if (-not $proc) {
    Write-Fail "Failed to start llama-server."
    exit 1
}

Write-OK "llama-server started (PID $($proc.Id))"
Write-Host "  A new window opened -- watch it for the model loading progress." -ForegroundColor Gray

# ── Step 8: Wait for ready ───────────────────────────────────
Write-Step "Waiting for llama-server to be ready"
Write-Host "  Polling http://localhost:$LLAMA_PORT/v1/models ..."
Write-Host "  (Model loading typically takes 10-60 s depending on RAM speed)"
Write-Host ""

$ready    = $false
$deadline = (Get-Date).AddSeconds($POLL_TIMEOUT)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3

    $ErrorActionPreference = "Continue"
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$LLAMA_PORT/v1/models" `
                                  -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($resp.StatusCode -lt 500) {
            $ready = $true
        }
    } catch {}
    $ErrorActionPreference = "Stop"

    if ($ready) { break }

    # Check process is still alive
    if ($proc.HasExited) {
        Write-Fail "llama-server exited unexpectedly (code $($proc.ExitCode))."
        Write-Warn "Check the llama-server window for error output."
        exit 1
    }

    Write-Host "  Still loading..." -ForegroundColor DarkGray
}

Write-Host ""

if (-not $ready) {
    Write-Warn "llama-server did not respond within $POLL_TIMEOUT seconds."
    Write-Warn "It may still be loading. Check http://localhost:$LLAMA_PORT/v1/models manually."
} else {
    Write-OK "llama-server is ready at http://localhost:$LLAMA_PORT"
}

# ── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Done." -ForegroundColor White
Write-Host ""
Write-Host "  Next steps in YODA:" -ForegroundColor Cyan
Write-Host "    1. Open AI Engines settings"
Write-Host "    2. Engine B -> endpoint: http://localhost:$LLAMA_PORT"
Write-Host "    3. Set model name:  mathstral-7B-v0.1-$QUANT"
Write-Host "    4. Set family to something distinct from Engine A's family"
Write-Host "    5. The next CRS heartbeat will auto-flip Engine B online"
Write-Host ""
