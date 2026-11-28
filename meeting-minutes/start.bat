@echo off
rem Mahdar (meeting minutes): set up the first time, start, and open it in the browser.
rem Double-click it. Needs Docker Desktop, running. Runs start.ps1 (next to this file) with
rem PowerShell 7 when installed, else the PowerShell built into Windows.
setlocal
set "MAHDAR_PS=powershell.exe"
where pwsh.exe >/dev/null 2>/dev/null && set "MAHDAR_PS=pwsh.exe"
"%MAHDAR_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "MAHDAR_RC=%ERRORLEVEL%"
rem Keep the window open when double-clicked, to read the messages.
pause
exit /b %MAHDAR_RC%
