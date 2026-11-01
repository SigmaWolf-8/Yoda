@echo off
setlocal DisableDelayedExpansion
title Yoda Earth Setup
set "YODA_SETUP_FILE=%~f0"
echo Opening Yoda Earth setup...
powershell.exe -NoProfile -STA -Command "$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Windows.Forms; $hex=([IO.File]::ReadAllLines($env:YODA_SETUP_FILE) | Where-Object { $_.StartsWith('::YODA:') } | ForEach-Object { $_.Substring(7) }) -join ''; $bytes=New-Object byte[] ($hex.Length/2); for($i=0;$i -lt $bytes.Length;$i++) { $bytes[$i]=[Convert]::ToByte($hex.Substring($i*2,2),16) }; & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($bytes))) -Interactive; exit 0 } catch { [System.Windows.Forms.MessageBox]::Show(('Setup could not finish. '+$_.Exception.Message+' No execution-policy settings were changed. If your organization blocks setup, ask your administrator to approve it.'),'Yoda Earth Setup','OK','Error') | Out-Null; exit 1 }"
if errorlevel 1 (
  echo Setup could not finish. Review the error above.
  pause
  exit /b 1
)
exit /b 0
@@PAYLOAD@@
