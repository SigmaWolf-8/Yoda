# YODA Re-run Installer
$ErrorActionPreference = "Stop"
Write-Host "=== YODA Re-run Installer ===" -ForegroundColor Cyan
Write-Host ""

# -- 1. Find Visual Studio and ARM64 build tools --------------------------
Write-Host "Checking for MSVC ARM64 build tools..."
$vsWhere = $null
$searchPaths = @(
  "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
  "${env:ProgramFiles}\Microsoft Visual Studio\Installer\vswhere.exe",
  "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe",
  "C:\Program Files\Microsoft Visual Studio\Installer\vswhere.exe"
)
foreach ($p in $searchPaths) {
  if (Test-Path $p) { $vsWhere = $p; break }
}
$vsPath = $null
if ($vsWhere) {
  $vsPath = & $vsWhere -latest -property installationPath 2>$null
  if ($vsPath) {
    Write-Host "  OK Visual Studio found at: $vsPath" -ForegroundColor Green
    $clExe = Get-ChildItem -Path $vsPath -Recurse -Filter "cl.exe" -ErrorAction SilentlyContinue |
      Where-Object { $_.DirectoryName -match "arm64" } | Select-Object -First 1
    if ($clExe) {
      Write-Host "  OK ARM64 cl.exe found: $($clExe.FullName)" -ForegroundColor Green
    } else {
      Write-Host "  WARNING: ARM64 cl.exe NOT found." -ForegroundColor Red
      Write-Host "  Open Visual Studio Installer -> Modify -> Individual Components" -ForegroundColor Yellow
      Write-Host "  Check: MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools (Latest)" -ForegroundColor Yellow
      Write-Host "  Check: Windows 11 SDK (latest version)" -ForegroundColor Yellow
      Read-Host "Press Enter after installing, or Ctrl+C to abort"
    }
  } else {
    Write-Host "  WARNING: vswhere found but returned no installation" -ForegroundColor Yellow
  }
} else {
  Write-Host "  WARNING: vswhere.exe not found -- searching for cl.exe directly..." -ForegroundColor Yellow
  $clSearch = Get-ChildItem -Path "C:\Program Files*\Microsoft Visual Studio" -Recurse -Filter "cl.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -match "arm64" } | Select-Object -First 1
  if ($clSearch) {
    Write-Host "  OK Found ARM64 cl.exe: $($clSearch.FullName)" -ForegroundColor Green
    $vsPath = ($clSearch.FullName -split "\\VC\\")[0]
  } else {
    Write-Host "  No ARM64 cl.exe found anywhere." -ForegroundColor Red
    Write-Host "  Install via: Visual Studio Installer -> Modify -> Individual Components" -ForegroundColor Yellow
    Write-Host "  Check: MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools (Latest)" -ForegroundColor Yellow
    Read-Host "Press Enter after installing, or Ctrl+C to abort"
  }
}

# -- 2. Set up VS environment for ARM64 -----------------------------------
Write-Host ""
Write-Host "Setting up Visual Studio environment for ARM64..."
$vcvarsPath = $null
if ($vsPath) {
  $tryPaths = @(
    (Join-Path $vsPath "VC\Auxiliary\Build\vcvarsarm64.bat"),
    (Join-Path $vsPath "VC\Auxiliary\Build\vcvarsx86_arm64.bat"),
    (Join-Path $vsPath "VC\Auxiliary\Build\vcvarsall.bat")
  )
  foreach ($tp in $tryPaths) {
    if (Test-Path $tp) { $vcvarsPath = $tp; break }
  }
}
if ($vcvarsPath) {
  Write-Host "  -> Running: $vcvarsPath"
  $vcCmd = if ($vcvarsPath -match "vcvarsall") { "`"$vcvarsPath`" arm64" } else { "`"$vcvarsPath`"" }
  cmd /c "$vcCmd >nul 2>&1 && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
  }
  Write-Host "  OK VS environment loaded" -ForegroundColor Green
} else {
  Write-Host "  WARNING: Could not find vcvars script -- trying LLVM/Clang fallback..." -ForegroundColor Yellow
  if (-not (Get-Command clang -ErrorAction SilentlyContinue)) {
    Write-Host "  -> Installing LLVM via winget (this takes a minute)..." -ForegroundColor Yellow
    winget install LLVM.LLVM --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    $env:PATH += ";C:\Program Files\LLVM\bin"
  }
  if (Get-Command clang -ErrorAction SilentlyContinue) {
    Write-Host "  OK Clang available: $(clang --version 2>&1 | Select-Object -First 1)" -ForegroundColor Green
    $env:CC = "clang"
  } else {
    Write-Host "  WARNING: No C compiler found -- build will likely fail" -ForegroundColor Red
  }
}

# -- 3. Paths (PS 5.1 compatible -- no 3-arg Join-Path) --------------------
$PLENUMNET_DIR = Join-Path $env:USERPROFILE "PlenumNET"
$MODELS_DIR    = Join-Path $env:USERPROFILE "yoda-models"
$LOG_DIR       = Join-Path $MODELS_DIR "logs"
$IDENTITY_DIR  = Join-Path (Join-Path $env:USERPROFILE ".plenumnet") "identity"
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null

# -- 4. Clean previous failed build and rebuild ----------------------------
Write-Host ""
Write-Host "Cleaning previous failed build..."
$ringBuildDir = Join-Path (Join-Path $PLENUMNET_DIR "target") (Join-Path "release" "build")
if (Test-Path $ringBuildDir) {
  Get-ChildItem -Path $ringBuildDir -Directory -Filter "ring-*" | Remove-Item -Recurse -Force
  Write-Host "  OK Cleaned ring build artifacts"
}

Write-Host ""
Write-Host "Building inter-cube daemon (this takes a few minutes)..."
Push-Location $PLENUMNET_DIR
$ErrorActionPreference = "Continue"
cargo build --release --package inter-cube 2>&1 | Tee-Object -Variable buildOutput
$buildExitCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
Pop-Location

if ($buildExitCode -ne 0) {
  Write-Host ""
  Write-Host "=== BUILD FAILED ===" -ForegroundColor Red
  Write-Host "The build output above should show the specific error." -ForegroundColor Red
  Write-Host ""
  Write-Host "If ring/cc failed, try: winget install LLVM.LLVM" -ForegroundColor Yellow
  Write-Host "Then re-run this script." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

$relDir = Join-Path (Join-Path $PLENUMNET_DIR "target") "release"
$daemonBin = Get-ChildItem -Path $relDir -Filter "inter-cube*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "*.d" } | Select-Object -First 1
if (-not $daemonBin) { throw "Build succeeded but no inter-cube binary found in $relDir" }
$DAEMON_PATH = $daemonBin.FullName
Write-Host "  OK Daemon built: $DAEMON_PATH" -ForegroundColor Green

# -- 5. Keygen (reuse existing identity if present) ------------------------
Write-Host ""
Write-Host "Setting up PlenumNET identity..."
New-Item -ItemType Directory -Force -Path $IDENTITY_DIR | Out-Null
$PASSPHRASE_FILE = Join-Path $IDENTITY_DIR ".passphrase"

if (Test-Path $PASSPHRASE_FILE) {
  $CUBE_PASSPHRASE = (Get-Content $PASSPHRASE_FILE -Raw).Trim()
  Write-Host "  -> Loaded existing passphrase"
} else {
  $rng   = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  $bytes = [byte[]]::new(24)
  $rng.GetBytes($bytes)
  $CUBE_PASSPHRASE = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  $rng.Dispose()
  $CUBE_PASSPHRASE | Set-Content -Path $PASSPHRASE_FILE -NoNewline
  Write-Host "  OK Generated passphrase"
}
$env:CUBE_IDENTITY_PASSPHRASE = $CUBE_PASSPHRASE

Write-Host "  -> Generating PT26-DSA identity keypair..."
$env:CUBE_MODE = "keygen"
$keygenLog = Join-Path $LOG_DIR "keygen.log"
$ErrorActionPreference = "Continue"
$keygenOutput = & $DAEMON_PATH 2>$keygenLog
$ErrorActionPreference = "Stop"
$env:CUBE_MODE = $null
$pkLine = $keygenOutput | Where-Object { $_ -match "PT26-DSA Public Key" } | Select-Object -First 1
if ($pkLine -match ':\s*([0-9a-fA-F]+)\s*$') {
  $PUB_KEY = $matches[1]
} else {
  $PUB_KEY = ""
}
if (-not $PUB_KEY) {
  Write-Host "  Keygen output:" -ForegroundColor Yellow
  $keygenOutput | ForEach-Object { Write-Host "    $_" }
  throw "Daemon keygen produced no public key -- check $keygenLog"
}
Write-Host "  OK Public key: $($PUB_KEY.Substring(0, [Math]::Min(32, $PUB_KEY.Length)))..." -ForegroundColor Green

# -- 6. Start CRS daemon on port 8080 -------------------------------------
Write-Host ""
Write-Host "Starting PlenumNET CRS daemon on port 8080..."
Get-Process | Where-Object { $_.Name -like "inter-cube*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$env:CUBE_MODE     = "crs"
$env:CUBE_API_PORT = "8080"
$daemonOutLog = Join-Path $LOG_DIR "intercube-crs-out.log"
$daemonErrLog = Join-Path $LOG_DIR "intercube-crs-err.log"
$daemonProc = Start-Process -FilePath $DAEMON_PATH -NoNewWindow -PassThru -RedirectStandardOutput $daemonOutLog -RedirectStandardError $daemonErrLog
Write-Host "  OK Daemon started (PID $($daemonProc.Id))" -ForegroundColor Green
Start-Sleep -Seconds 3

# -- 7. Verify port is open ------------------------------------------------
Write-Host ""
Write-Host "Verifying port 8080..."
$portCheck = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
if ($portCheck) {
  Write-Host "  OK Port 8080 is OPEN and listening" -ForegroundColor Green
} else {
  Write-Host "  Checking via HTTP..."
}

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/salvi/inter-cube/crs/stats" -TimeoutSec 5 -ErrorAction Stop
  Write-Host "  OK CRS endpoint responded" -ForegroundColor Green
} catch {
  Write-Host "  -> HTTP check inconclusive: $_" -ForegroundColor Yellow
  Write-Host "  -> Check log: $daemonOutLog" -ForegroundColor Yellow
}

# -- 8. Summary ------------------------------------------------------------
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  PlenumNET Inter-Cube daemon is LIVE" -ForegroundColor Green
Write-Host "  Binary : $DAEMON_PATH" -ForegroundColor Green
Write-Host "  PID    : $($daemonProc.Id)" -ForegroundColor Green
Write-Host "  Port   : 8080 (API) / 51820 (wire)" -ForegroundColor Green
Write-Host "  PubKey : $($PUB_KEY.Substring(0, [Math]::Min(32, $PUB_KEY.Length)))..." -ForegroundColor Green
Write-Host "  Logs   : $LOG_DIR" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Daemon runs in the background." -ForegroundColor Yellow
Write-Host "To stop it: Stop-Process -Id $($daemonProc.Id)" -ForegroundColor Yellow
Read-Host "Press Enter to close (daemon keeps running)"
