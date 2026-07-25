@echo off
chcp 65001 >nul
rem Called by Windows Task Scheduler (silent, logs to manifest-update.log)
set "PATH=C:\aliyun-cli;%PATH%"
set "ALIYUN_PROFILE=leo-oss"
cd /d "%~dp0"
echo [%date% %time%] ===== start ===== >> "%~dp0manifest-update.log"
"C:\Program Files\nodejs\node.exe" gen_oss_manifest.mjs >> "%~dp0manifest-update.log" 2>&1
echo [%date% %time%] ===== end (exit=%errorlevel%) ===== >> "%~dp0manifest-update.log"
