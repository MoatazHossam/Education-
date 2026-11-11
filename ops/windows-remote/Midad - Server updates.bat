@echo off
rem Midad: install the server's system updates (asks first) (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" updates
