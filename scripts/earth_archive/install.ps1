param([string]$Target = 'C:\downloads\isopsephy_engine_globe_package_v0_0_21', [switch]$Interactive)
$ErrorActionPreference = 'Stop'
$Base = '@@BASE@@'
$Reporter = '@@TOKEN@@'
$Expected = ConvertFrom-Json @'
@@HASHES@@
'@
# This installer carries a narrow, expiring status-report credential. Do not share it.
# No execution-policy changes, administrator escalation, AWS CLI or Python packages.
if ($Interactive) {
    Add-Type -AssemblyName System.Windows.Forms
    $Previous = Get-ItemProperty -Path 'HKCU:\Software\Capomastro\YodaEarth' -Name Target -ErrorAction SilentlyContinue
    if ($Previous -and $Previous.Target) { $Target = $Previous.Target }
    $Consent = [System.Windows.Forms.MessageBox]::Show(
        "Install or update Earth & Isopsephy on this Windows account?`n`nSetup will keep existing archive data, install a private Python runtime if needed, and start scheduled downloads while you are signed in.`n`nThe full global archive requires several terabytes. Choose the archive drive in the next window.",
        'Yoda Earth Setup', 'OKCancel', 'Information')
    if ($Consent -ne 'OK') { return }
    $Folder = New-Object System.Windows.Forms.FolderBrowserDialog
    $Folder.Description = 'Choose the Earth archive folder. Updates: select the same folder to keep and resume your data.'
    $Folder.SelectedPath = $Target
    $Folder.ShowNewFolderButton = $true
    if ($Folder.ShowDialog() -ne 'OK') { return }
    $Target = $Folder.SelectedPath
    $Folder.Dispose()
}
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$Private = Join-Path $Target '.yoda-earth'
New-Item -ItemType Directory -Force -Path $Private | Out-Null
$Sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
# Removing inheritance does not remove pre-existing explicit grants. Replace
# the complete DACL rather than merely granting this user another permission.
$PrivateAcl = New-Object System.Security.AccessControl.DirectorySecurity
$PrivateAcl.SetAccessRuleProtection($true, $false)
$OwnerSid = New-Object System.Security.Principal.SecurityIdentifier($Sid)
$PrivateAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    $OwnerSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $Private -AclObject $PrivateAcl
$Python = $null
$PythonCommand = Get-Command python -CommandType Application -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -notlike '*\Microsoft\WindowsApps\*' } | Select-Object -First 1
$Launcher = Get-Command py -CommandType Application -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -notlike '*\Microsoft\WindowsApps\*' } | Select-Object -First 1
$ProbePreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
if ($Launcher) {
    $Python = (& $Launcher.Source -3 -c 'import sys; print(sys.executable) if sys.version_info >= (3,11) else None' 2>$null)
} elseif ($PythonCommand -and $PythonCommand.Source -notlike '*\Microsoft\WindowsApps\*') {
    $Python = (& $PythonCommand.Source -c 'import sys; print(sys.executable) if sys.version_info >= (3,11) else None' 2>$null)
}
$ProbeExit = if ($Python) { $LASTEXITCODE } else { 1 }
$ErrorActionPreference = $ProbePreference
if (-not $Python -or $ProbeExit -ne 0) {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This setup requires 64-bit Windows.' }
    # Official CPython embeddable distribution. SHA-256 pinned at packaging.
    $Runtime = Join-Path $Private 'runtime-3.13.17'
    $Python = Join-Path $Runtime 'python.exe'
    if (-not (Test-Path $Python)) {
        Write-Host 'Downloading the private Python runtime from python.org...'
        $RuntimeZip = Join-Path $Private 'python-runtime.download.zip'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip' -OutFile $RuntimeZip
        if ((Get-FileHash -Algorithm SHA256 $RuntimeZip).Hash.ToLowerInvariant() -ne '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38') {
            Remove-Item -LiteralPath $RuntimeZip -Force
            throw 'Python runtime integrity check failed. Nothing from that download was executed.'
        }
        $RuntimeStage = Join-Path $Private ('runtime-stage-' + [guid]::NewGuid().ToString('N'))
        Expand-Archive -LiteralPath $RuntimeZip -DestinationPath $RuntimeStage
        # Embeddable Python is isolated; allow only its own library and our parent module directory.
        @('python313.zip','.', '..') | Set-Content -Encoding ASCII (Join-Path $RuntimeStage 'python313._pth')
        Move-Item -LiteralPath $RuntimeStage -Destination $Runtime
        Remove-Item -LiteralPath $RuntimeZip -Force
    }
}
& $Python -c 'import sys, ssl, sqlite3, ctypes; sys.exit(0 if sys.version_info >= (3,11) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python could not start. Setup has not stopped your existing archive.' }
# Validate every worker file BEFORE stopping an existing installation.
$Stage = Join-Path $Private ('setup-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Stage | Out-Null
foreach ($Property in $Expected.PSObject.Properties) {
    $Name = $Property.Name
    $Staging = Join-Path $Stage $Name
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/earth-archive/files/$Name" -OutFile $Staging
    if ((Get-FileHash -Algorithm SHA256 $Staging).Hash.ToLowerInvariant() -ne $Property.Value) {
        Remove-Item $Staging -Force
        throw "SHA-256 mismatch: $Name. That worker was not activated; your existing archive was not stopped."
    }
}
foreach ($Name in @('YodaEarthArchiveUpdate','YodaEarthArchiveViewer')) {
    $Existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($Existing -and $Existing.State -eq 'Running') { Stop-ScheduledTask -TaskName $Name }
}
foreach ($Property in $Expected.PSObject.Properties) {
    Move-Item -Force (Join-Path $Stage $Property.Name) (Join-Path $Private $Property.Name)
}
Remove-Item -LiteralPath $Stage -Force
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
$NativeRunner = Join-Path $Private 'launch.py'
$UpdateAction = New-ScheduledTaskAction -Execute $Python -Argument "`"$NativeRunner`""
$ViewerAction = New-ScheduledTaskAction -Execute $Python -Argument "`"$NativeRunner`" --serve"
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
if ($Interactive) {
    New-Item -Path 'HKCU:\Software\Capomastro\YodaEarth' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Capomastro\YodaEarth' -Name Target -Value $Target
    [System.Windows.Forms.MessageBox]::Show(
        "Setup finished and Windows jobs were started.`n`nReturn to Earth & Isopsephy in Yoda to watch the first connection and download progress. Catalogue reading may take time; setup does not mean the global archive has finished.`n`nYour files remain in: $Target`n`nKeep this setup file private and delete it after use.",
        'Yoda Earth Setup', 'OK', 'Information') | Out-Null
}
