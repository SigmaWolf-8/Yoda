param([string]$Target = 'C:\downloads\isopsephy_engine_globe_package_v0_0_21')
$ErrorActionPreference = 'Stop'
$Base = '@@BASE@@'
$Reporter = '@@TOKEN@@'
$Expected = ConvertFrom-Json @'
@@HASHES@@
'@
# This installer carries a narrow, expiring status-report credential. Do not share it.
# No execution-policy changes, administrator escalation, AWS CLI or Python packages.
$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
$Launcher = Get-Command py -ErrorAction SilentlyContinue
if ($Launcher) {
    $Python = (& $Launcher.Source -3 -c 'import sys; print(sys.executable)')
} elseif ($PythonCommand) {
    $Python = (& $PythonCommand.Source -c 'import sys; print(sys.executable)')
} else { throw 'Install Python 3.11 or later, then rerun this installer.' }
if ($LASTEXITCODE -ne 0 -or -not $Python) { throw 'Python could not start.' }
& $Python -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or later is required.' }
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$Private = Join-Path $Target '.yoda-earth'
New-Item -ItemType Directory -Force -Path $Private | Out-Null
$Sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $Private /inheritance:r /grant:r "*${Sid}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict access to the reporting configuration.' }
foreach ($Name in @('YodaEarthArchiveUpdate','YodaEarthArchiveViewer')) {
    $Existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($Existing -and $Existing.State -eq 'Running') { Stop-ScheduledTask -TaskName $Name }
}
foreach ($Property in $Expected.PSObject.Properties) {
    $Name = $Property.Name
    $Destination = Join-Path $Private $Name
    $Staging = "$Destination.download"
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/earth-archive/files/$Name" -OutFile $Staging
    if ((Get-FileHash -Algorithm SHA256 $Staging).Hash.ToLowerInvariant() -ne $Property.Value) {
        Remove-Item $Staging -Force
        throw "SHA-256 mismatch: $Name. Nothing was executed."
    }
    Move-Item -Force $Staging $Destination
}
@{base=$Base; python=$Python; target=$Target; installation='@@ID@@'} |
    ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Private 'config.json')
ConvertTo-SecureString $Reporter -AsPlainText -Force | ConvertFrom-SecureString |
    Set-Content -Encoding ASCII (Join-Path $Private 'report-token.dpapi')
$Reporter = $null
$Runner = Join-Path $Private 'run-earth.ps1'
@'
param([switch]$Serve,[switch]$Verify)
$ErrorActionPreference = 'Stop'
$Config = Get-Content -Raw (Join-Path $PSScriptRoot 'config.json') | ConvertFrom-Json
$Client = Join-Path $PSScriptRoot 'client.py'
$Arguments = @($Client,'--target',$Config.target)
if ($Serve) { $Arguments += '--serve' }
if ($Verify) { $Arguments += '--verify' }
try {
    if (-not $Serve) {
        $Secure = (Get-Content -Raw (Join-Path $PSScriptRoot 'report-token.dpapi')).Trim() | ConvertTo-SecureString
        $env:YODA_ARCHIVE_REPORT_TOKEN = ([System.Net.NetworkCredential]::new('', $Secure)).Password
    }
    # Windows PowerShell 5 may wrap native stderr as ErrorRecords. The worker
    # handles source failures itself; use its exit code rather than killing it
    # on the first diagnostic line.
    $ErrorActionPreference = 'Continue'
    & $Config.python @Arguments >> (Join-Path $PSScriptRoot 'runner.log') 2>&1
    $Code = $LASTEXITCODE
} finally { Remove-Item Env:YODA_ARCHIVE_REPORT_TOKEN -ErrorAction SilentlyContinue }
exit $Code
'@ | Set-Content -Encoding UTF8 $Runner
$User = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$UpdateAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -File `"$Runner`""
$ViewerAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -File `"$Runner`" -Serve"
$Daily = New-ScheduledTaskTrigger -Daily -At '03:00'
$Logon = New-ScheduledTaskTrigger -AtLogOn -User $User
Register-ScheduledTask -TaskName 'YodaEarthArchiveUpdate' -Action $UpdateAction -Trigger @($Daily,$Logon) -Principal $Principal -Settings $Settings -Force | Out-Null
Register-ScheduledTask -TaskName 'YodaEarthArchiveViewer' -Action $ViewerAction -Trigger $Logon -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName 'YodaEarthArchiveViewer'
Start-ScheduledTask -TaskName 'YodaEarthArchiveUpdate'
Write-Host 'Archive jobs registered and launch requested. This is not evidence that any dataset has downloaded.'
Write-Host "Inspect $Private\runner.log and Yoda Earth & Isopsephy for actual progress."
Write-Host 'The local archive viewer is http://127.0.0.1:18482 on this Windows computer.'
Write-Host 'These tasks run while this Windows user is signed in. Delete this installer after use; do not share it.'
