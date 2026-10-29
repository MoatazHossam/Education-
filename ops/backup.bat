@echo off
rem Midad: back up the database (and, if chosen, the settings file and certificates)
rem Double-click it, or run it with options, e.g. ops\backup.bat --env prod --yes (docs\DEPLOYMENT_GUIDE.md section 8).
rem Runs ops\midad.ps1 with PowerShell 7 when installed, else the PowerShell built into Windows.
setlocal
set "MIDAD_PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "MIDAD_PS=pwsh.exe"
"%MIDAD_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0midad.ps1" backup %*
set "MIDAD_RC=%ERRORLEVEL%"
rem Keep the window open when double-clicked; never wait in a scheduled task (--yes).
echo  %* | findstr /i /r /c:" --yes\>" /c:" -y\>" >nul || pause
exit /b %MIDAD_RC%
