@echo off
setlocal EnableExtensions
set "PS1=D:\leoliao-app\scripts\check-oss-sync.ps1"
set "LOG=D:\leoliao-app\scripts\oss-sync-check.log"

fltmc >nul 2>&1
if errorlevel 1 (
    echo [INFO] Administrator required - requesting elevation ^(UAC^)...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [OK] Running as Administrator
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%errorlevel%"
echo.
echo [DONE] exit code = %RC%   (0=ok 1=warn 2=fail)
echo [LOG ] %LOG%
pause