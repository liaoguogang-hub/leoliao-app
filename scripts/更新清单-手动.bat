@echo off
chcp 65001 >nul
rem 手动更新 OSS 的 Obsidian/manifest.json —— 双击即可运行
rem 用途:在 Obsidian 插件把新笔记同步到 OSS 后,双击这个刷新清单,APK 就能同步到新笔记
set "PATH=C:\aliyun-cli;%PATH%"
set "ALIYUN_PROFILE=leo-oss"
cd /d "%~dp0"
echo ============================================
echo   正在从 OSS 重建 Obsidian/manifest.json ...
echo ============================================
echo.
"C:\Program Files\nodejs\node.exe" gen_oss_manifest.mjs
echo.
echo ============================================
echo   完成,按任意键关闭窗口
echo ============================================
pause >nul
