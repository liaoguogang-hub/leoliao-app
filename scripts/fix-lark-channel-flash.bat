@echo off
setlocal EnableExtensions
set "PS1=D:\leoliao-app\scripts\fix-lark-channel-flash.ps1"

rem --- reliable admin check ---
rem NOTE: do NOT use "fltmc" here. It returns success even without an
rem       elevated token, which made this script think it was already admin
rem       and then schtasks failed with "Access denied".
net session >nul 2>&1
if errorlevel 1 (
    echo [INFO] Administrator rights required - requesting elevation ^(UAC^)...
    echo [INFO] If a UAC prompt appears, click "Yes".
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [OK] Running as Administrator
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
pause