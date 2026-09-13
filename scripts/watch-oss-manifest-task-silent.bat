@echo off
rem Called by Windows Task Scheduler (WatchOSSManifestTask)
rem Silent wrapper: runs watch-oss-manifest-task.ps1 with proper PowerShell path.
rem Mirrors update-manifest-silent.bat pattern.
chcp 65001 >nul
echo [%date% %time%] ===== watch start ===== >> "D:\leoliao-app\scripts\watch-task.log"
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "D:\leoliao-app\scripts\watch-oss-manifest-task.ps1" >> "D:\leoliao-app\scripts\watch-task.log" 2>&1
echo [%date% %time%] ===== watch end (exit=%errorlevel%) ===== >> "D:\leoliao-app\scripts\watch-task.log"
