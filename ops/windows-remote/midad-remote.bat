@echo off
rem Midad remote control from Windows: runs the server's operations over SSH (docs\DEPLOYMENT_GUIDE.md section 8.12).
rem The "Midad - ..." files next to this one call it:   midad-remote.bat ACTION
rem Your server is set in midad-settings.bat in this folder (a copy of midad-settings.example.bat).
rem Needs the OpenSSH client that comes with Windows 10 and 11 (ssh, scp, ssh-keygen).
setlocal
chcp 65001 >nul
set "MR_HERE=%~dp0"
set "MR_ACTION=%~1"
if "%MR_ACTION%"=="" set "MR_ACTION=menu"
set "MR_RC=0"
title Midad - %MR_ACTION%

if not exist "%MR_HERE%midad-settings.bat" goto no_settings
call "%MR_HERE%midad-settings.bat"
if not defined MIDAD_PORT set "MIDAD_PORT=22"
if not defined MIDAD_DIR set "MIDAD_DIR=/opt/midad"
if not defined MIDAD_ENV set "MIDAD_ENV=prod"
if not defined MIDAD_KEY set "MIDAD_KEY=%USERPROFILE%\.ssh\midad_ed25519"
if not defined MIDAD_ALIAS set "MIDAD_ALIAS=midad"
if not defined MIDAD_BACKUPS_HERE set "MIDAD_BACKUPS_HERE=%USERPROFILE%\Documents\Midad backups"
if "%MIDAD_HOST%"=="" goto bad_settings
if "%MIDAD_USER%"=="" goto bad_settings
if /i "%MIDAD_HOST%"=="server.example.com" goto bad_settings
if /i "%MIDAD_USER%"=="your-user" goto bad_settings
where ssh.exe >nul 2>nul || goto no_ssh

set "MR_TARGET=%MIDAD_USER%@%MIDAD_HOST%"
set "MR_HELPER=sudo /usr/local/sbin/midad-remote --dir %MIDAD_DIR% --env %MIDAD_ENV%"
call :options

if /i "%MR_ACTION%"=="setup" goto setup
if /i "%MR_ACTION%"=="download" goto download
if /i "%MR_ACTION%"=="shell" goto shell

echo Connecting to %MIDAD_HOST%. When the server asks for a password, type your server password (it is not shown).
echo.
ssh -t %MR_SSH% %MR_TARGET% "%MR_HELPER% %MR_ACTION%"
set "MR_RC=%ERRORLEVEL%"
if not "%MR_RC%"=="0" call :failed
goto done

rem ---------------------------------------------------------------- a root shell in the Midad folder
:shell
echo A root shell in %MIDAD_DIR% on %MIDAD_HOST%. Type exit to leave.
echo.
ssh -t %MR_SSH% %MR_TARGET% "cd %MIDAD_DIR% && sudo -s"
set "MR_RC=%ERRORLEVEL%"
goto done

rem ---------------------------------------------------------------- the backups, copied to this PC
:download
set "MR_DEST=%MIDAD_BACKUPS_HERE%"
echo Copying the backups of %MIDAD_HOST% to "%MR_DEST%".
echo.
ssh -t %MR_SSH% %MR_TARGET% "%MR_HELPER% download-prepare"
set "MR_RC=%ERRORLEVEL%"
if not "%MR_RC%"=="0" goto download_failed
if not exist "%MR_DEST%" mkdir "%MR_DEST%"
scp %MR_SCP% -p "%MR_TARGET%:.midad-download/*" "%MR_DEST%"
set "MR_RC=%ERRORLEVEL%"
ssh %MR_SSH% %MR_TARGET% "rm -rf .midad-download"
if not "%MR_RC%"=="0" goto download_failed
echo.
echo Checking every backup here against its checksum...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$d = $env:MR_DEST; $n = 0; $bad = 0; foreach ($f in Get-ChildItem -LiteralPath $d -Filter 'midad-backup-*.tar*' | Where-Object { $_.Name -notlike '*.sha256' }) { $n++; $s = $f.FullName + '.sha256'; if (Test-Path -LiteralPath $s) { $want = ((Get-Content -LiteralPath $s -Raw).Trim() -split '\s+')[0].ToLower(); $got = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower(); if ($want -ne $got) { $bad++; Write-Host ('  DAMAGED: ' + $f.Name) } } }; Write-Host ('  ' + $n + ' backups in this folder, ' + $bad + ' damaged.'); if ($bad -gt 0) { exit 1 }"
set "MR_RC=%ERRORLEVEL%"
echo The backups are encrypted: they open only with the backup passphrase. Keep a copy on a USB drive too.
start "" "%MR_DEST%"
goto done
:download_failed
echo.
echo The backups were not copied (code %MR_RC%): see the lines above.
goto done

rem ---------------------------------------------------------------- first-time setup
:setup
echo == Midad remote control: first-time setup for %MR_TARGET%
where ssh-keygen.exe >nul 2>nul || goto no_ssh
where scp.exe >nul 2>nul || goto no_ssh
if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
echo.
echo 1) A key for this PC, so that connecting no longer asks for the password: %MIDAD_KEY%
if exist "%MIDAD_KEY%" echo    It exists already.
if exist "%MIDAD_KEY%" goto setup_put_key
echo    It asks for a passphrase: press Enter twice for none, or type one if other people use this PC.
ssh-keygen -t ed25519 -f "%MIDAD_KEY%" -C "midad-remote %COMPUTERNAME%"
if errorlevel 1 goto setup_failed
call :options
:setup_put_key
echo.
echo 2) Putting the key on the server. Type the server password when it asks.
set "MR_PUB="
set /p MR_PUB=<"%MIDAD_KEY%.pub"
if not defined MR_PUB goto setup_failed
ssh %MR_SSH% %MR_TARGET% "umask 077; mkdir -p .ssh; touch .ssh/authorized_keys; chmod 700 .ssh; chmod 600 .ssh/authorized_keys; grep -qxF '%MR_PUB%' .ssh/authorized_keys || echo '%MR_PUB%' >> .ssh/authorized_keys; echo '   The key is on the server.'"
if errorlevel 1 goto setup_failed
echo.
echo 3) Checking that the key works...
ssh %MR_SSH% -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no %MR_TARGET% "echo '   It works: connecting no longer asks for the password.'"
if errorlevel 1 echo    The key was not accepted. The Midad files still work: they ask the server password to connect.
echo.
echo 4) Installing the Midad helper on the server. Type the server password when sudo asks.
scp %MR_SCP% "%MR_HERE%server\midad-remote.sh" "%MR_TARGET%:.midad-remote.sh"
if errorlevel 1 goto setup_failed
ssh -t %MR_SSH% %MR_TARGET% "sed -i 's/\r$//' .midad-remote.sh && sudo install -o root -g root -m 755 .midad-remote.sh /usr/local/sbin/midad-remote && rm -f .midad-remote.sh && %MR_HELPER% check"
if errorlevel 1 goto setup_failed
echo.
echo 5) "ssh %MIDAD_ALIAS%" for PowerShell, in %USERPROFILE%\.ssh\config
findstr /x /i /c:"Host %MIDAD_ALIAS%" "%USERPROFILE%\.ssh\config" >nul 2>nul && echo    It is there already.
findstr /x /i /c:"Host %MIDAD_ALIAS%" "%USERPROFILE%\.ssh\config" >nul 2>nul && goto setup_done
>>"%USERPROFILE%\.ssh\config" echo.
>>"%USERPROFILE%\.ssh\config" echo Host %MIDAD_ALIAS%
>>"%USERPROFILE%\.ssh\config" echo     HostName %MIDAD_HOST%
>>"%USERPROFILE%\.ssh\config" echo     User %MIDAD_USER%
>>"%USERPROFILE%\.ssh\config" echo     Port %MIDAD_PORT%
>>"%USERPROFILE%\.ssh\config" echo     IdentityFile "%MIDAD_KEY%"
echo    Added: PowerShell can now connect with   ssh %MIDAD_ALIAS%
:setup_done
echo.
echo Setup finished. "Midad - Control panel" does everything with one password; the other "Midad - ..." files do one thing each.
goto done
:setup_failed
set "MR_RC=1"
echo.
echo Setup stopped at the step above: see its message. You can run it again: the finished steps are kept.
goto done

rem ---------------------------------------------------------------- helpers and messages
:options
set MR_SSH=-p %MIDAD_PORT% -o ServerAliveInterval=30
set MR_SCP=-P %MIDAD_PORT%
if exist "%MIDAD_KEY%" set MR_SSH=-p %MIDAD_PORT% -o ServerAliveInterval=30 -i "%MIDAD_KEY%"
if exist "%MIDAD_KEY%" set MR_SCP=-P %MIDAD_PORT% -i "%MIDAD_KEY%"
exit /b 0

:failed
echo.
echo It did not finish (code %MR_RC%). See the lines above. Usual causes:
echo   "command not found": the helper is not on the server yet: run "Midad - Setup first time" once.
echo   "Sorry, try again" or "incorrect password": the password for sudo is your server password.
echo   "Connection timed out" or "refused": the server is off, or this PC has no internet.
exit /b 0

:no_settings
set "MR_RC=1"
echo midad-settings.bat is missing in "%MR_HERE%".
echo Copy midad-settings.example.bat to midad-settings.bat, then open it in Notepad and write your server's address and user.
goto done

:bad_settings
set "MR_RC=1"
echo Open midad-settings.bat in Notepad and write your server's address (MIDAD_HOST) and user (MIDAD_USER).
goto done

:no_ssh
set "MR_RC=1"
echo The OpenSSH client is missing. Windows Settings, Apps, Optional features, Add a feature: "OpenSSH Client".
goto done

:done
echo.
pause
endlocal & exit /b %MR_RC%
