@echo off
rem Midad: restore a backup, or test one with --only-verify
rem Double-click it, or run it with options, e.g. ops\restore.bat --env prod (docs\DEPLOYMENT_GUIDE.md section 8).
rem Runs ops\midad.ps1 with PowerShell 7 when installed, else the PowerShell built into Windows.
setlocal
set "MIDAD_PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "MIDAD_PS=pwsh.exe"
"%MIDAD_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0midad.ps1" restore %*
set "MIDAD_RC=%ERRORLEVEL%"
rem Keep the window open when double-clicked; never wait in a scheduled task (--yes).
echo  %* | findstr /i /r /c:" --yes\>" /c:" -y\>" >nul || pause
exit /b %MIDAD_RC%
