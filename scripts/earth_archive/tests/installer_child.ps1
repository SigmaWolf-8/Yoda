# Only this child process loses Python discovery; the machine and parent do not.
param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Target,
    [ValidateSet('System','Private')][string]$RuntimeMode
)
$ErrorActionPreference = 'Stop'
if ($RuntimeMode -eq 'Private') {
    # Do not include SystemRoot: some Windows hosts put py.exe there.
    $env:PATH = $PSHOME
    Remove-Item Env:PYTHONHOME, Env:PYTHONPATH -ErrorAction SilentlyContinue
    Set-Location -LiteralPath (Split-Path -Parent $Installer)
    foreach ($Name in @('python','py')) {
        if (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue) {
            throw "$Name unexpectedly resolves in the installer child"
        }
    }
    Write-Host 'PASS: installer child cannot discover python or py'
}
& $Installer -Target $Target
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
