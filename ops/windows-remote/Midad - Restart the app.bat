@echo off
rem Midad: restart the app instances one at a time, without downtime (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" restart
