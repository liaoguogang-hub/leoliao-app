@echo off
setlocal EnableExtensions
set "PS1=D:\leoliao-app\scripts\check-oss-sync.ps1"
set "LOG=D:\leoliao-app\scripts\oss-sync-check.log"

rem NOTE: no "pause" here on purpose.
rem   Scheduled tasks have no interactive console -> pause would hang forever
rem   (task stays Running until ExecutionTimeLimit kills it).
rem   Pause only when a human double-clicked this file (i.e. not run by Task Scheduler).

set "PAUSE_AT_END=0"
echo %CMDCMDLINE% | find /i "%~nx0" >nul 2>&1 && set "PAUSE_AT_END=1"

fltmc >nul 2>&1
if errorlevel 1 (
    echo [INFO] Administrator required - requesting elevation ^(UAC^)...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Fix
set "RC=%errorlevel%"
if "%PAUSE_AT_END%"=="1" (
    echo.
    echo [DONE] exit code = %RC%   (0=ok 1=warn 2=fail)
    echo [LOG ] %LOG%
    pause
)
exit /b %RC%