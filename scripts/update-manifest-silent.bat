@echo off
chcp 65001 >nul
rem Called by Windows Task Scheduler (silent, logs to manifest-update.log)
rem NOTE: avoid multi-line "( ... )" blocks after chcp - cmd.exe re-reads the
rem       batch file by byte offset and can mis-parse them. Use goto instead.
set "PATH=C:\aliyun-cli;%PATH%"
set "ALIYUN_PROFILE=leo-oss"
cd /d "%~dp0"
echo [%date% %time%] ===== start ===== >> "%~dp0manifest-update.log"

rem pre-flight: aliyun CLI must exist, otherwise fail loudly with a nonzero code
if exist "C:\aliyun-cli\aliyun.exe" goto cli_ok
echo ERROR: aliyun.exe not found at C:\aliyun-cli\aliyun.exe >> "%~dp0manifest-update.log"
echo Reinstall Alibaba Cloud CLI, then this task will recover automatically. >> "%~dp0manifest-update.log"
echo [%date% %time%] ===== end (exit=2) ===== >> "%~dp0manifest-update.log"
exit /b 2

:cli_ok
"C:\Program Files\nodejs\node.exe" gen_oss_manifest.mjs >> "%~dp0manifest-update.log" 2>&1
set "RC=%errorlevel%"
echo [%date% %time%] ===== end (exit=%RC%) ===== >> "%~dp0manifest-update.log"

rem propagate node's exit code so Task Scheduler records the real result
rem (before this fix the bat always exited 0, so the watchdog reported
rem  LastResult=0 even while every single sync was failing)
exit /b %RC%