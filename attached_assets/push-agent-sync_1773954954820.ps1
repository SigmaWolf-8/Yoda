# Push Agent Sync Feature to GitHub
# Usage: powershell -ExecutionPolicy Bypass -File push-agent-sync.ps1

$ErrorActionPreference = "Stop"

$TARBALL = "$HOME\Downloads\yoda\yoda-COMPLETE-FINAL-v2.tar.gz"
$WORK_DIR = "$HOME\yoda-merge-workspace"

Write-Host "=== Push Agent Sync Feature ===" -ForegroundColor Cyan

if (-Not (Test-Path $TARBALL)) {
    Write-Host "Tarball not found at $TARBALL" -ForegroundColor Red
    exit 1
}

if (-Not (Test-Path $WORK_DIR)) {
    Write-Host "Workspace not found. Clone first." -ForegroundColor Red
    exit 1
}

# Extract to temp
$EXTRACT_DIR = Join-Path $env:TEMP "yoda-sync-$(Get-Random)"
New-Item -ItemType Directory -Path $EXTRACT_DIR -Force | Out-Null
tar xzf $TARBALL -C $EXTRACT_DIR
$SRC = Join-Path $EXTRACT_DIR "yoda"
if (-Not (Test-Path $SRC)) { $SRC = $EXTRACT_DIR }

# Copy only the changed files
Set-Location $WORK_DIR
git checkout main
git pull origin main

# Overwrite the 3 changed files
Copy-Item (Join-Path $SRC "crates\yoda-api\src\agents.rs") -Destination (Join-Path $WORK_DIR "crates\yoda-api\src\agents.rs") -Force
Copy-Item (Join-Path $SRC "crates\yoda-api\src\main.rs") -Destination (Join-Path $WORK_DIR "crates\yoda-api\src\main.rs") -Force
Copy-Item (Join-Path $SRC "crates\yoda-api\src\routes.rs") -Destination (Join-Path $WORK_DIR "crates\yoda-api\src\routes.rs") -Force

Write-Host "  Updated: agents.rs (NEW), main.rs, routes.rs" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $EXTRACT_DIR -ErrorAction SilentlyContinue

# Stage and push
git add -A
git diff --cached --stat
$changed = (git diff --cached --numstat | Measure-Object -Line).Lines
Write-Host "  $changed files changed" -ForegroundColor White

if ($changed -eq 0) {
    Write-Host "  No changes." -ForegroundColor Yellow
    exit 0
}

$confirm = Read-Host "Push to GitHub? (y/N)"
if ($confirm -eq "y") {
    git commit -m "Add upstream agent sync: 5 new endpoints (list, detail, sync-status, sync, review)"
    git push origin main
    Write-Host "=== PUSHED ===" -ForegroundColor Green
} else {
    Write-Host "  Staged but not pushed." -ForegroundColor Yellow
}
