@echo off
rem Midad: the daily report, emailed to the saved address (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" report
