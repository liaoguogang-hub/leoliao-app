@echo off
setlocal EnableExtensions
set "PS1=D:\leoliao-app\scripts\register-all-oss-tasks.ps1"

fltmc >nul 2>&1
if errorlevel 1 (
    echo [INFO] Admin required - requesting elevation ^(UAC^)...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [OK] Elevated - registering all OSS sync tasks
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
pause