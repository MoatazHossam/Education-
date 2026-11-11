@echo off
rem Midad: show whether Midad is running and answering (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" status
