# leoliao-app 发布脚本
#
# 用法:
#   .\release.ps1 -NewVersion 1.0.1+2 -Message "改了 XXX"
#   .\release.ps1 -NewVersion v1.10.0-epub -Message "..." -DryRun
#
# 自动完成:
#   1. bump version (改 package.json + android/app/build.gradle)
#   2. npx cap sync android (web 资源同步到 android)
#   3. cd android && .\gradlew.bat assembleDebug (编译 debug APK)
#   4. 真机端到端验证 gate (可选, 按 Enter 跳过)
#   5. git commit + push
#   6. git tag + push tag
#   7. gh release create + 自动挂 APK
#
# 前置:
#   - gh CLI 装好且 gh auth status 显示已登录 github.com
#   - Git 配置 user.name/user.email (脚本里会兜底设成 liaoguogang-hub)
#   - Node.js + npm 装好
#   - JDK + Android SDK 装好 (gradlew 跑得动)
#
# 版本号格式:
#   -NewVersion 接受 'v1.10.0' 或 'v1.10.0-epub',自动提 semver (1.10.0) 给 package.json + build.gradle
#   - slug 部分 (-epub) 只用作 git tag / gh release title,不入 versionName
#   -DryRun: 只打印,不改文件不 git 不 gh (用来 preview 检查)

param(
  [Parameter(Mandatory)] [string]$NewVersion,
  [Parameter(Mandatory)] [string]$Message,
  [string]$ApkType = "debug",  # debug | release
  [switch]$DryRun              # 只打印,不写文件/不 git/不 gh
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "=== leoliao-app 发布 ===" -ForegroundColor Cyan
Write-Host "版本: $NewVersion"
Write-Host "说明: $Message"
Write-Host "APK 类型: $ApkType"
if ($DryRun) {
  Write-Host "模式: DryRun (只打印, 不写文件 / 不 git / 不 gh)" -ForegroundColor Yellow
}
Write-Host ""

# 0. 前置检查
Write-Host "[0/8] 检查前置..." -ForegroundColor Cyan
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

# 1. bump version (改 package.json + build.gradle)
Write-Host ""
Write-Host "[1/8] bump version" -ForegroundColor Cyan

$semverMatch = [regex]::Match($NewVersion, '^v?(\d+\.\d+\.\d+)(-.+)?$')
if (-not $semverMatch.Success) {
  throw "无法从 '$NewVersion' 提取 semver, 格式应为 'v1.10.0' 或 'v1.10.0-epub'"
}
$semver = $semverMatch.Groups[1].Value
$slug = if ($semverMatch.Groups[2].Success) { $semverMatch.Groups[2].Value.TrimStart('-') } else { '' }
Write-Host "  target semver: $semver"
if ($slug) { Write-Host "  slug: $slug" }

# 改前快照(用于回滚)
$pkgBak = Get-Content package.json -Raw -ErrorAction Stop
$gradleBak = Get-Content android\app\build.gradle -Raw -ErrorAction Stop

try {
  $dq = [char]34  # ASCII double quote
  # 1a. package.json: 改 version
  $pkg = $pkgBak | ConvertFrom-Json
  $oldPkgVer = $pkg.version
  $pkg.version = $semver
  if ($DryRun) {
    Write-Host "  [DryRun] package.json: version $oldPkgVer -> $semver"
  } else {
    ($pkg | ConvertTo-Json -Depth 10) | Set-Content package.json -Encoding UTF8
    Write-Host "  package.json: version $oldPkgVer -> $semver"
  }

  # 1b. build.gradle: 改 versionCode (当前+1) + versionName
  $gradleCodeMatch = [regex]::Match($gradleBak, 'versionCode\s+(\d+)')
  if (-not $gradleCodeMatch.Success) {
    throw "在 build.gradle 里找不到 versionCode 行"
  }
  $oldCode = [int]$gradleCodeMatch.Groups[1].Value
  $newCode = $oldCode + 1

  $gradleVerMatch = [regex]::Match($gradleBak, 'versionName\s+' + $dq + '([^' + $dq + ']+)' + $dq)
  if (-not $gradleVerMatch.Success) {
    throw "在 build.gradle 里找不到 versionName 行"
  }
  $oldVer = $gradleVerMatch.Groups[1].Value

  # 幂等: 已同步则跳过
  if ($oldVer -eq $semver -and $oldCode -ge $newCode) {
    $skipMsg = 'build.gradle: 已是 versionName=' + $semver + ' / versionCode=' + $oldCode + ', 跳过'
    Write-Host ('  ' + $skipMsg) -ForegroundColor Yellow
  } else {
    $newCodeStr = 'versionCode ' + $newCode
    $newVerStr = 'versionName ' + $dq + $semver + $dq
    $codeReplace = 'versionCode\s+\d+'
    $verReplace = 'versionName\s+' + $dq + '[^' + $dq + ']+' + $dq
    $newGradle = $gradleBak -replace $codeReplace, $newCodeStr
    $newGradle = $newGradle -replace $verReplace, $newVerStr
    if ($DryRun) {
      $previewMsg = '  [DryRun] build.gradle: versionCode ' + $oldCode + ' -> ' + $newCode + ', versionName ' + $dq + $oldVer + $dq + ' -> ' + $dq + $semver + $dq
      Write-Host $previewMsg
    } else {
      Set-Content android\app\build.gradle $newGradle -Encoding UTF8
      $doneMsg = '  build.gradle: versionCode ' + $oldCode + ' -> ' + $newCode + ', versionName ' + $dq + $oldVer + $dq + ' -> ' + $dq + $semver + $dq
      Write-Host $doneMsg
    }
  }
}
catch {
  Write-Host "  bump version 失败, 还原改前内容..." -ForegroundColor Red
  if (-not $DryRun) {
    Set-Content package.json $pkgBak -Encoding UTF8
    Set-Content android\app\build.gradle $gradleBak -Encoding UTF8
  }
  throw
}

# 2. cap sync (web 资源同步到 android)
Write-Host ""
Write-Host "[2/8] npx cap sync android" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [DryRun] 跳过"
} else {
  npx cap sync android
  if ($LASTEXITCODE -ne 0) {
    throw "npx cap sync android 失败"
  }
}

# 3. gradle 构建
Write-Host ""
Write-Host "[3/8] gradle assemble$([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ToTitleCase($ApkType))" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [DryRun] 跳过"
} else {
  Set-Location android
  $gradleCmd = if ($ApkType -eq "release") { "assembleRelease" } else { "assembleDebug" }
  .\gradlew.bat $gradleCmd
  if ($LASTEXITCODE -ne 0) {
    Set-Location ..
    throw "gradle $gradleCmd 失败"
  }
  Set-Location ..
}

$apk = "android\app\build\outputs\apk\$ApkType\app-$ApkType.apk"
if ($DryRun) {
  $sizeMB = 0
} else {
  if (-not (Test-Path $apk)) {
    throw "APK 不存在: $apk"
  }
  $sizeMB = [math]::Round((Get-Item $apk).Length / 1MB, 2)
  Write-Host "  APK 大小: ${sizeMB}MB"
}

# 4. 真机验证 gate(可选,默认跳过)
Write-Host ""
Write-Host "[4/8] 真机端到端验证 (可选)" -ForegroundColor Yellow
if ($DryRun) {
  Write-Host "  [DryRun] 跳过 gate"
} else {
  Write-Host "  如果有真机连接,可以跑 adb install -r $apk 验证"
  Write-Host "  无真机或跳过验证请直接按 Enter"
  Read-Host
}

# 5. git commit + push
Write-Host ""
Write-Host "[5/8] git commit + push" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [DryRun] 跳过"
} else {
  git add -A
  $status = git status --porcelain
  if (-not $status) {
    Write-Host "  没有新改动,跳过 commit" -ForegroundColor Yellow
  } else {
    git commit -m "v${NewVersion}: $Message"
    git push origin main
  }
}

# 6. git tag + push tag
Write-Host ""
Write-Host "[6/8] git tag v$NewVersion + push" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [DryRun] 跳过"
} else {
  $existingTag = git tag --list $NewVersion
  if ($existingTag) {
    Write-Host "  tag $NewVersion 已存在,跳过" -ForegroundColor Yellow
  } else {
    git tag -a $NewVersion -m "v${NewVersion}: $Message"
    git push origin $NewVersion
  }
}

# 7. gh release create + 挂 APK
Write-Host ""
Write-Host "[7/8] gh release create + 挂 APK" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [DryRun] 跳过"
} else {
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
}

# 8. 完成
Write-Host ""
Write-Host "[8/8] 完成" -ForegroundColor Cyan
Write-Host "=== 发布完成 ===" -ForegroundColor Green
Write-Host "Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/$NewVersion"