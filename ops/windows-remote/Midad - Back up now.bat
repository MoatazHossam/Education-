@echo off
rem Midad: back up now, with the choices the nightly backup uses (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" backup
