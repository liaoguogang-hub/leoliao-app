# 知识库 APK 构建指南

> 完整的从源码改一行到 APK 装到手机的端到端流程。
> 写于 2026-07-08,基于 v26 验证成功实践。

---

## 0. TL;DR（推荐流程）

```powershell
# PowerShell,Windows 机器,D:\leoliao-app

cd D:\leoliao-app

# 1. 改源码 (在编辑器或编辑器外)

# 2. ⚠️ 如果新增了 npm 依赖或 Capacitor 插件,先装一下:
#    (日常只改源码时可跳过这步)
npm install
npx cap sync android

# 3. 重新 build + 同步到 Android 资源
npm run sync

# 4. 打 APK
cd android
.\gradlew.bat assembleDebug

# 5. 装到手机 (先卸老版本)
adb uninstall com.leoliao.app
adb install app\build\outputs\apk\debug\app-debug.apk

# 6. 验证 (可选,确认新代码真进 APK 了)
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"
Copy-Item $apk "$env:TEMP\chk.zip"
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\chkext" -Force
Get-ChildItem "$env:TEMP\chkext\assets\public\assets\*.js" | Select Name
```

**关键**:
- `npm run sync` 跑 vite build + cap sync 两步,**`.\gradlew.bat assembleDebug`** 才是关键,`-`是反斜杠不是正斜杠
- **加新 npm 依赖后必须跑 `npm install` + `npx cap sync android`**,否则:
  - TS 编译报 "Cannot find module @xxx"
  - Gradle 报 "Could not resolve project :capacitor-xxx"

---

## 1. 整个 build chain 是什么样的

```
┌──────────────────────────────────────────────────────────────────┐
│ /mnt/work/leoliao-app/                                            │
│   src/main.ts (Lit component)                                     │
│       ↓                                                           │
│   tsc (类型检查)                                                  │
│       ↓                                                           │
│   vite build                                                      │
│       ↓ 输出                                                      │
│   dist/assets/index-XXXXX.js (一个 hash 命名)                     │
│       ↓ 拷贝                                                      │
│   android/app/src/main/assets/public/assets/index-XXXXX.js       │
│       ↓ 打包                                                      │
│   android/app/build/outputs/apk/debug/app-debug.apk               │
└──────────────────────────────────────────────────────────────────┘
```

**核心事实**:
- **dist 的 JS bundle 文件名是 hash,源码改了 hash 就变**。所以"代码改了没"看 hash 就知道。
- 三个 hash 互相一致才算 OK: `dist/`, `android assets/`, APK 里 `assets/public/assets/` 三处必须是同一个 hash。

---

## 2. 前置环境(一次性配置)

### 必需装:
| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | 18+ | 跑 vite/tsc/cap CLI |
| Java JDK | 17 | Gradle 要用 |
| Android SDK | platform-tools + platforms;android-34 + build-tools;34.0.0 | 编译 .apk |
| ADB | 装 SDK 时自动带 | 装到手机 |

### Windows 上装 SDK 的最简方法:

**方法 1**: 装 Android Studio(自带 SDK Manager)
- 下载: https://developer.android.com/studio
- 打开 → SDK Manager → 装 SDK 34 + build-tools 34
- ANDROID_HOME 默认在 `C:\Users\<你>\AppData\Local\Android\Sdk`

**方法 2**: 只装 cmdline-tools(轻量,~150 MB)
```powershell
# 1. 下 cmdline-tools: https://developer.android.com/studio#command-line-tools-only
# 2. 解压到 C:\android-sdk\cmdline-tools\latest\
# 3. 设环境变量
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\android-sdk", "User")
[System.Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\android-sdk\platform-tools;C:\android-sdk\build-tools\34.0.0", "User")

# 重开 PowerShell 让环境变量生效
# 然后:
C:\android-sdk\cmdline-tools\latest\bin\sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# 必须接受 license
yes | C:\android-sdk\cmdline-tools\latest\bin\sdkmanager --licenses
```

### PowerShell 找不到 adb?

Android SDK 默认路径找不到,就用绝对路径:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
# 或者 Android Studio 自带的:
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk
```

或者把 adb 加 PATH(每开新 PowerShell 都要):
```powershell
$env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
adb devices
```

---

## 3. 详细步骤(Windows PowerShell)

### 步骤 A:从源码到 dist(纯前端打包)

```powershell
cd D:\leoliao-app

# 第一次需要装依赖(~1-2 分钟,几十 MB)
npm install

# 后续每次改源码后: 重新 build
npm run sync
# 等价于: tsc && vite build && cap sync android
```

**预期输出**:
```
vite v5.4.21 building for production...
✓ 208 modules transformed.
dist/index.html                   0.85 kB
dist/assets/index-XXXXX.js       ~308 kB   ← 注意这个 hash
✓ built in 3-5s
✔ Copying web assets from dist to android\app\src\main\assets\public
[info] Sync finished
```

**重要**: **JS bundle hash 必须变了才算源码被编进去了**:
- 没改代码:`index-DH4RPAG0.js`
- 加了 V22 fix:`index-DP6OMa7Z.js`
- 加了 V25 重构:`index-B2sJAe2N.js`
- 加了 V26 多事件:`index-z_-fCmOo.js`

### 步骤 B:打 APK

```powershell
cd D:\leoliao-app\android

# ❌ 错的(这是 bash 语法,PowerShell 不认)
./gradlew assembleDebug

# ✅ 对的(Windows 用 .\ 加 .bat)
.\gradlew.bat assembleDebug
```

**首次运行**: 5-15 分钟(下几百 MB gradle 依赖)
**后续运行**: 30 秒到几分钟(增量编译)

**预期输出**:
```
BUILD SUCCESSFUL in 8s
82 actionable tasks: 51 executed, 31 up-to-date
```

**APK 位置**:
```
D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk
```

### 步骤 C:装到手机

```powershell
# 1. 先卸老版本(避免应用签名缓存问题)
adb uninstall com.leoliao.app

# 2. 装新版本
adb install -r D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk

# 3. 如果 adb 找不到设备:
#    - USB 调试要开 (设置 → 关于手机 → 连点 7 次版本号 → 开发者选项 → USB 调试)
#    - 数据线要能传数据(有些只能充电)
#    - 手机弹"是否允许 USB 调试"要按"允许"
```

### 步骤 D:验证 APK 里有新代码(可选但推荐)

```powershell
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"

# 解压(APK 是 zip,PowerShell 原生支持,但只认 .zip 后缀)
Copy-Item $apk "$env:TEMP\chk.zip"
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\chkext" -Force

# 看 JS bundle hash
Get-ChildItem "$env:TEMP\chkext\assets\public\assets\*.js" | Select Name
# 应该看到 hash 是当前版本的(比如 z_-fCmOo)

# 验证某关键字符串是否在 bundle 里
Select-String -Path "$env:TEMP\chkext\assets\public\assets\*.js" -Pattern "你加的变量名"
```

---

## 4. JS bundle hash 对照表(2026-07-08)

每个版本源码改动都会改 hash:

| dist hash | 关键源码改动 |
|---|---|
| `DH4RPAG0` | 没改搜索逻辑 (V22 bug) |
| `DP6OMa7Z` | 加 V22 fix(没用,mutate 丢全量) |
| `B2sJAe2N` | V25 重构 displayEntries 派生 |
| `z_-fCmOo` | V26 多绑 @search/@change/@keyup |

**核心规则**:
- 改了源码,vite hash **必须变**
- 三处 hash(dist/,android assets/,APK 里)必须一致

---

## 5. 常见坑 + 解决

### 坑 1:PowerShell 不认 `./gradlew`

**症状**:
```
'.' 不是内部或外部命令,也不是可运行的程序
或批处理文件。
```

**原因**: PowerShell 不是 bash,`./` 不是有效路径分隔符。

**解决**: 用 `.\gradlew.bat`(反斜杠 + .bat 后缀)。npm scripts 里写的是 `./gradlew assembleDebug`(给 Mac/Linux 用的),Windows 要自己替换。

### 坑 2:adb 找不到设备

**排查清单**:
1. 手机 **USB 调试**开了没?(设置 → 关于手机 → 连点 7 次版本号 → 退出来就有"开发者选项" → 进去开 USB 调试)
2. 数据线是 **数据线** 还是只供电的?(很多便宜线只能充电)
3. 手机弹了 **"是否允许 USB 调试"** 没?(要点"允许",有些手机还要勾"始终允许来自此计算机")
4. `adb kill-server && adb start-server` 重启 adb 服务
5. `adb devices` 看设备列表

### 坑 3:`adb` 没装 / 不在 PATH

**症状**:
```
adb : 无法将"adb"项识别为 cmdlet、函数、脚本文件或可运行程序的名称
```

**解决**: 用绝对路径
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

### 坑 4:Android WebView 缓存了老 JS

**症状**: 装了新 APK,但 app 行为和旧版本一模一样

**排查**:
1. 验证 APK 里 JS hash 是新的(步骤 D)
2. 手机上 **卸载** 老 app 再装新的(不能只 install -r,有时不替换)

### 坑 5:gradle 增量构建坑

**症状**: 改了 dist/ 但 APK 还是老的(gradle 觉得依赖没变,跳过了打包)

**解决**:
```powershell
cd D:\leoliao-app\android
.\gradlew.bat clean
.\gradlew.bat assembleDebug
```

或者更彻底:
```powershell
cd D:\leoliao-app
Remove-Item -Recurse -Force dist, android\app\build
npm run sync
cd android
.\gradlew.bat assembleDebug
```

### 坑 6:tar 解压不覆盖

**症状**:
```
tar.exe: Option --overwrite is not supported
```

**原因**: Windows 自带的 `tar.exe` 不支持 `--overwrite`。

**解决**: 先删再解压(避开冲突)
```powershell
Remove-Item -Recurse -Force D:\leoliao-app\src
tar -xzf leoliao-app-知识库-vXX.tar.gz -C D:\
```

或者用 7-Zip / Git Bash (有完整 GNU tar)。

### 坑 7:tar 中文路径报错

**症状**:
```
leoliao-app/leoliao-app-鐭ヨ瘑搴?v24.tar.gz: Invalid empty pathname
```

**原因**: Windows console 默认 codepage 不识别 UTF-8 中文。

**解决**:
- 警告可忽略,实际解压内容是对的(验证 `ls D:\leoliao-app\src\main.ts` 看是否解压成功)
- 如果还是不放心,用 7-Zip、WinRAR、或者把 tar.gz 改成 zip

### 坑 8:`npm run sync` 不刷新 dist

**症状**: 改了源码,vite build 还是出老 hash

**排查**:
- 看 vite build 输出里的 hash,有变化才是真重 build 了
- 如果是缓存问题,清 `node_modules\.vite`:
```powershell
cd D:\leoliao-app
Remove-Item -Recurse -Force node_modules\.vite
npm run sync
```

---

## 6. 调试技巧

### 远程调试 Android WebView

1. 手机开 USB 调试 + 连接电脑
2. 装新 APK 并打开
3. Chrome 浏览器访问 `chrome://inspect`
4. 找到 WebView,点 inspect
5. 在 Console 看 console.log:
   - **V25+ 加 log**:看 `searchTerm` 变化
   - **看 onSearch 调用次数**:临时改 `onSearch` 加 `console.log('onSearch called, q=', q)`

### 看 grep bundle

```powershell
# 看变量名是否在 JS bundle 里(确认进 APK 了)
$js = "$env:TEMP\chkext\assets\public\assets\*.js"
Select-String -Path $js -Pattern "searchTerm" | Select -First 2
Select-String -Path $js -Pattern "@search" | Select -First 2
```

### 看 APK mtime

```powershell
# APK 生成时间
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"
Get-Item $apk | Select Name, LastWriteTime, Length
```

---

## 7. 这次踩的"搜索清空不恢复"具体案例

### Bug 现象
搜索"xxx"后清空,文件树**不恢复全貌**,只有"重新同步"按钮才能恢复。

### 尝试过的修法(都没解决)

| 版本 | 修法 | 失败原因 |
|---|---|---|
| V22-fix | 加 `allEntries`,清空时 `this.entries = this.allEntries` | 看起来对,但 APK 没真刷新 |
| V23-fix | 同上,但加了重新 build dist → 新 hash `DP6OMa7Z` | 源码进了,但 searchTerm 仍出问题 |
| V24-fix | 用 `displayEntries` 派生 getter 替代 mutate | 重构对,但 type="search" 的 × 按钮在 Android WebView 上**不触发 @input** |
| V25-fix | 多绑 `@search` `@change` `@keyup` 兜底 | ✅ 终于修好 |

### V26 最终修法

```ts
<input
  type="search"
  class="search"
  placeholder="🔍 搜索路径..."
  @input=${this.onSearch}
  @search=${this.onSearch}    // ← 关键:type="search" 专用,点 × 时触发
  @change=${this.onSearch}
  @keyup=${this.onSearch}
/>
```

### 教训

1. **hash 是真话的来源** — APK 不更新可能是 dist 没刷新,可能是 gradle 没重打,可能是安装没替换。每次都验证 hash。
2. **`type="search"` 在 Android WebView 上不靠谱** — 事件触发跟桌面浏览器行为不一致。下次涉及搜索框,默认 `type="text"` 更稳。
3. **多事件兜底是廉价的保险** — 一行事件绑定解决一周的扯皮。

---

## 8. 进阶:在 NAS (QNAP) 上直接 build 出 APK 发给手机

不是必需但能做到。如果以后想跳过 Windows build:

### NAS 装 Android SDK(一次性,30-60 分钟)

```bash
# 下载 cmdline-tools
cd /tmp
wget https://dl.google.com/android/repository/commandlinetools-linux-XXXXX_latest.zip
unzip commandlinetools-linux-XXXXX_latest.zip -d /opt/android-sdk

# 设环境变量
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# 装核心包 (~700 MB)
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# 必须接受 license
yes | sdkmanager --licenses

# build APK
cd /mnt/work/leoliao-app
npm run sync
cd android
export ANDROID_HOME=/opt/android-sdk
./gradlew assembleDebug

# 然后直接发文件给手机
cp android/app/build/outputs/apk/debug/app-debug.apk /some/served/path/
```

**好处**: 以后所有改动都能直接发 .apk 文件,Leo 手机直接装,不用 Windows。

---

## 9. 一页 cheat sheet

| 任务 | 命令 |
|---|---|
| build 一次 | `npm run sync` |
| 打 APK | `cd android && .\gradlew.bat assembleDebug` |
| 清缓存重 build | `Remove-Item -Recurse -Force dist,android\app\build; npm run sync; cd android; .\gradlew.bat assembleDebug` |
| 卸载+装到手机 | `adb uninstall com.leoliao.app; adb install -r android\app\build\outputs\apk\debug\app-debug.apk` |
| 看 APK 里 JS hash | `Expand-Archive` 到 `$env:TEMP\chkext`,看 `assets\public\assets\*.js` 文件名 |
| 旧版本对照 | 见 §4 hash 表 |

---

文档位置: `/mnt/work/leoliao-app/BUILD-GUIDE.md`
最后更新: 2026-07-08
涉及的 V22/V23/V24/V25/V26 都在 git history 里,以后可以直接 `git log --oneline` 看演进。
