# leoliao-app 发布脚本
#
# 用法:
#   .\release.ps1 -NewVersion 1.0.1+2 -Message "改了 XXX"
#
# 自动完成:
#   1. npx cap sync android (web 资源同步到 android)
#   2. cd android && .\gradlew.bat assembleDebug (编译 debug APK)
#   3. git commit + push
#   4. git tag + push tag
#   5. gh release create + 自动挂 APK
#
# 前置:
#   - gh CLI 装好且 gh auth status 显示已登录 github.com
#   - Git 配置 user.name/user.email (脚本里会兜底设成 liaoguogang-hub)
#   - Node.js + npm 装好
#   - JDK + Android SDK 装好 (gradlew 跑得动)

param(
  [Parameter(Mandatory)] [string]$NewVersion,
  [Parameter(Mandatory)] [string]$Message,
  [string]$ApkType = "debug"  # debug | release
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "=== leoliao-app 发布 ===" -ForegroundColor Cyan
Write-Host "版本: $NewVersion"
Write-Host "说明: $Message"
Write-Host "APK 类型: $ApkType"
Write-Host ""

# 0. 前置检查
Write-Host "[0/7] 检查前置..." -ForegroundColor Cyan
if (-not (Test-Path .git)) {
  throw "当前目录不是 git 仓库,先 git init + git remote add origin <url>"
}
$remote = git remote get-url origin 2>$null
if (-not $remote) {
  throw "没有配置 git remote origin,先 git remote add origin <url>"
}
Write-Host "  remote: $remote"

$ghStatus = gh auth status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "gh CLI 未登录,先跑 gh auth login --with-token <PAT>"
}
Write-Host "  gh CLI: 已登录"

$gitUser = git config user.name
if (-not $gitUser) {
  git config user.name "liaoguogang-hub"
  git config user.email "liaoguogang-hub@users.noreply.github.com"
  Write-Host "  git: 已自动设置 user.name=liaoguogang-hub"
}

# 1. cap sync (web 资源同步到 android)
Write-Host ""
Write-Host "[1/7] npx cap sync android" -ForegroundColor Cyan
npx cap sync android
if ($LASTEXITCODE -ne 0) {
  throw "npx cap sync android 失败"
}

# 2. gradle 构建
Write-Host ""
Write-Host "[2/7] gradle assemble$([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ToTitleCase($ApkType))" -ForegroundColor Cyan
Set-Location android
$gradleCmd = if ($ApkType -eq "release") { "assembleRelease" } else { "assembleDebug" }
.\gradlew.bat $gradleCmd
if ($LASTEXITCODE -ne 0) {
  Set-Location ..
  throw "gradle $gradleCmd 失败"
}
Set-Location ..

$apk = "android\app\build\outputs\apk\$ApkType\app-$ApkType.apk"
if (-not (Test-Path $apk)) {
  throw "APK 不存在: $apk"
}
$sizeMB = [math]::Round((Get-Item $apk).Length / 1MB, 2)
Write-Host "  APK 大小: ${sizeMB}MB"

# 3. 真机验证 gate(可选,默认跳过)
Write-Host ""
Write-Host "[3/7] 真机端到端验证 (可选)" -ForegroundColor Yellow
Write-Host "  如果有真机连接,可以跑 adb install -r $apk 验证"
Write-Host "  无真机或跳过验证请直接按 Enter"
Read-Host

# 4. git commit + push
Write-Host ""
Write-Host "[4/7] git commit + push" -ForegroundColor Cyan
git add -A
$status = git status --porcelain
if (-not $status) {
  Write-Host "  没有新改动,跳过 commit" -ForegroundColor Yellow
} else {
  git commit -m "v${NewVersion}: $Message"
  git push origin main
}

# 5. git tag + push tag
Write-Host ""
Write-Host "[5/7] git tag v$NewVersion + push" -ForegroundColor Cyan
$existingTag = git tag --list $NewVersion
if ($existingTag) {
  Write-Host "  tag $NewVersion 已存在,跳过" -ForegroundColor Yellow
} else {
  git tag -a $NewVersion -m "v${NewVersion}: $Message"
  git push origin $NewVersion
}

# 6. gh release create + 挂 APK
Write-Host ""
Write-Host "[6/7] gh release create + 挂 APK" -ForegroundColor Cyan
$existingRelease = gh release view $NewVersion 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
  Write-Host "  release $NewVersion 已存在,改用 gh release upload 补 APK" -ForegroundColor Yellow
  gh release upload $NewVersion $apk --clobber
} else {
  $notes = @"
## leoliao-app v${NewVersion}

### 改动

$Message

### 技术栈
- Capacitor (WebView 容器) + Vite (前端构建)
- 平台: Android (targetSdk=36)
- APK 类型: $ApkType 构建

### 构建
- APK 路径: ``$apk``
- APK 大小: ${sizeMB} MB
- 构建命令: ``cd android && ./gradlew $gradleCmd``
- 同步 web 资源: ``npx cap sync android``
"@
  $notesFile = "$env:TEMP\leoliao_release_notes.md"
  Set-Content -Path $notesFile -Value $notes -Encoding UTF8
  gh release create $NewVersion $apk `
    --title "leoliao-app v${NewVersion}" `
    --notes-file $notesFile
}

# 7. 完成
Write-Host ""
Write-Host "[7/7] 完成" -ForegroundColor Cyan
Write-Host "=== 发布完成 ===" -ForegroundColor Green
Write-Host "Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/$NewVersion"
