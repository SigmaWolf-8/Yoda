# Real Windows APIs, no Pester/module installation, elevation or policy bypass.
# Run only in a disposable Windows CI VM. All deletions are restricted to this
# invocation's GUID directory and tasks whose actions point into that directory.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Wait-For([scriptblock]$Check, [string]$Message) {
    $Deadline = (Get-Date).AddSeconds(45)
    do {
        if (& $Check) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $Deadline)
    throw "Timed out: $Message"
}
function Read-Events {
    @(Get-ChildItem -LiteralPath (Join-Path $Root 'events') -Filter '*.json' |
        ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json })
}
function Set-Control([bool]$Hold, [int]$Code) {
    @{hold=$Hold; exit_code=$Code} | ConvertTo-Json |
        Set-Content -Encoding UTF8 -LiteralPath (Join-Path $Root 'control.json')
}
function Assert-OwnedTask($Task) {
    Assert ($Task.TaskName -in $TaskNames) 'Refusing to touch a task not owned by this test'
    Assert ($Task.TaskPath -eq '\') 'Unexpected task folder'
    Assert ($Task.Actions.Count -eq 1) 'Unexpected task actions'
    Assert ($Task.Actions[0].Arguments.Contains("`"$Runner`"")) 'Task action is outside the fixture'
}
function Stop-OwnedTasks {
    foreach ($Name in $TaskNames) {
        $Task = Get-ScheduledTask -TaskPath '\' -TaskName $Name -ErrorAction SilentlyContinue
        if ($Task) {
            Assert-OwnedTask $Task
            Stop-ScheduledTask -InputObject $Task
        }
    }
}
function Invoke-Installer([string]$Destination) {
    & $PowerShell -NoProfile -NonInteractive -File $Installer -Target $Destination
    Assert ($LASTEXITCODE -eq 0) "Installer failed with exit $LASTEXITCODE"
}
function Assert-SafeScript([string]$Text) {
    Assert ($Text -notmatch '(?i)Set-ExecutionPolicy|-ExecutionPolicy|-Verb\s+RunAs|#requires\s+-RunAsAdministrator') 'Policy bypass or elevation found'
    $Tokens = $null
    $Errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$Tokens, [ref]$Errors)
    Assert ($Errors.Count -eq 0) 'Script does not parse under Windows PowerShell 5.1'
}

Assert ($PSVersionTable.PSEdition -eq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1) 'This test requires Windows PowerShell 5.1, not pwsh'
Assert (-not (Test-Path Env:YODA_ARCHIVE_REPORT_TOKEN)) 'Do not run with a reporting credential'
$PolicyBefore = Get-ExecutionPolicy -List | ConvertTo-Json -Compress
$IdentityBefore = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$AdminBefore = ([System.Security.Principal.WindowsPrincipal][System.Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
$PowerShell = Join-Path $PSHOME 'powershell.exe'
$Source = Split-Path $PSScriptRoot -Parent
$Id = [Guid]::NewGuid().ToString('N')
$Root = Join-Path ([System.IO.Path]::GetTempPath()) "earth installer fixture $Id"
$Target = Join-Path $Root 'archive target with spaces'
$Rejected = Join-Path $Root 'rejected target with spaces'
$Private = Join-Path $Target '.yoda-earth'
$Runner = Join-Path $Private 'run-earth.ps1'
$Installer = Join-Path $Root 'install fixture.ps1'
$TaskNames = @("YodaEarthCI_${Id}_Update", "YodaEarthCI_${Id}_Viewer")
$Server = $null
$Passed = $false

try {
    Assert (-not (Test-Path -LiteralPath $Root)) 'Fixture root already exists'
    foreach ($Name in $TaskNames) {
        Assert (-not (Get-ScheduledTask -TaskPath '\' -TaskName $Name -ErrorAction SilentlyContinue)) 'Task name collision'
    }
    New-Item -ItemType Directory -Path $Root | Out-Null
    Set-Content -LiteralPath (Join-Path $Root 'EARTH_INSTALLER_TEST_ONLY') -Value $Id
    New-Item -ItemType Directory -Path (Join-Path $Root 'served'), (Join-Path $Root 'events') | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixture_worker.py') -Destination (Join-Path $Root 'served\client.py')
    foreach ($Name in @('acquire.py','viewer.py','retention.py','retention_ui.py','GUIDE.txt')) {
        Copy-Item -LiteralPath (Join-Path $Source $Name) -Destination (Join-Path $Root "served\$Name")
    }
    $Hashes = [ordered]@{}
    foreach ($Name in @('client.py','acquire.py','viewer.py','retention.py','retention_ui.py','GUIDE.txt')) {
        $Hashes[$Name] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Root "served\$Name")).Hash.ToLowerInvariant()
    }
    $Python = (Get-Command python -CommandType Application).Source
    $ServerScript = Join-Path $PSScriptRoot 'fixture_server.py'
    $Server = Start-Process -FilePath $Python -ArgumentList "`"$ServerScript`" `"$Root`"" -PassThru -WindowStyle Hidden
    Wait-For { Test-Path -LiteralPath (Join-Path $Root 'port.txt') } 'loopback fixture server'
    $Port = [int](Get-Content -LiteralPath (Join-Path $Root 'port.txt'))
    $Base = "http://127.0.0.1:$Port"
    $Template = Get-Content -Raw -LiteralPath (Join-Path $Source 'install.ps1')
    Assert-SafeScript $Template
    Assert ($Template.Contains("-RunLevel Limited")) 'Installer must use a limited task principal'
    # Only deployment placeholders and the two fixed task identifiers change.
    # No installer logic or generated runner code is patched or mocked.
    $Rendered = $Template.Replace('@@BASE@@', $Base).
        Replace('@@TOKEN@@', 'earth-ci-dummy-not-a-credential').
        Replace('@@ID@@', 'windows-ci-fixture').
        Replace('@@HASHES@@', ($Hashes | ConvertTo-Json)).
        Replace('YodaEarthArchiveUpdate', $TaskNames[0]).
        Replace('YodaEarthArchiveViewer', $TaskNames[1])
    Assert ($Rendered -notmatch '@@[A-Z]+@@|YodaEarthArchiveUpdate|YodaEarthArchiveViewer') 'Unisolated installer template'
    Assert-SafeScript $Rendered
    $Rendered | Set-Content -Encoding UTF8 -LiteralPath $Installer
    Set-Control $true 0

    # Mismatch must fail before credentials/runner/tasks are created or executed.
    Add-Content -LiteralPath (Join-Path $Root 'served\client.py') -Value '# tampered fixture'
    # PS5.1 wraps native stderr in ErrorRecords when redirected. This failure
    # is expected; inspect its native exit code rather than terminating here.
    try {
        $ErrorActionPreference = 'Continue'
        & $PowerShell -NoProfile -NonInteractive -File $Installer -Target $Rejected *> (Join-Path $Root 'rejected.log')
        $RejectedExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    Assert ($RejectedExit -ne 0) 'Tampered source was accepted'
    Assert ((Get-Content -Raw -LiteralPath (Join-Path $Root 'rejected.log')) -match 'SHA-256 mismatch') 'Failure was not hash pinning'
    Assert (-not (Test-Path -LiteralPath (Join-Path $Rejected '.yoda-earth\client.py'))) 'Tampered source was promoted'
    Assert (-not (Test-Path -LiteralPath (Join-Path $Rejected '.yoda-earth\client.py.download'))) 'Rejected staging bytes remain'
    Assert (-not (Test-Path -LiteralPath (Join-Path $Rejected '.yoda-earth\run-earth.ps1'))) 'Runner created on hash failure'
    foreach ($Name in $TaskNames) {
        Assert (-not (Get-ScheduledTask -TaskPath '\' -TaskName $Name -ErrorAction SilentlyContinue)) 'Hash failure registered a task'
    }
    Assert (@(Read-Events).Count -eq 0) 'Hash failure executed a payload'
    Copy-Item -Force -LiteralPath (Join-Path $PSScriptRoot 'fixture_worker.py') -Destination (Join-Path $Root 'served\client.py')

    Invoke-Installer $Target
    Wait-For { @(Read-Events).Count -eq 2 } 'both scheduled fixture workers to start'
    $FirstEvents = @(Read-Events)
    Assert (@($FirstEvents | Where-Object serve).Count -eq 1) 'Viewer did not run'
    Assert (@($FirstEvents | Where-Object { -not $_.serve }).Count -eq 1) 'Updater did not run'
    foreach ($Event in $FirstEvents) {
        Assert ($Event.target -eq $Target) 'Spaced target was not passed intact'
        Assert $Event.token_ok 'Runner DPAPI/token isolation failed'
        Assert (-not $Event.elevated) 'Scheduled worker was elevated'
    }
    foreach ($Name in $TaskNames) {
        $Task = Get-ScheduledTask -TaskPath '\' -TaskName $Name
        Assert-OwnedTask $Task
        Assert ($Task.State -eq 'Running') 'Task is not running'
        Assert ($Task.Principal.RunLevel -eq 'Limited') 'Elevated task principal'
        Assert ($Task.Principal.LogonType -eq 'Interactive') 'Task must use the signed-in user'
        $TaskSid = $Task.Principal.UserId
        if ($TaskSid -notmatch '^S-1-') {
            $Account = New-Object System.Security.Principal.NTAccount($TaskSid)
            $TaskSid = $Account.Translate([System.Security.Principal.SecurityIdentifier]).Value
        }
        Assert ($TaskSid -eq $IdentityBefore) 'Wrong task owner'
        Assert ($Task.Actions[0].Arguments -notmatch '(?i)ExecutionPolicy|RunAs') 'Unsafe task command'
        Assert ($Task.Settings.MultipleInstances -eq 'IgnoreNew') 'Task permits overlapping instances'
        Assert $Task.Settings.StartWhenAvailable 'Task will not catch up on a missed start'
        Assert ($Task.Settings.ExecutionTimeLimit -eq 'PT0S') 'Archive task has a time limit'
        $TriggerTypes = @($Task.Triggers | ForEach-Object { $_.CimClass.CimClassName })
        Assert ($TriggerTypes -contains 'MSFT_TaskLogonTrigger') 'Missing logon trigger'
        if ($Name -eq $TaskNames[0]) {
            Assert ($TriggerTypes.Count -eq 2 -and $TriggerTypes -contains 'MSFT_TaskDailyTrigger') 'Missing daily update trigger'
        } else { Assert ($TriggerTypes.Count -eq 1) 'Unexpected viewer trigger' }
    }
    foreach ($Name in $Hashes.Keys) {
        Assert ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Private $Name)).Hash.ToLowerInvariant() -eq $Hashes[$Name]) "Source pin differs: $Name"
    }
    $Config = Get-Content -Raw -LiteralPath (Join-Path $Private 'config.json') | ConvertFrom-Json
    Assert ($Config.target -eq $Target -and $Config.base -eq $Base) 'Config changed the spaced path or loopback base'
    Assert (-not ($Config.PSObject.Properties.Name -contains 'token')) 'Plaintext token in config'
    $Cipher = (Get-Content -Raw -LiteralPath (Join-Path $Private 'report-token.dpapi')).Trim()
    Assert ($Cipher -ne 'earth-ci-dummy-not-a-credential') 'Credential stored in plaintext'
    $Secure = ConvertTo-SecureString $Cipher
    Assert (([System.Net.NetworkCredential]::new('', $Secure)).Password -eq 'earth-ci-dummy-not-a-credential') 'Current-user DPAPI round-trip failed'
    $Acl = Get-Acl -LiteralPath $Private
    Assert $Acl.AreAccessRulesProtected 'Private directory still inherits parent ACLs'
    foreach ($Path in @($Private, (Join-Path $Private 'report-token.dpapi'), (Join-Path $Private 'config.json'))) {
        $Rules = (Get-Acl -LiteralPath $Path).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
        Assert ($Rules.Count -gt 0) 'Missing current-user ACL'
        foreach ($Rule in $Rules) {
            Assert ($Rule.IdentityReference.Value -eq $IdentityBefore) 'Private files accessible to another principal'
            Assert ($Rule.AccessControlType -eq 'Allow') 'Unexpected ACL'
            Assert (($Rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) 'Owner lacks full control'
        }
    }
    Assert-SafeScript (Get-Content -Raw -LiteralPath $Runner)
    & $Python (Join-Path $PSScriptRoot 'check_bom_config.py') $Target
    Assert ($LASTEXITCODE -eq 0) 'Real client failed the UTF-8 BOM configuration check'
    Write-Host 'PASS: hash pins, spaced paths, BOM, DPAPI, ACLs and limited scheduled start'

    # Rerun while both jobs are live; user data and partial transfers must survive.
    $Sentinel = Join-Path $Target 'keep existing data.part'
    Set-Content -LiteralPath $Sentinel -Value 'fixture partial data'
    $Before = (Get-FileHash -LiteralPath $Sentinel).Hash
    Invoke-Installer $Target
    Wait-For { @(Read-Events).Count -eq 4 } 'rerun workers'
    Wait-For {
        @($FirstEvents | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue }).Count -eq 0
    } 'old worker processes to stop on rerun'
    Assert ((Get-FileHash -LiteralPath $Sentinel).Hash -eq $Before) 'Rerun modified existing data'
    foreach ($Name in $TaskNames) {
        Assert (@(Get-ScheduledTask -TaskPath '\' -TaskName $Name).Count -eq 1) 'Rerun duplicated a task'
    }
    Stop-OwnedTasks
    Wait-For {
        @($TaskNames | ForEach-Object { Get-ScheduledTask -TaskPath '\' -TaskName $_ } |
            Where-Object State -eq 'Running').Count -eq 0
    } 'scheduled stop'
    Wait-For {
        @((Read-Events) | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue }).Count -eq 0
    } 'scheduled child processes to stop'
    Write-Host 'PASS: rerun replaces running tasks and preserves existing data; stop terminates workers'

    Set-Control $false 0
    & $PowerShell -NoProfile -NonInteractive -File $Runner
    Assert ($LASTEXITCODE -eq 0) 'stderr incorrectly made a successful native worker fail'
    Set-Control $false 23
    & $PowerShell -NoProfile -NonInteractive -File $Runner -Verify
    Assert ($LASTEXITCODE -eq 23) 'Native failure exit code was swallowed'
    $VerifyEvents = @((Read-Events) | Where-Object verify)
    Assert ($VerifyEvents.Count -eq 1 -and $VerifyEvents[0].token_ok) 'Verify flag or decrypted token was lost'
    Assert ((Get-Content -Raw -LiteralPath (Join-Path $Private 'runner.log')) -match 'fixture stderr') 'Native diagnostic was not logged'
    # Catch environment leakage in the SAME PowerShell process after script exit.
    $Probe = Join-Path $Root 'environment probe.ps1'
    @'
param([string]$Runner)
& $Runner -Verify
if ($LASTEXITCODE -ne 23) { exit 91 }
if (Test-Path Env:YODA_ARCHIVE_REPORT_TOKEN) { exit 92 }
exit 0
'@ | Set-Content -Encoding UTF8 -LiteralPath $Probe
    & $PowerShell -NoProfile -NonInteractive -File $Probe -Runner $Runner
    Assert ($LASTEXITCODE -eq 0) 'Runner did not clear the reporting token on failure'
    $EventCount = @(Read-Events).Count
    Start-ScheduledTask -TaskPath '\' -TaskName $TaskNames[0]
    Wait-For { @(Read-Events).Count -gt $EventCount } 'scheduled native failure to execute'
    Wait-For {
        (Get-ScheduledTask -TaskPath '\' -TaskName $TaskNames[0]).State -ne 'Running' -and
        (Get-ScheduledTaskInfo -TaskPath '\' -TaskName $TaskNames[0]).LastTaskResult -eq 23
    } 'Task Scheduler to retain native exit code 23'
    Write-Host 'PASS: success/failure native exit propagation, stderr, Verify and token cleanup'
    $Passed = $true
} finally {
    # Never use a wildcard task name, remove a production task, or delete a path
    # inferred from downloaded content. Validate ownership again during cleanup.
    try {
        Stop-OwnedTasks
        foreach ($Name in $TaskNames) {
            $Task = Get-ScheduledTask -TaskPath '\' -TaskName $Name -ErrorAction SilentlyContinue
            if ($Task) {
                Assert-OwnedTask $Task
                Unregister-ScheduledTask -InputObject $Task -Confirm:$false
                Assert (-not (Get-ScheduledTask -TaskPath '\' -TaskName $Name -ErrorAction SilentlyContinue)) 'Test task remains registered'
            }
        }
    } finally {
        if ($Server -and -not $Server.HasExited) { $Server.Kill(); $Server.WaitForExit() }
        if (Test-Path -LiteralPath $Root) {
            Assert ((Get-Content -Raw -LiteralPath (Join-Path $Root 'EARTH_INSTALLER_TEST_ONLY')).Trim() -eq $Id) 'Refusing to remove an unowned directory'
            # Fail closed on unexpected junctions/symlinks instead of following them.
            Assert (@(Get-ChildItem -LiteralPath $Root -Recurse -Force |
                Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'Fixture contains a reparse point'
            Remove-Item -LiteralPath $Root -Recurse -Force
            Assert (-not (Test-Path -LiteralPath $Root)) 'Fixture directory remains'
        }
        Assert ((Get-ExecutionPolicy -List | ConvertTo-Json -Compress) -eq $PolicyBefore) 'Execution policy changed'
        Assert ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq $IdentityBefore) 'User identity changed'
        $AdminAfter = ([System.Security.Principal.WindowsPrincipal][System.Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
        Assert ($AdminAfter -eq $AdminBefore) 'Harness escalated privileges'
    }
}
Assert $Passed 'Installer checks did not finish'
Write-Host 'PASS: owned tasks/fixtures removed; no elevation or execution-policy changes'
exit 0
