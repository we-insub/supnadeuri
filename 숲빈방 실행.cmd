@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0app" || goto failed
where node >nul 2>nul
if errorlevel 1 goto missing
where npm >nul 2>nul
if errorlevel 1 goto missing
node scripts\check-runtime.mjs
if errorlevel 1 goto failed
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
echo Forest Rooms: http://127.0.0.1:3000/
echo Keep this window open. Press Ctrl+C to stop.
call npm start
if errorlevel 1 goto failed
exit /b 0
:missing
echo Install Node.js 22.13 or later from https://nodejs.org then reopen this file.
:failed
echo Could not start. See the message above and README.md.
pause
exit /b 1
