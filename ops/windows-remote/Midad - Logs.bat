@echo off
rem Midad: follow the app's logs (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" logs
