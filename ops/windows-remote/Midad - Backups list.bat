@echo off
rem Midad: the backups kept, their checksums, the last tests and the schedule (on the server, over SSH; docs\DEPLOYMENT_GUIDE.md section 8.12).
call "%~dp0midad-remote.bat" backups
