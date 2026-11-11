@echo off
rem Midad: test the newest backup in a scratch database (changes nothing) (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" verify
