@echo off
rem Midad: copy the backups to this PC and check them (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" download
