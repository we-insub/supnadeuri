@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0app" || goto failed
where node >nul 2>nul
if errorlevel 1 goto missing
node scripts\check-runtime.mjs
if errorlevel 1 goto failed
node scripts\import-session.mjs --interactive
if errorlevel 1 goto failed
pause
exit /b 0
:missing
echo Install Node.js 22.13 or later from https://nodejs.org then reopen this file.
:failed
echo Could not connect authentication. See the message above and README.md.
pause
exit /b 1
