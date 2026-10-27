@echo off
rem Curriculum Scope: start the app (builds the image the first time)
rem Double-click it, or run it with options, e.g. ops\start.bat --env prod (docs\DEPLOYMENT_GUIDE.md section 8).
rem Runs ops\cs.ps1 with PowerShell 7 when installed, else the PowerShell built into Windows.
setlocal
set "CS_PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "CS_PS=pwsh.exe"
"%CS_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0cs.ps1" start %*
set "CS_RC=%ERRORLEVEL%"
rem Keep the window open when double-clicked; never wait in a scheduled task (--yes).
echo  %* | findstr /i /r /c:" --yes\>" /c:" -y\>" >nul || pause
exit /b %CS_RC%
