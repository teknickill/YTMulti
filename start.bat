@echo off
rem Starts MultiStream and opens it in your browser. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js isn't installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
start "" http://localhost:3000
node server.js
pause
