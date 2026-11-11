@echo off
rem Midad: status, resources, disk and the newest backup, refreshed every 10 seconds (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" monitor
