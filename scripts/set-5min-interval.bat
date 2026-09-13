@echo off
setlocal EnableExtensions
set "PS1=D:\leoliao-app\scripts\set-5min-interval.ps1"
set "LOG=D:\leoliao-app\scripts\set-5min-interval.log"

rem ---- admin check: fltmc only works when elevated ----
fltmc >nul 2>&1
if errorlevel 1 (
    echo [INFO] Administrator rights required. Requesting elevation ^(UAC^)...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [OK] Elevated - running as Administrator
echo [INFO] Setting LeoLiaoOSSManifest trigger intervals to PT5M ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RC=%errorlevel%"
echo.
echo [DONE] exit code = %RC%   (0 = success)
echo [LOG ] %LOG%
echo.
pause