@echo off
rem Mahdar (meeting minutes): stop it. Meetings and settings stay saved; start.bat starts it again.
setlocal
cd /d "%~dp0"
docker compose --env-file .env.docker stop
if errorlevel 1 (echo. & echo Mahdar could not be stopped. Is Docker Desktop running?) else (echo. & echo Mahdar is stopped. Double-click start.bat to start it again.)
pause
