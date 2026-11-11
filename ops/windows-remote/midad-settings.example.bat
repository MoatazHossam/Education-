@echo off
rem Midad remote control: the server these files control (docs\DEPLOYMENT_GUIDE.md section 8.12).
rem Copy this file to midad-settings.bat in the same folder, open the copy in Notepad and fill it in.
rem midad-settings.bat stays on this PC: it is never part of the repository.

rem The server's address (its IP address or name) and the user you sign in with over SSH:
set "MIDAD_HOST=server.example.com"
set "MIDAD_USER=your-user"

rem Usually left as they are:
rem   the SSH port, the Midad folder on the server, the installation (prod or dev),
rem   this PC's key for the server, the name for "ssh midad" in PowerShell,
rem   and the folder on this PC that "Midad - Download backups to this PC" fills.
set "MIDAD_PORT=22"
set "MIDAD_DIR=/opt/midad"
set "MIDAD_ENV=prod"
set "MIDAD_KEY=%USERPROFILE%\.ssh\midad_ed25519"
set "MIDAD_ALIAS=midad"
set "MIDAD_BACKUPS_HERE=%USERPROFILE%\Documents\Midad backups"
