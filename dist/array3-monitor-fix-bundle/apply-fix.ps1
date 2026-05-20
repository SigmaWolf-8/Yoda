# Array3 Monitor - drop-in apply script (Windows PowerShell)
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File array3-monitor-fix-bundle\apply-fix.ps1

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target    = Join-Path (Get-Location) 'frontend\public\array3-monitor.html'
$Src       = Join-Path $ScriptDir 'array3-monitor.html.fixed'

if (-not (Test-Path $Target)) {
    Write-Error "Target not found: $Target. Run this script from the repo root."
    exit 1
}
if (-not (Test-Path $Src)) {
    Write-Error "Bundled fixed file not found at $Src"
    exit 1
}

$Stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = "$Target.bak.$Stamp"
Copy-Item -Path $Target -Destination $Backup -Force
Write-Host "Backup written to: $Backup"

Copy-Item -Path $Src -Destination $Target -Force
Write-Host "Patched: $Target"

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart (or hard-refresh) your frontend so the new HTML is served."
Write-Host "  2. Load /monitoring from your machine's hostname (LAN IP, public IP, or localhost)."
Write-Host "  3. Open DevTools - Network and confirm requests go to <your-host>:11488/11515/11906."
Write-Host ""
Write-Host "See verify.md in this bundle for the full checklist."
