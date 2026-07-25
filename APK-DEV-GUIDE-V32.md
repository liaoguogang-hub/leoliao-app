# 知识库 APP — APK 开发完整指南 (V1 → V32)

> **写给**:Leo(以及未来 6 个月后忘了细节的自己 / 任何想接手这项目的人)
> **目的**:照着这份文档,从空白电脑开始,一步步把知识库 APK 打出来装到手机上,以及——理解这 32 个版本里踩过的所有坑,避免重蹈覆辙。
> **范围**:Windows / macOS / Linux 都能用,但**命令行示例以 Windows PowerShell 为主**(因为你主要在 Windows 上打 APK)。
> **不包含**:Obsidian vault 内容管理 / Aliyun OSS 后端运维(那是另一个项目)。
> **最后更新**:2026-07-09(V32 后,加了客户端 PDF 生成的踩坑)

---

## 0. TL;DR — 一页 cheat sheet

如果你只想要一条命令搞定的版本:

```powershell
# 1. 设 JAVA_HOME(用 Android Studio 自带 JDK 17)
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"

# 2. 拉代码 → 装依赖 → build → sync → 打 APK → 装到手机(全自动)
cd D:\leoliao-app
npm install
npm run sync
cd android
.\gradlew assembleDebug
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

> ⚠️ **V33 修正**:Windows 上用 **`.\gradlew`** 不是 `.\gradlew.bat`(后者会忽略 `$env:JAVA_HOME` 之类的环境变量,触发 `Invalid file path`)。**这条**修正了 BUILD-GUIDE 老文档的错误。

然后**装新依赖时多加一步**(`html2canvas` / `jspdf` 这种):

```powershell
npm install
npx cap sync android      # ⚠️ 不跑这步 gradle 会报 "Cannot find project :capacitor-xxx"
npm run sync
cd android; .\gradlew assembleDebug
```

**11 条核心认知**(背下来少走 80% 的弯路):

1. **Hash 是真话的来源** — 改代码看 `dist/assets/index-XXXXX.js` 的 hash 变没变。变 = 进了。没变 = 改了文件但 vite 没生效,清 `node_modules\.vite`。
2. **三处 hash 必须一致** — `dist/`、`android/app/src/main/assets/public/`、APK 解压出来 `assets/public/assets/` 里 JS 文件名必须完全一样。任何一个不一样 = 你的"修复"没生效。
3. **Windows 用 `.\gradlew`,不是 `.\gradlew.bat`** — V33 修正:`gradlew.bat` 走 cmd 批处理,会忽略 PowerShell 的 `$env:JAVA_HOME` 等,触发 `Invalid file path`。`gradlew` 是 Unix 风格,直接调 `java` + jar,环境变量直通。
4. **必须设 `$env:JAVA_HOME`** — 指向 Android Studio 自带的 `C:\Program Files\Android\Android Studio\jbr`(JDK 17),AGP 严格要求。
5. **加新 npm 依赖必跑 `npm install` + `npx cap sync android`** — Capacitor 插件要装两次。
6. **国内 wrapper 用腾讯云镜像** — `services.gradle.org` 经常抽风,改 `mirrors.cloud.tencent.com/gradle/`
7. **adb 找不到设备 = USB 调试没开 / 数据线只供电 / 没点"允许"** — 90% 的"装不上手机"是这三种之一。
8. **APK 装上但行为没变 = WebView 缓存** — `adb uninstall com.leoliao.app` 卸掉重装,不要 `install -r`。
9. **跨平台事件绑多个** — `@input @change @search @keyup` 都绑上,Android WebView 上 `type="search"` 的 × 按钮只触发 `@search`,不触发 `@input`。
10. **状态分清楚** — 数据源(`allEntries`)+ 过滤(`searchTerm`)分开存,派生值用 getter 算,不要 mutate 关键字段。
11. **打包前永远验 APK 里的 hash** — 30 秒换一个小时的瞎调。

---

## 1. 这个 APP 是什么

### 1.1 一句话定位

**手机 / 平板上的 Obsidian vault 只读阅读器**。把 `/vault/LeoLiao/` 里 1216 篇 markdown 笔记同步到阿里云 OSS,Android APP 从 OSS 拉到本地,用 markdown-it 渲染、wikilink 跳转、主题切换、原生分享。

### 1.2 技术栈

| 层 | 技术 | 备注 |
|---|---|---|
| 前端框架 | Lit 3.x | Web Components,30KB JS,启动快 |
| 类型 | TypeScript 5.6 | 编译期类型检查 |
| 构建 | Vite 5.4 | 内容 hash 命名 `index-XXXXXX.js` |
| 移动壳 | Capacitor 6.x | 一套代码,Web + Android + iOS |
| 渲染 | markdown-it + 自定义 wikilink 规则 | |
| 存储 | Dexie (IndexedDB) | 笔记缓存 |
| 设置 | localStorage | 主题 |
| 同步 | Aliyun OSS + CapacitorHttp | 绕 WebView CORS |
| 分享 | @capacitor/share | 原生分享面板 |
| 文件 | @capacitor/filesystem | 写临时文件 |
| **PDF(V32 新)** | **html2canvas + jsPDF** | 客户端生成,真 PDF 文件 |

### 1.3 这是什么 / 不是什么

✅ **是什么**:在手机上能看完整个 vault,带 wikilink 跳转、主题、分享、PDF 导出

❌ **不是什么**:不是 Obsidian 官方 APP(自己写的)、不是编辑器(只读)、不是云盘(单向拉取不监听文件变化)、不依赖 NAS(OSS 永久存,关掉 NAS 也能看)

---

## 2. 开发环境准备(一次性)

### 2.1 必装软件清单

| 软件 | 最低版本 | 哪里装 | 大小 | 是否必需 |
|---|---|---|---|---|
| **Node.js** | 20 LTS | https://nodejs.org | ~80MB | ✅ |
| **Java JDK 17** | 17 | Android Studio 自带,或单独装 OpenJDK | ~300MB | ✅ |
| **Android SDK** | API 34 | Android Studio 或 cmdline-tools | ~700MB | ✅ |
| **adb** | 任意 | SDK 自带 | 内置 | ✅ |
| Git | 任意 | https://git-scm.com | ~50MB | 推荐(版本管理) |
| Android Studio | 任意 | https://developer.android.com/studio | ~3GB | 可选(只命令行不需要) |

### 2.2 验证环境

打开 PowerShell(`Win+R` → 输入 `powershell`),跑:

```powershell
node -v         # 应 >= v20
npm -v          # 应 >= 10
java -version   # 应 17.x
adb version     # 应有版本号
```

如果哪个报错"不是内部命令",见 §13 排错清单。

### 2.3 三种安装 Android SDK 的方法(选一种)

#### 方法 A:装 Android Studio(最稳,推荐新手)

1. 下载:https://developer.android.com/studio
2. 安装,勾选 "Android Virtual Device"(模拟器,可选)
3. 第一次打开 → SDK Manager → 装:
   - `SDK Platforms` 选 `Android 14 (API 34)` 勾上
   - `SDK Tools` 选 `Android SDK Build-Tools 34.0.0` + `Android SDK Platform-Tools` 勾上
4. SDK 默认路径 `C:\Users\<你>\AppData\Local\Android\Sdk`
5. 重开 PowerShell,`adb version` 应有输出

#### 方法 B:只装 cmdline-tools(轻量,~150MB)

如果你不想装 Android Studio 整套(节省 2GB+):

```powershell
# 1. 下 cmdline-tools
# https://developer.android.com/studio#command-line-tools-only
# 下载 commandlinetools-win-XXXXX_latest.zip

# 2. 解压到固定目录
Expand-Archive commandlinetools-win-*.zip -DestinationPath C:\android-sdk\tmp
Move-Item C:\android-sdk\tmp\cmdline-tools C:\android-sdk\cmdline-tools\latest

# 3. 设环境变量(用户级,永久)
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\android-sdk", "User")
$env:Path += ";C:\android-sdk\cmdline-tools\latest\bin;C:\android-sdk\platform-tools;C:\android-sdk\build-tools\34.0.0"
[System.Environment]::SetEnvironmentVariable("Path", $env:Path, "User")

# 4. 重开 PowerShell 让环境变量生效

# 5. 装核心包
C:\android-sdk\cmdline-tools\latest\bin\sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# 6. 必须接受 license(否则 Gradle 报 "License for package ... not accepted")
yes | C:\android-sdk\cmdline-tools\latest\bin\sdkmanager --licenses
```

#### 方法 C:Mac/Linux(以 macOS 为例)

```bash
brew install --cask android-commandlinetools
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
yes | sdkmanager --licenses
```

### 2.4 手机准备

1. **打开开发者选项**:`设置 → 关于手机 → 连点 7 次"版本号"`
2. **打开 USB 调试**:`设置 → 系统和更新 → 开发者选项 → USB 调试`
3. **允许未知来源**:`设置 → 安全 → 更多安全设置 → 安装未知应用 → 允许(Chrome 或 我的文件)`
4. **数据线**:**必须能传数据**,不是只充电的便宜线(那种只有 2 根芯,USB 调试连不上)
5. 手机插电脑,**弹"是否允许 USB 调试"** → 点"允许",勾选"始终允许来自此计算机"(避免每次都要点)

验证:

```powershell
adb devices
# 应该看到:
# List of devices attached
# XXXXXXXX    device
```

如果显示 `unauthorized` 就是没点"允许"。显示 `offline` 就是数据线问题。

---

## 3. 项目结构

拿到代码后,目录长这样:

```
leoliao-app/
├── README.md                       ← 项目入口(用户视角)
├── SETUP.md                        ← 旧版搭建指南(已被本文档取代,保留历史)
├── BUILD-GUIDE.md                  ← 旧版构建指南(V26 时写的,本文档取代)
├── PLATFORM-GUIDE.md               ← 跨平台架构 + iOS 准备
├── APP-DEV-COMPLETE-GUIDE.md       ← 旧版开发指南(V30 时写的,本文档取代)
├── APK-DEV-GUIDE-V32.md            ← ← 你正在看,终极指南
├── BLOG.md                         ← 项目博客
│
├── src/                            ← 源码(改这里)
│   ├── main.ts                     ← 入口组件 (LlApp)
│   ├── styles.css                  ← 全局样式 + CSS 变量
│   ├── types.ts                    ← 类型定义
│   ├── components/                 ← 子组件
│   │   ├── file-tree.ts            ← 文件树 (V10+,V22-V28 重写)
│   │   ├── note-view.ts            ← 笔记渲染
│   │   ├── settings-panel.ts       ← 主题设置 modal (V29)
│   │   ├── share-panel.ts          ← 分享 + 导出 modal (V29+V31+V32)
│   │   └── help-panel.ts           ← 帮助 modal (V29)
│   ├── services/                   ← 服务层
│   │   ├── sync.ts                 ← OSS manifest + 文件拉取
│   │   ├── db.ts                   ← Dexie (IndexedDB wrapper)
│   │   ├── renderer.ts             ← markdown-it + wikilink + callout
│   │   ├── settings.ts             ← 主题持久化 (V29+V30 修)
│   │   └── export-service.ts       ← HTML/PDF 导出 (V31 引入,V32 大改)
│   └── data/                       ← 内置 demo 数据
│
├── android/                        ← Capacitor 生成的 Android 项目
│   └── app/src/main/
│       ├── AndroidManifest.xml     ← APP 元数据 + 权限
│       ├── assets/public/          ← ← Vite 编译产物拷到这里(自动)
│       │   ├── index.html
│       │   ├── assets/
│       │   │   ├── index-CEaoltNX.js   ← 业务代码(内容 hash)
│       │   │   ├── index-XXX.css
│       │   │   ├── purify.es-XXX.js     ← DOMPurify(jspdf 用)
│       │   │   ├── index.es-XXX.js      ← jspdf 主包
│       │   │   └── web-XXX.js           ← Capacitor 桥接代码
│       │   └── cordova.js
│       └── java/.../MainActivity.java  ← Capacitor 入口
│
├── dist/                           ← Vite 编译输出(自动生成)
├── ios/                            ← (未来 npx cap add ios 后才有)
├── node_modules/                   ← npm 依赖(自动生成)
├── package.json                    ← deps + scripts
├── capacitor.config.ts             ← Capacitor 桥接配置
├── vite.config.ts                  ← Vite 配置
└── tsconfig.json                   ← TypeScript 配置
```

---

## 4. 拉代码到本机

### 4.1 从 NAS 拉(最常用)

```powershell
# PowerShell
$nas = "\\nas-ip\mnt\work"  # 改成你的 NAS 路径
$dst = "D:\leoliao-app"

# 排除 node_modules 和构建产物(它们会自动生成,占空间)
robocopy "$nas\leoliao-app" $dst /MIR /XD node_modules dist android\.gradle android\build android\app\build /NFL /NDL /NJH /NJS /NP
```

或者用 rsync(Git Bash / WSL):

```bash
rsync -av --exclude='node_modules' --exclude='dist' \
  --exclude='android/.gradle' --exclude='android/build' --exclude='android/app/build' \
  user@nas-ip:/mnt/work/leoliao-app/ /d/leoliao-app/
```

### 4.2 从 tar 包拉(CC-connect 收到的源码包)

```powershell
# 假设 cc-connect 收到的文件在 D:\Downloads\leoliao-app-v32-pdf-client.tar.gz

# ⚠️ Windows 自带 tar 不支持 --overwrite,先删再解压
if (Test-Path D:\leoliao-app) { Remove-Item -Recurse -Force D:\leoliao-app }
New-Item -ItemType Directory -Path D:\leoliao-app -Force | Out-Null
tar -xzf D:\Downloads\leoliao-app-v32-pdf-client.tar.gz -C D:\

# ⚠️ tar 包里通常有 leoliao-app/ 前缀的目录,解压完应该看到:
# D:\leoliao-app\dist\
# D:\leoliao-app\src\
# D:\leoliao-app\android\app\src\main\assets\public\
# ...etc

# 如果看到 D:\leoliao-app\leoliao-app\... 这种,说明 tar 里多了一层,移动一下:
# Move-Item D:\leoliao-app\leoliao-app\* D:\leoliao-app\
# Remove-Item D:\leoliao-app\leoliao-app
```

**中文路径报错怎么办?**

```
tar.exe: Error opening archive: Invalid empty pathname
```

Windows 控制台默认 codepage 不认 UTF-8,**警告可忽略,实际解压内容是对的**。验证 `ls D:\leoliao-app\src\main.ts` 看是否解压成功。

如果还是不放心,用 7-Zip 或 WinRAR(图形化,稳)。

### 4.3 验证

```powershell
cd D:\leoliao-app
ls
# 应该看到: README.md  src/  android/  dist/  package.json  capacitor.config.ts  ...
```

---

## 5. 第一次跑通浏览器

### 5.1 装 npm 依赖

```powershell
cd D:\leoliao-app
npm install
# → 1-3 分钟,装 ~200MB(因 jspdf + html2canvas 比之前大了)
```

**预期输出**:
```
added XXX packages in XXs
```

**报错怎么办?**

- `EACCES` 权限问题 → 不要用管理员 PowerShell,关掉再用普通用户
- `ERESOLVE unable to resolve dependency tree` → `npm install --legacy-peer-deps`
- 卡在 `idealTree` 不动 → 换镜像:`npm config set registry https://registry.npmmirror.com`

### 5.2 启动 dev server

```powershell
npm run dev
```

**预期输出**:
```
VITE v5.4.21  ready in XXX ms
➜  Local:   http://localhost:5173/
```

打开浏览器访问 `http://localhost:5173/`,**应看到知识库启动页**(第一次会拉 OSS,可能等几秒)。

**DevTools Console**(F12)应该看到:
```
[LeoLiao] Platform: web Native: false
```

看到这行 = 基础链路 OK。

### 5.3 dev 模式能做什么

- ✅ 改 `src/*.ts` → 浏览器自动 hot-reload
- ✅ DevTools 调试 console / network / storage
- ✅ 跨平台代码分支:`Capacitor.isNativePlatform()` 自动返回 false,走 web 分支
- ❌ **不能**测试 Capacitor 原生插件(Share、Filesystem)—— 这些只在真机/模拟器上跑

---

## 6. 第一次打 APK

### 6.0 必做的两个环境准备(V33 加的,跳不过去)

```powershell
# 1. 设 JAVA_HOME 指向 Android Studio 自带 JDK 17
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"

# 2. (国内网络必做)改 Gradle wrapper 用腾讯云镜像
(Get-Content D:\leoliao-app\android\gradle\wrapper\gradle-wrapper.properties) `
  -replace 'services.gradle.org/distributions', 'mirrors.cloud.tencent.com/gradle' `
  | Set-Content D:\leoliao-app\android\gradle\wrapper\gradle-wrapper.properties
```

> ⚠️ **V33 血的教训**:Leo 之前 build V32 成功过,但 V33 加 file-picker 后 build 失败,折腾了 4 小时才解决。**根因是 PowerShell 默认 `java` 不是 Android Studio 自带 JDK 17**,且用 `gradlew.bat` 走 cmd 路径不传环境变量。**`gradlew` + `JAVA_HOME` 解决**。

### 6.1 三步:build → sync → gradle

```powershell
cd D:\leoliao-app

# Step 1: 编译 web 资源(tsc + vite build)
# (注意:这一步会自动跑,不需要单独 npm run build)
npm run sync

# 预期输出:
# > tsc && vite build
# vite v5.4.21 building for production...
# ✓ 601 modules transformed.
# dist/index.html                   0.85 kB
# dist/assets/index-XXXXX.js   ~1000 kB    ← 注意这个 hash,变了才是真重 build
# dist/assets/purify.es-XXXX.js    28 kB    ← jspdf 依赖
# dist/assets/index.es-XXXX.js    150 kB    ← jspdf 主包
# ✓ built in 9s
# ✔ Copying web assets from dist to android\app\src\main\assets\public

# Step 2: 打 APK(V33 修正:用 gradlew 不是 gradlew.bat)
cd android
.\gradlew assembleDebug

# ⚠️ V33 修正:Windows 也用 `.\gradlew`,**不要** `.\gradlew.bat`
#    原因:`gradlew.bat` 走 cmd 批处理,会忽略 PowerShell 的 `$env:JAVA_HOME`,
#    触发 `Invalid file path` 错误。`gradlew` 是 Unix 风格,直接调 `java` + jar,
#    环境变量直通。

# 首次 5-15 分钟(下 Gradle 依赖),后续 30s-3min(增量)

# 预期输出:
# BUILD SUCCESSFUL in 8s
# 82 actionable tasks: 51 executed, 31 up-to-date
```

### 6.2 APK 在哪里

```
D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk
```

文件大小:V30 前 ~3-4MB,V32 后 ~5-6MB(html2canvas + jspdf 加进去)。

### 6.3 装到手机

```powershell
# 先卸老版本(避免签名冲突)
adb uninstall com.leoliao.app

# 装新版本
adb install -r D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk

# 预期:
# Performing Streamed Install
# Success
```

打开手机上的"知识库" APP,第一次会从 OSS 拉所有笔记(几十秒到几分钟),之后秒开。

### 6.4 验证 APK 里的代码是新的(关键!)

```powershell
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"

# 把 .apk 当 zip 解压(改后缀是为了 PowerShell 认)
Copy-Item $apk "$env:TEMP\chk.zip"
if (Test-Path "$env:TEMP\chkext") { Remove-Item -Recurse -Force "$env:TEMP\chkext" }
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\chkext" -Force

# 看 JS bundle 文件名(应该跟 dist/ 里的 hash 一致)
Get-ChildItem "$env:TEMP\chkext\assets\public\assets\*.js" | Select-Object Name
```

**对照**:
- `dist/assets/index-CEaoltNX.js` (本地刚 build)
- `android/app/src/main/assets/public/assets/index-CEaoltNX.js` (cap sync 拷过去)
- `$env:TEMP\chkext\.../index-CEaoltNX.js` (APK 里的)

**三个 hash 必须完全一致**。任何一处不对 = 没生效。

### 6.5 验证某段关键代码进了 APK

```powershell
# 比如你想确认 exportPDF 新代码进了
$js = "$env:TEMP\chkext\assets\public\assets\*.js"
Select-String -Path $js -Pattern "html2canvas" | Select-Object -First 1
# 应该看到有匹配,且行号
```

---

## 7. 日常开发循环

### 7.1 三种场景

| 场景 | 命令 |
|---|---|
| **只改源码**(90% 时间) | `npm run sync` 然后 `cd android && .\gradlew.bat assembleDebug` |
| **加新 npm 依赖**(比如 V32 加 jspdf) | `npm install` → `npx cap sync android` → `npm run sync` → gradle |
| **加新 Capacitor 插件** | 同上加 npm 依赖,但**还要** `npx cap sync android`(让 cap 注册插件到原生项目) |

### 7.2 完整流程

```
┌──────────────────────────────────────────────────────────────┐
│ 改源码 (src/*.ts / .css / index.html)                          │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ npm run sync                                                   │
│   = tsc (类型检查) + vite build (打包) + cap sync (拷到 Android) │
│                                                                  │
│ ⚠️ 输出里要看到 "✓ built" + "✔ Copying web assets"          │
│ ⚠️ dist/index-XXX.js 的 hash 必须和上次不一样                  │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ cd android && .\gradlew.bat assembleDebug                      │
│                                                                  │
│ ⚠️ Windows 用 .\gradlew.bat,Mac/Linux 用 ./gradlew             │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ adb uninstall com.leoliao.app && adb install -r app\build\...  │
│                                                                  │
│ ⚠️ 卸了再装,不要只 install -r(WebView 缓存坑)                │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 在手机跑一遍核心流程                                              │
│                                                                  │
│ ⚠️ 有问题: chrome://inspect 看 console / 看 dist hash 一致性    │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 一键脚本(可选)

在 `package.json` 加:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "sync": "npm run build && cap sync android",
    "android:apk": "npm run sync && cd android && ./gradlew assembleDebug",
    "android:run": "cap run android",
    "clean": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true});require('fs').rmSync('android/app/build',{recursive:true,force:true})\"",
    "fresh": "npm run clean && npm run sync && cd android && ./gradlew assembleDebug"
  }
}
```

`npm run fresh` = 清缓存 + 重 build + 打 APK,用于"明明改了代码但 APK 行为没变"的最后救命稻草。

---

## 8. 版本演进时间线 (V1 → V32)

> 这一节是这份指南的核心。每个版本告诉你:**改了什么、为什么、踩了什么坑、怎么避**。

### 8.1 总览时间线

```
V1-V2     脚手架                (2 周前)
V3        first fix             APK 第一次能装上
V4 ⭐     cors-fix              笔记能从 OSS 拉到手机
V5        encode-fix            中文路径不乱码
V6        scroll-fix            文件树能滚动
V7 ⭐     touch-debug           第一次有调试能力
V8 ⭐     debug-panel           屏幕右下角实时日志面板
V9        trycatch              不再白屏崩溃
V10 ⭐    no-details            第一个能完整阅读笔记的版本
V11       cap-http 兜底
V13       callback 取代 CustomEvent
V15 ⭐    force scroll          滚动穿透终极解决方案
V18-V21   稳定性优化
V22-V28   bug 修复密集期        8 个版本,6 个真实 bug
V29 ⭐    5 大特性              toolbar / 设置 / 分享 / 帮助 / 点读关侧栏
V30       浅色主题 + 分享全内容
V31 ⚠️    HTML/PDF 导出        PDF 按钮"无反应"(Android WebView 不支持 window.print)
V32 ⭐    客户端真 PDF          html2canvas + jsPDF,真生成 .pdf 文件
```

### 8.2 关键节点详解

#### V1-V3 — 脚手架(2 周前,已远,跳过细节)

```bash
# 创建项目
npm create vite@latest leoliao-app -- --template lit-ts
cd leoliao-app
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "知识库" com.leoliao.app --web-dir=dist
npx cap add android
```

**踩坑**:
- ❌ `npx cap init` 忘了加 `--web-dir` → 后 build 路径不对
- ❌ 第一次 build 后忘了 `cap sync` → APK 里是空 web 资源

**学到**:
- 初始化时所有参数都要明确指定
- build → cap sync 是固定两步

#### ⭐ V4 — cors-fix(里程碑)

**问题**:WebView 默认拦截跨域 fetch,但手机 APP 又必须从 OSS 拉笔记。

**错误做法**(尝试过):
```ts
const res = await fetch('https://liaoguogang.oss-cn-shanghai.aliyuncs.com/...');
// → Failed to fetch, WebView CORS 拦截
```

**正确做法**(V4 修复):
```ts
import { CapacitorHttp } from '@capacitor/core';
const res = await CapacitorHttp.get({
  url: 'https://liaoguogang.oss-cn-shanghai.aliyuncs.com/manifest.json',
  // 走原生 HTTP,不走 WebView fetch,绕过 CORS
});
```

**踩坑**:
- ❌ 一开始尝试在 OSS 配 CORS 头 → OSS 不允许 `*`,需要精确 origin,但 Capacitor WebView 的 origin 是 `capacitor://localhost`,OSS 没法配
- ❌ 用 nginx 反代 → 慢、增加运维成本
- ✅ `CapacitorHttp` 是 Capacitor 6 自带的,直接用,**这是最干净的方案**

**学到**:**遇到 WebView CORS 不要去改服务端,改用 `CapacitorHttp` 走原生通道**。这是 Capacitor 的核心能力之一,99% 的 WebView 限制都能用类似的 native 桥接绕开。

#### ⭐ V7-V8 — debug 面板(开发范式转变)

**V7 之前**:调试靠 `adb logcat | grep -i capacitor`,**必须连着 USB 线 + 有 adb 环境**,等于没法在通勤路上调试。

**V7 改动**:全屏触摸事件加 `console.log`,但还是只能在 DevTools 里看。

**V8 决定**(真正的范式转变):

加一个屏幕右下角的实时日志面板,显示:
- 最近 50 条 console.log
- 最近 10 个错误(红字)
- 触摸坐标(调试触摸事件)
- 当前 state 摘要

代码核心(`src/components/debug-panel.ts`):

```ts
// 把 console.log 劫持,推到面板
const origLog = console.log;
console.log = (...args) => {
  origLog(...args);
  this.logs.push({ time: Date.now(), level: 'log', text: args.join(' ') });
  if (this.logs.length > 50) this.logs.shift();
  this.requestUpdate();
};
```

**踩坑**:
- ❌ 一开始想用 Shadow DOM → 但当时用了 light DOM,组件挂载逻辑会冲突,先妥协用 light DOM
- ❌ 触摸日志太频繁 → 加 throttle(每 100ms 只记一次)

**学到**:**任何 Capacitor / 移动端项目,先加一个屏幕内 debug 面板**。`adb logcat` 在外面调,这个在里面调,缺一不可。

#### ⭐ V10 — no-details(性能决策)

**问题**:文件树有 1216 个节点,Android WebView 上 `<details>` 展开/收起**触屏不灵敏**,要双击才展开。

**决定**:`<details>` 弃用,改 `<div>` + 手写 toggle state。

```ts
// 旧(V9 之前):
html`<details><summary>${folder.name}</summary>${children}</details>`

// 新(V10+):
private toggleFolder(path: string) {
  this.expanded = this.expanded.includes(path)
    ? this.expanded.filter(p => p !== path)
    : [...this.expanded, path];
  this.requestUpdate();
}

render() {
  return html`<div class="folder" @click=${() => this.toggleFolder(f.path)}>
    ${f.name} ${this.expanded.includes(f.path) ? '▼' : '▶'}
  </div>`;
}
```

**踩坑**:
- ❌ 一开始想用 `<details>` 的 `open` 属性 + CSS → 性能差、touch 行为不一致
- ❌ 用 `lit-html` 的 `if` 直接控制展开 → 重渲染整个子树
- ✅ 自己维护 `expanded: string[]` 数组,只 toggle 单个节点

**学到**:**Android WebView 上 `<details>` / `<dialog>` / native form 控件都有兼容问题**。能自己写就自己写。

#### ⭐ V15 — force scroll(滚动穿透)

**问题**:笔记正文 + 文件树都有滚动条,**在文件树滚动到底再向下滑动,会触发笔记正文滚动**(滚动穿透)。手机上的灾难性 UX。

**尝试过的修法**(都没完全解决):
- `touchmove preventDefault` → 阻止了文件树自身滚动
- `-webkit-overflow-scrolling: touch` → iOS 用的,Android WebView 行为不一致
- JS 计算滚动位置 → 太复杂、性能差

**最终方案**(一行 CSS):

```css
/* styles.css */
.file-tree, .note-content {
  overflow-y: scroll !important;  /* 强制显示滚动条 + 隔离滚动上下文 */
  -webkit-overflow-scrolling: touch;
}
```

**为什么 work**:把滚动区域变成"独立滚动上下文"(scroll container),Android WebView 会正确处理边界触摸事件。

**踩坑**:
- ❌ 用 `overflow-y: auto` → 不行,某些 Android 版本行为不一致
- ❌ 用 `overflow-y: hidden` + JS → 复杂、性能差
- ✅ `overflow-y: scroll !important` 是经验最优解

**学到**:**CSS `overflow-y: scroll` 永远比 `auto` 在移动 WebView 上更可靠**。`!important` 不可耻,跨平台兼容就要这样。

#### V22-V28 — 搜索 bug 系列(状态管理教学案例)

这是 8 个版本修一个 bug 的故事,**比成功案例更值得讲**。

**Bug**:搜索"xxx"后清空,文件树**不恢复全貌**,只剩"重新同步"按钮才能恢复。

**V22 修法**(失败):

```ts
// 以为:搜索时把全量备份,清空时恢复
@state() entries: Entry[] = [];          // 全量
@state() searchTerm = '';

onSearch() {
  if (!this.searchTerm) {
    this.entries = this.entries;  // ⚠️ 不对!这没恢复成"全量"
  }
}
```

问题:`this.entries` 当时已经被搜索 filter 过 mutate 了,等同全量丢了。

**V23 修法**(失败,逻辑对了但没 build):

```ts
@state() allEntries: Entry[] = [];       // 全量备份
@state() entries: Entry[] = [];           // 当前展示
@state() searchTerm = '';

onSearch() {
  if (!this.searchTerm) {
    this.entries = this.allEntries;       // ✅ 逻辑对
  } else {
    this.entries = this.allEntries.filter(e => e.path.includes(this.searchTerm));
  }
}
```

但**改完代码忘了跑 `npm run sync`**,APK 里的 JS 还是 V22 旧 hash `DH4RPAG0`。

**V24 修法**(终于 build 了,但还是不对):

跑了 `npm run sync`,hash 变成 `DP6OMa7Z`,**新代码进了 APK**。但搜索×按钮清空后还是不恢复。

调试发现:`<input type="search">` 的 × 按钮在 Android WebView 上**只触发 `@search` 事件,不触发 `@input`**。我的 handler 只绑了 `@input`。

**V25 修法**(重构):

```ts
// 用 getter 算派生值,不再 mutate
@state() allEntries: Entry[] = [];
@state() searchTerm = '';

private get displayEntries(): Entry[] {
  if (!this.searchTerm) return this.allEntries;
  return this.allEntries.filter(e =>
    e.path.toLowerCase().includes(this.searchTerm.toLowerCase())
  );
}

render() {
  const entries = this.displayEntries;  // render 时算,不存在数据丢失
  return html`...`;
}
```

逻辑完美,但×按钮还是不触发 `@input`...

**V26 修法**(事件兜底,**最终解决**):

```html
<input
  type="search"
  class="search"
  @input=${this.onSearch}
  @search=${this.onSearch}    ← 关键:type="search" 专用
  @change=${this.onSearch}
  @keyup=${this.onSearch}
/>
```

4 个事件都绑同一个 handler,**任何一个触发都跑搜索**。

**5 个版本学到的**:

1. **Hash 是真话** — V23 改了代码没 build,APK 行为不变;V24 终于 build 了才发现事件没触发
2. **mutate 关键 state 是雷** — `this.entries = this.entries` 这种"看起来赋值了"实际丢数据
3. **派生用 getter 不用 state** — 避免数据同步问题
4. **`<input type="search">` × 按钮不发 `@input`** — 跨平台 WebView 行为差异,**默认用 `type="text"` 更稳**
5. **多事件绑多兜底** — 一行代码解决一周扯皮

#### ⭐ V29 — 5 大特性(一次性大改)

**决定**:基础稳了,一次性加 5 个特性:
1. 顶部 toolbar(⚙️ 设置 / ↗️ 分享 / ❓ 帮助)
2. 5 个主题预设(深/白/羊皮纸/护眼绿/夜色)
3. 主题自定义(9 个 CSS var 单独调)
4. 系统分享面板(Capacitor Share)
5. 点阅读区自动关侧栏

**关键文件**:
- `src/components/settings-panel.ts` — 主题设置 modal
- `src/components/share-panel.ts` — 分享 modal
- `src/components/help-panel.ts` — 帮助 modal
- `src/services/settings.ts` — 主题持久化
- `src/styles.css` — 主题 CSS var 定义

**踩坑**:
- ❌ 一开始想用 Shadow DOM 隔离 modal 样式 → 但 Lit + Shadow DOM + 全局 var 传递复杂,先全部 light DOM
- ❌ 主题切换后 toolbar 还是深色 → 因为只设了 4 个 CSS var,漏了 `--bg-2` `--border` `--dim`(V30 修)

**学到**:**基础够稳时,一次加 5 个特性比拆 5 个版本效率高**。前提是前 21 个版本把基础打牢。

#### V31 — 导出 PDF "无反应"(踩坑典型)

**用户反馈**:点了"导出 PDF"按钮,**什么都没发生**。

**调查**:

`src/services/export-service.ts` 当时是这样写的(简化):

```ts
export function exportPDF(note, settings, onDone) {
  const html = generateHTML(note, settings);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;...';
  document.body.appendChild(iframe);

  if (!iframe.contentWindow) {  // ← Android WebView 里永远是 null
    const w = window.open('', '_blank');  // ← Android WebView 里被拦截
    if (w) { ... }
    else {
      downloadBlob(html, ...);  // ← Android WebView 不支持 <a download>
    }
    return;
  }

  // 这段永远走不到
  iframe.contentWindow.document.write(html);
  iframe.contentWindow.print();
}
```

**根因链**:
1. `iframe.contentWindow` 在 Android WebView 里**永远是 null**(iframe 没真加载)
2. → 走 `window.open` 分支
3. → Android WebView 默认拦截 `window.open`,返回 `null`
4. → 走 `downloadBlob` 分支
5. → Android WebView **不支持 `<a download>` 触发下载**
6. → **完全静默 noop** → 用户看到"无反应"

**HTML 导出能用的原因**:走的是 `Filesystem.writeFile` + `Capacitor Share`(原生 API,不走 WebView)。

**第一次修复尝试**(V31 → V32 之间):
- 直接改成"导出 HTML 文件,用户拿去 WPS/浏览器另存为 PDF"
- **用户反馈:不行,要真 PDF**

**学到**:
- ❌ **Android WebView 没有"打印为 PDF"能力**,`window.print()` 不被支持
- ❌ `window.open` 被默认拦截
- ❌ `<a download>` 不触发下载
- ✅ **必须** 客户端生成 PDF(canvas + jsPDF)

#### ⭐ V32 — 客户端真 PDF(html2canvas + jsPDF)

**实现**:

```ts
// src/services/export-service.ts (V32 重写后)

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function exportPDF(note, settings, onDone) {
  // 1. 把笔记 HTML 塞进离屏 div
  const container = document.createElement('div');
  container.innerHTML = generateHTML(note, settings);
  container.style.cssText = 'position:fixed;left:-10000px;width:794px;...';
  document.body.appendChild(container);

  // 2. 等图片/字体加载
  await waitForAssets(container);

  // 3. html2canvas 截图(高清 scale=2)
  const canvas = await html2canvas(container, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
  });
  document.body.removeChild(container);

  // 4. 按 A4 切片,jsPDF 输出
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidthMm = 210, pageHeightMm = 297;
  const imgWidthMm = pageWidthMm;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  if (imgHeightMm <= pageHeightMm) {
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidthMm, imgHeightMm);
  } else {
    // 多页:逐页 addImage,自动 addPage
    let remaining = imgHeightMm, position = 0;
    while (remaining > 0) {
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidthMm, imgHeightMm);
      remaining -= pageHeightMm;
      position -= pageHeightMm;
      if (remaining > 0) pdf.addPage();
    }
  }

  // 5. 拿 PDF Blob → base64
  const pdfBlob = pdf.output('blob');
  const pdfBase64 = await blobToBase64(pdfBlob);

  // 6. 原生平台:Filesystem.writeFile + Share
  //    Web 平台:直接 <a download>
  ...
}
```

**新增依赖**:
```powershell
npm install --save html2canvas jspdf
```

**包大小变化**:

| 版本 | dist/index-XXX.js (gzip) |
|---|---|
| V30 | ~125 KB |
| V32 | **313 KB**(+188 KB) |

加上 jspdf 自己的 vendor chunks:
- `purify.es-XXX.js` 28 KB (DOMPurify,jspdf 用)
- `index.es-XXX.js` 150 KB (jspdf 主包)

总计 +~370 KB 原始 / +190 KB gzip。

**踩坑**:
- ❌ 一开始用 `image/png` 输出 → PDF 文件巨大(50MB+),改成 `image/jpeg, 0.92` 缩到 1-3MB
- ❌ 中文 + emoji 在 html2canvas 上偶尔不渲染 → 加 `font-family: -apple-system,PingFang SC,Microsoft YaHei,sans-serif` 兜底
- ❌ `<img>` 跨域 → 设 `useCORS: true`,并把 `crossOrigin` 加到 img 标签
- ❌ 首次生成慢(2-5s) → 没法优化,html2canvas 就是要时间,UI 加 loading 提示

**学到的**:
- 客户端 PDF = 包大 + 慢,但是**最干净**的方案,不依赖任何系统能力
- 文字**不可选中/复制**(canvas 截图的固有局限)
- 想文字可选 → 必须用真正的 PDF 库如 pdfmake(自己写 PDF 元素,不支持 HTML)或服务端方案(puppeteer)

---

## 9. 三层 hash 一致性 — 唯一的真理

这是这份指南最重要的一节。

### 9.1 为什么 hash 重要

Vite/Webpack 输出的 bundle 文件名是**内容 hash**(MD5 前几位)。改一个变量、删一个空格、加一个 import,**整个文件 hash 都会变**。

**所以**:
- 改代码 → hash 变 → 跟上次 APK 比对 hash,**变了才是真改了**
- 没改代码但 hash 没变 → 改了文件但 vite 没生效 → 清 `node_modules\.vite` 重 build

### 9.2 三处必须一致

```
src/*.ts (源码)
  ↓ vite build
dist/assets/index-XXXX.js  ← ①
  ↓ cap sync
android/app/src/main/assets/public/assets/index-XXXX.js  ← ②
  ↓ gradle assembleDebug
APK 内 assets/public/assets/index-XXXX.js  ← ③
```

**任何一处 hash 不一致 = 你的修改没生效到那一层**。

| 现象 | 排查 |
|---|---|
| ① ≠ ② | `npm run sync` 没跑 |
| ② ≠ ③ | Gradle 用了缓存,清 `android/app/build` 重 build |
| ① 都没变 | 改了文件但 vite 没生效,清 `node_modules\.vite` |

### 9.3 PowerShell 验 APK 三步

```powershell
# Step 1: 看本地 dist 的 hash
Get-ChildItem D:\leoliao-app\dist\assets\index-*.js | Select-Object Name

# Step 2: 看 Android assets 的 hash(应一致)
Get-ChildItem D:\leoliao-app\android\app\src\main\assets\public\assets\index-*.js | Select-Object Name

# Step 3: 解 APK 看里面的 hash(应一致)
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"
Copy-Item $apk "$env:TEMP\chk.zip"
if (Test-Path "$env:TEMP\chkext") { Remove-Item -Recurse -Force "$env:TEMP\chkext" }
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\chkext" -Force
Get-ChildItem "$env:TEMP\chkext\assets\public\assets\index-*.js" | Select-Object Name
```

三个 Name 字段必须完全一样(连 hash 后缀都一致)。

### 9.4 自动化脚本

放在项目根 `check-hash.ps1`:

```powershell
# check-hash.ps1
$projectRoot = $PSScriptRoot
$distFile = (Get-ChildItem "$projectRoot\dist\assets\index-*.js")[0].Name
$androidFile = (Get-ChildItem "$projectRoot\android\app\src\main\assets\public\assets\index-*.js")[0].Name

$apkPath = "$projectRoot\android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apkPath)) {
    Write-Host "APK not built yet" -ForegroundColor Yellow
    return
}

Copy-Item $apkPath "$env:TEMP\chk.zip" -Force
if (Test-Path "$env:TEMP\chkext") { Remove-Item -Recurse -Force "$env:TEMP\chkext" }
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\chkext" -Force
$apkFile = (Get-ChildItem "$env:TEMP\chkext\assets\public\assets\index-*.js")[0].Name

Write-Host "dist     : $distFile"
Write-Host "android  : $androidFile"
Write-Host "apk      : $apkFile"

if ($distFile -eq $androidFile -and $androidFile -eq $apkFile) {
    Write-Host "`n✅ All three hashes match!" -ForegroundColor Green
} else {
    Write-Host "`n❌ HASH MISMATCH! Re-run npm run sync and rebuild APK" -ForegroundColor Red
}
```

用法:
```powershell
.\check-hash.ps1
```

---

## 10. 调试技巧大全

### 10.1 Chrome 远程调试 WebView

最强大的工具,直接看真机 console。

```powershell
# 1. 手机开 USB 调试,插电脑
adb devices   # 确认设备

# 2. 装 APP 并打开

# 3. 电脑 Chrome 浏览器打开
#    chrome://inspect/#devices

# 4. 找到 WebView,点 "inspect"
#    看到 Console / Network / Storage / Application 标签
```

> **V25 后加了内部 debug 面板**,通勤路上没电脑也能看 console.log。

### 10.2 logcat 实时日志

```powershell
adb logcat | Select-String -Pattern "Capacitor|console|chromium" -SimpleMatch
```

macOS/Linux:
```bash
adb logcat | grep -E "Capacitor|console|chromium"
```

### 10.3 grep bundle 找某段代码是否进了 APK

```powershell
# 解 APK 后,搜索关键字符串
$js = "$env:TEMP\chkext\assets\public\assets\*.js"
Select-String -Path $js -Pattern "exportPDF|html2canvas"
```

### 10.4 看 APK mtime

```powershell
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"
Get-Item $apk | Select-Object Name, LastWriteTime, Length
```

### 10.5 临时调试:加 console.log 到源码

```ts
// 在 exportPDF 入口加
console.log('[exportPDF] called', note.path, settings.bgColor);
```

build → 装 → 跑 → 看 logcat 或 debug 面板。

**用完要删**,生产代码不要留 console.log。

### 10.6 远程改文件热重载

dev 模式下 (`npm run dev`),改 `src/*.ts` 后浏览器自动 hot-reload。**但手机上不行**,手机上必须 build → sync → install 整套流程。

### 10.7 截图当前屏幕

```powershell
adb shell screencap -p /sdcard/screen.png
adb pull /sdcard/screen.png .
```

调试 UI 问题时必备。

---

## 11. 26+ 个踩坑大全

按类别整理,V1-V32 全部踩过的。

### 11.1 Shell / PowerShell 坑(5)

1. **PowerShell 不认 `./gradlew`** → 用 `.\gradlew.bat`(反斜杠 + .bat 后缀)
2. **Windows tar 不支持 `--overwrite`** → 先 `Remove-Item -Recurse -Force` 再解压
3. **Windows tar 中文路径警告** → 可忽略,实际解压 OK(`ls` 验证)
4. **PowerShell 不认 `cd /d`** → 用 `cd D:\leoliao-app` 完整路径
5. **PowerShell 粘贴带换行的命令** → `npm run android:apk` 后跟着 `# 3. 找 APK` 那两行会被当成命令执行,确保粘贴干净

### 11.2 Build / Cache 坑(6)

6. **改了源码 vite hash 没变** → 清 `Remove-Item -Recurse -Force node_modules\.vite`
7. **gradle 增量构建跳过** → 清 `Remove-Item -Recurse -Force android\app\build` 重 build
8. **APK hash 不是新 hash** → 验证三处 hash 一致(§9)
9. **旧 JS 文件累积在 APK** → 清 `Remove-Item android\app\src\main\assets\public\assets\index-*.js`
10. **多了 npm 依赖没装** → `npm install` 后再 `npx cap sync android`
11. **加了 Capacitor 插件忘了 cap sync** → gradle 报 "Could not resolve project :capacitor-xxx"

### 11.3 adb 坑(5)

12. **adb 找不到设备** → USB 调试要开 + 数据线能传数据 + 点了"允许"
13. **adb 不在 PATH** → 用绝对路径 `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`
14. **APK 安装失败 "签名不同"** → 先 `adb uninstall com.leoliao.app` 再装
15. **APK 装上但行为没变** → Android WebView 缓存,`adb uninstall` 后重装
16. **`adb: command not found`** → SDK 没装,见 §2

### 11.4 状态 / 逻辑坑(5)

17. **mutate `this.entries` 丢全量** → 改用 `displayEntries` getter(V22-V25 教训)
18. **CSS var 漏设 `--bg-2` `--border` `--dim`** → `applySettings` 必须全套 9 个 var(V30 教训)
19. **分享内容硬截 500 字** → 默认完整内容,超长才截(V30 教训)
20. **`<input type="search">` × 按钮不发 `@input`** → 多绑 `@search @change @keyup` 兜底(V26 教训)
21. **localStorage 老格式不兼容** → 加载时合并默认值 `{...DEFAULT, ...parsed}`(V30 教训)

### 11.5 解析 / 渲染坑(4)

22. **wikilink rule 误拒绝 `[[...]]`** → 删错的条件分支(V28 教训)
23. **markdown-it wikilink 第一个字没了** → 检查 rule 优先级(V28 教训)
24. **`<details>` 在 Android WebView touch 不稳** → 自己维护展开状态(V10 教训)
25. **lit unsafeHTML 注入 XSS 风险** → 别直接渲染用户输入

### 11.6 配置 / 凭证坑(3)

26. **aliyun CLI profile 名错** → 用实际名 `leo-oss` 不是 `obsidian-sync`
27. **`oss cp` 覆盖要 `-f`** → 加在 URL 后面
28. **用 `cc-connect send` exit 0 误判成功** → 真的去读 config 验证

### 11.7 PDF 导出坑(V31-V32 新增,4)

29. **`window.print()` 在 Android WebView 不支持** → 用客户端 PDF(html2canvas + jsPDF)
30. **`window.open` 在 Android WebView 被拦截** → 不要 fallback 到这个
31. **`<a download>` 在 Android WebView 不触发下载** → 不要 fallback 到这个
32. **客户端 PDF 包大 190KB** → 接受这个 trade-off,或者用服务端方案
33. **PDF 里文字不可选中** → canvas 截图的固有局限,要可选中就用 pdfmake 写 PDF(不支持 HTML)
34. **中文 emoji 偶尔不渲染** → 加 `font-family: -apple-system,PingFang SC,Microsoft YaHei,sans-serif` 兜底
35. **首次生成慢 2-5s** → 加 loading 提示,无法加速

### 11.8 Vite / TypeScript 坑(3)

36. **TS 严格模式 `'reject' declared but never read`** → 改用 `Promise.resolve()` 等不需要 reject 的形式
37. **TS 找不到模块** → `npm install` 后再 build
38. **Vite 大包警告**(`Some chunks are larger than 500 kB`) → 不影响功能,可忽略,真要优化用 `manualChunks`

### 11.9 V33 部署坑(全新分类,8 个)

> 这一节是 V33 加 file-picker 4 小时血战的全部教训。**每个都附"症状 → 修法"**。

39. **tar 包漏打 `android/` 顶层**(`gradlew.bat` 缺失)
    - 症状:解压后 `Test-Path .\gradlew.bat` 返回 False
    - 原因:打包脚本只 `tar czf ... leoliao-app/android/app/src/main/assets/public`(只打子目录)
    - 修法:tar 命令必须 `leoliao-app/android` 整个目录打进去。Leo 自己的 tar 命令应该是:
      ```bash
      tar czf app-vXX.tar.gz leoliao-app/{dist,src,android,index.html,package.json,capacitor.config.ts,vite.config.ts,tsconfig.json}
      ```

40. **tar 包漏打 `index.html`**
    - 症状:解压后 `npm run build` 报 `Could not resolve entry module "index.html"`
    - 原因:Vite 入口默认是项目根 `index.html`,打包时漏了
    - 修法:tar 命令加 `leoliao-app/index.html`(根目录那个,不是 `dist/index.html`)

41. **新解压的 `android/` 缺 `local.properties`**
    - 症状:Gradle 报 `SDK location not found`
    - 原因:`local.properties` 跟用户本地路径相关,`.gitignore` 排除,tar 不应该打
    - 修法:手动建(用 ASCII 无 BOM):
      ```powershell
      [System.IO.File]::WriteAllText('D:\leoliao-app\android\local.properties', 'sdk.dir=C:\Users\guoga\AppData\Local\Android\Sdk', [System.Text.Encoding]::ASCII)
      ```
    - **路径要看 Leo 的实际 Windows 用户名,不是 `guoga` 套用**

42. **PowerShell `Set-Content` 写文件带 BOM**
    - 症状:Gradle 报 `java.io.IOException: Invalid file path` 但 `local.properties` 内容看着对
    - 原因:`Set-Content` 默认 UTF-16 LE + BOM,Gradle 期望 UTF-8 无 BOM
    - 修法:用 `.NET` 直接写(唯一保险的写法):
      ```powershell
      [System.IO.File]::WriteAllText('文件路径', '内容', [System.Text.Encoding]::ASCII)
      ```
    - `Out-File -Encoding ASCII` 也不可靠,某些 PowerShell 版本仍会写 BOM

43. **PowerShell 默认 `java` 不是 JDK 17**(根因!)
    - 症状:AGP 8.2.1 Configure 阶段报 `Invalid file path`,具体哪个文件没说
    - 原因:PowerShell PATH 里第一个 `java` 可能是 JRE 8 / 11 / 21,AGP 8.2.1 严格要求 JDK 17
    - 修法:**设 `JAVA_HOME` 指向 Android Studio 自带 jbr**:
      ```powershell
      $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
      ```

44. **`gradlew.bat` 走 cmd 忽略 PowerShell 环境变量** ⭐
    - 症状:设了 `JAVA_HOME` 但 `gradlew.bat` 没用上,还是 `Invalid file path`
    - 原因:`gradlew.bat` 是 cmd 批处理,内部有自己的一套环境处理,某些 PowerShell 环境变量传不进去
    - 修法:**Windows 上也用 `gradlew`(Unix 风格)**,不是 `gradlew.bat`
      ```powershell
      .\gradlew assembleDebug      # ✅ 对
      .\gradlew.bat assembleDebug  # ❌ 错(忽略环境变量)
      ```
    - **这条修正了 BUILD-GUIDE 老文档的错误**(我之前一直写 `gradlew.bat`)

45. **`services.gradle.org` 网络抽风**
    - 症状:Gradle wrapper 下载 timeout 10s 或 HTTP 504
    - 原因:中国大陆访问 `services.gradle.org` 经常超时,镜像 `github.com/gradle/gradle-distributions/releases/...` 也经常 504
    - 修法:改用腾讯云镜像:
      ```powershell
      (Get-Content gradle-wrapper.properties) `
        -replace 'services.gradle.org/distributions', 'mirrors.cloud.tencent.com/gradle' `
        | Set-Content gradle-wrapper.properties
      ```
    - 阿里云 mavenCentral 镜像也建议加上(在 `android/build.gradle` 的 `allprojects { repositories { ... } }` 加 `maven { url 'https://maven.aliyun.com/repository/public' }` 等)

46. **Capacitor 插件版本不匹配导致 AGP 兼容问题**
    - 症状:Gradle Configure 阶段报 `Failed to create Jar file ... bcprov-jdk18on-1.79.jar`
    - 原因:`@capawesome/capacitor-file-picker@8.0.3` 用了 AGP 8.13,要求 Gradle 8.13+,跟项目 Gradle 8.2.1 不兼容
    - 修法:用 `--legacy-peer-deps` 装时,默认会装最新版本,需要手动指定**跟 Capacitor 主版本兼容**的版本:
      - Capacitor 6 项目 → `@capawesome/capacitor-file-picker@6.2.0`(用 AGP 8.2.1)
      - Capacitor 7 项目 → `@capawesome/capacitor-file-picker@7.x`
      - Capacitor 8 项目 → `@capawesome/capacitor-file-picker@8.x`
    - 验证:装完看 `node_modules/@capawesome/capacitor-file-picker/android/build.gradle` 里 `classpath 'com.android.tools.build:gradle:X.Y.Z'` 是不是跟自己项目的 AGP 一致

---

## 12. 跨平台开发(iOS 准备)

虽然现在只做了 Android,但 Capacitor 的好处是 iOS 代码复用 99%。

### 12.1 macOS 环境

```bash
xcode-select --install                    # Xcode CLI
brew install cocoapods                    # iOS 依赖管理
brew install ios-deploy                   # 真机装 IPA
```

### 12.2 创建 iOS 项目(一次性)

```bash
cd ~/leoliao-app
npx cap add ios                           # 生成 ios/ 目录
cd ios && pod install && cd ..            # 装 iOS 依赖
```

### 12.3 编译 iOS

```bash
npm run sync                              # = tsc + vite build + cap sync

# 模拟器
xcodebuild -workspace ios/App/App.xworkspace -scheme App -sdk iphonesimulator
xcrun simctl list devices booted
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.leoliao.app

# 真机(需要 Apple Developer 账号 $99/年 + 签名证书)
xcodebuild -workspace ios/App/App.xworkspace -scheme App -sdk iphoneos \
  -destination "platform=iOS,id=<device-udid>"
ios-deploy -b ios/build/Build/Products/Debug-iphoneos/App.app -d <udid>
```

### 12.4 iOS 特有坑

- **WKWebView 缓存更激进** → 给静态资源加 cache-bust query string(`?v=<hash>`)
- **iPhone 刘海 / 底部 home indicator** → `viewport-fit=cover` + `env(safe-area-inset-*)`
- **iOS 14+ 隐私 manifest** → 必须在 `Info.plist` 填 `NSPrivacyAccessedAPIType`
- **滚动穿透** → iOS 上 `-webkit-overflow-scrolling: touch` 真的有效(Android 不一定)
- **PDF 导出行为差异** → iOS WKWebView **支持** `window.print()`,所以 PDF 导出在 iOS 上可能反而比 Android 简单(可以用真打印对话框)

---

## 13. 排错清单(从报错信息找解)

| 报错 | 原因 | 解决 |
|---|---|---|
| `node : 无法将"node"项识别为 cmdlet...` | Node 没装 | 装 Node.js 20+ |
| `'.' 不是内部或外部命令...` | PowerShell 不认 `./gradlew` | 用 `.\gradlew` 不是 `./gradlew` 也不是 `.\gradlew.bat` |
| `JAVA_HOME not set` | JDK 没装或没设环境变量 | 装 Android Studio(自带 JDK 17),**显式设 `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`** |
| `SDK location not found` | Android SDK 没装 | 装 SDK,见 §2.3 |
| `adb : 无法将"adb"项识别...` | adb 不在 PATH | 用绝对路径 `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"` |
| `Could not determine the dependencies of task ':app:compileDebugJavaWithJavac'` | 同上 SDK 没装,或 JDK 版本不对 | 装 SDK + 设 JAVA_HOME |
| `Cannot find module @capacitor/xxx` | 装新插件没 `npm install` | `npm install` |
| `Could not resolve project :capacitor-xxx` | 装新插件没 `cap sync` | `npx cap sync android` |
| `Cannot find module 'xxx' from xxx.ts` | TS 模块路径错 | 看 `tsconfig.json` paths 配置 |
| `error TS6133: 'xxx' is declared but its value is never read` | TS 严格模式 | 删掉未用变量 |
| `EACCES: permission denied` | 权限问题 | 不要用管理员 PowerShell,关掉重开 |
| `npm ERR! ERESOLVE unable to resolve dependency tree` | 依赖版本冲突 | `npm install --legacy-peer-deps` |
| `tar.exe: --overwrite is not supported` | Windows tar 不支持 | 先删目录再解压 |
| `tar.exe: Error opening archive: Invalid empty pathname` | 中文路径 | 警告可忽略,验证解压结果 |
| `Failed to fetch` (在 WebView 里) | CORS 拦截 | 用 `CapacitorHttp` 替代 `fetch` |
| APK 装上但行为没变 | WebView 缓存 | `adb uninstall` 后 `adb install -r` |
| APK 装失败 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 签名冲突 | `adb uninstall` 卸老版本再装 |
| Vite 输出 hash 没变 | vite 缓存 | 清 `node_modules\.vite` |
| Gradle 报 `License for package ... not accepted` | SDK license 没接受 | `yes | sdkmanager --licenses` |
| HTML 导出按钮能用,PDF 按钮无反应 | Android WebView 不支持 window.print | V32 修复:客户端生成 PDF |
| **V33 新增** `Could not resolve entry module "index.html"` | tar 包漏打根 `index.html` | 重打包加 `leoliao-app/index.html` |
| **V33 新增** `Test-Path .\gradlew.bat` 返回 False | tar 包漏打 `android/` 顶层 | 重打包加 `leoliao-app/android` 整个 |
| **V33 新增** Gradle `Invalid file path`(无具体文件) | 4 个根因:① JDK 不是 17 ② 用 `gradlew.bat` ③ `local.properties` 带 BOM ④ AGP/Gradle 版本不兼容 | 依次:① 设 `$env:JAVA_HOME` ② 用 `.\gradlew` ③ 用 `[System.IO.File]::WriteAllText` 重写 ④ 装兼容版本的 Capacitor 插件 |
| **V33 新增** `Failed to create Jar file ... bcprov-jdk18on-1.79.jar` | `@capawesome/capacitor-file-picker@8.x` 用了 AGP 8.13,跟 Gradle 8.2.1 不兼容 | 降级到 `@capawesome/capacitor-file-picker@6.2.0`(Capacitor 6 项目) |
| **V33 新增** Gradle wrapper 下载 timeout / HTTP 504 | 国内访问 `services.gradle.org` 抽风 | 改腾讯云镜像:`-replace 'services.gradle.org/distributions', 'mirrors.cloud.tencent.com/gradle'` |
| **V33 新增** PowerShell 默认 `java` 跑 Gradle 报 `Invalid file path` | PowerShell 找的 `java` 不是 Android Studio 自带 JDK 17 | 显式设 `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"` |
| **V33 新增** `adb.exe: no devices/emulators found` | 手机没接 / USB 调试没开 / 没点"允许" | 接 USB 线 + 开 USB 调试 + 选"允许" + 数据线要能传数据 |

---

## 14. 一日工作流(推荐节奏)

### 14.1 开发某天

```
上午(改代码):
  09:00  编辑 src/*.ts
  09:30  npm run sync                    ← 5s
  09:35  cd android; .\gradlew.bat assembleDebug   ← 30s-3min
  09:40  adb install -r ...app-debug.apk           ← 5s
  09:45  在手机跑一遍,有问题 chrome://inspect     ← 30min
  10:15  修,再 sync + install
  10:30  OK,git commit

下午(打磨):
  14:00  看看用户反馈 / 自己用着不爽的地方
  14:30  改 + sync + install 循环
  17:00  git commit + git tag vX.Y.Z
```

build 时间预期:
- **首次**:10-15 分钟(下 Gradle + 编译)
- **增量**:30 秒 - 3 分钟
- **只改 CSS / 文本**:几乎瞬时(浏览器 hot-reload)

### 14.2 发布版本

```powershell
# 1. 改完代码,验三处 hash 一致(§9)
.\check-hash.ps1

# 2. 清理老 JS 文件
Remove-Item D:\leoliao-app\android\app\src\main\assets\public\assets\index-*.js

# 3. 重 build
cd D:\leoliao-app
npm run sync

# 4. 打 release 版(需要签名密钥)
cd android
.\gradlew.bat assembleRelease

# 5. APK 在 android\app\build\outputs\apk\release\app-release.apk
#    签名后的 APK 可以直接发到阿里云 OSS / 微信群 / 邮件
```

签名密钥在 `android/app/leoliao.keystore`,别丢。

---

## 15. 自检清单(开发完成时跑一遍)

### 15.1 Build 检查

- [ ] 三处 hash 完全一致(dist / android assets / APK)
- [ ] APK 装到手机能正常打开
- [ ] 没有 `error TSxxxx` 报错
- [ ] 没有 `Could not resolve project` 报错
- [ ] 没有 `License not accepted` 报错

### 15.2 状态设计检查

- [ ] 数据源 / 过滤 / 派生分开(用 getter 算派生)
- [ ] 单字段只承担一个职责
- [ ] 关键 state 不可变更新 `{ ...s, key: value }`
- [ ] localStorage 加载容错(老格式补字段)

### 15.3 UI 检查

- [ ] 顶部 toolbar sticky 在 viewport 顶部
- [ ] 侧栏移动端 translateX 动画
- [ ] 主区点击关侧栏,但 toolbar 点击不关
- [ ] ESC 关闭 modal
- [ ] 点遮罩关闭 modal
- [ ] 主题切换 → 所有相关 CSS var 都更新
- [ ] 字体 / 字号独立可调

### 15.4 跨平台兼容

- [ ] 输入事件绑多个 (`@input @change @search @keyup`)
- [ ] 触控 target ≥ 32px(老人友好)
- [ ] Android 后退键关 modal/侧栏

### 15.5 功能完成后

- [ ] APK 在真机装,跑核心流程(同步 / 阅读 / wikilink / 分享 / 导出 PDF)
- [ ] 远程 WebView 调试确认 console 无错
- [ ] 导出 HTML 和导出 PDF 都验证过
- [ ] 五个主题预设都能切换且布局不破

---

## 16. 文档结构

```
项目根目录/
├── README.md                   # 用户视角(下载 / 安装 / 用 / 历史)
├── SETUP.md                    # 旧版搭建指南(保留历史)
├── BUILD-GUIDE.md              # 旧版构建指南(V26,保留历史)
├── PLATFORM-GUIDE.md           # 跨平台架构 + iOS 准备
├── APP-DEV-COMPLETE-GUIDE.md   # 旧版开发指南(V30,保留历史)
├── APK-DEV-GUIDE-V32.md        # ← 你正在看(终极指南,取代上面 4 份)
├── BLOG.md                     # 项目博客
│
├── src/                        # 源码
├── android/                    # Android 项目(自动生成,改 build.gradle 等)
├── dist/                       # Vite 输出(自动生成)
└── node_modules/               # npm 依赖(自动生成)
```

**何时看哪份**:
- **新读者**:先看 `README.md` 知道这 APP 是什么
- **想装 APP 试一下**:README 的"给读者"部分
- **想自己改代码打 APK**:本文档(`APK-DEV-GUIDE-V32.md`),从 §2 开始
- **想做 iOS 版**:本文档 §12 + `PLATFORM-GUIDE.md`
- **做下一个 App 想参考**:`APP-DEV-COMPLETE-GUIDE.md`(有更多方法论)

---

## 17. 一句话总结

**做 App 的本质 = 在正确的地方存正确的数据 + 让 UI 实时反映数据变化 + 在用户操作出错时给有用的替代方案 + 在每个版本结束后验证"我的修改真的生效了"(hash 一致性)**。

剩下的就是工具和踩坑了。本文把已知坑都列了,以后任何 App 都能省 80% 时间。

---

## 附录 A:历史 tar 包

每个早期版本都有对应 tar.gz 包在 `/mnt/work/`:

```
leoliao-app-v3-fix.tar.gz          ~ Phase 0 试错
leoliao-app-v4-cors-fix.tar.gz     ~ V4 里程碑
leoliao-app-v5-encode-fix.tar.gz
leoliao-app-v6-scroll-fix.tar.gz
leoliao-app-v7-touch-debug.tar.gz
leoliao-app-v8-debug-panel.tar.gz
leoliao-app-v9-trycatch.tar.gz
leoliao-app-v10-no-details.tar.gz  ~ V10 里程碑
leoliao-app-v11.tar.gz
leoliao-app-v13-final.tar.gz       ~ V13 里程碑
leoliao-app-v18.tar.gz
leoliao-app-v19.tar.gz
leoliao-app-v20.tar.gz
leoliao-app-v21.tar.gz
leoliao-app-v22.tar.gz
leoliao-app-v23.tar.gz
leoliao-app-v24.tar.gz
leoliao-app-v25.tar.gz
leoliao-app-v26.tar.gz
leoliao-app-v27.tar.gz
leoliao-app-v28.tar.gz
leoliao-app-v29.tar.gz             ~ V29 里程碑
leoliao-app-v30-fixed.tar.gz       ~ V30
leoliao-app-v31-export.tar.gz      ~ V31(导出功能初版,有 bug)
leoliao-app-v32-pdf-client.tar.gz  ~ V32(客户端 PDF,最新版)
```

每个 tar 包都包含当时的源码 + 已 build 的 dist + 已 cap sync 的 Android assets,**是完整的可运行环境**,解压 + `npm install` + `cd android && .\gradlew.bat assembleDebug` 就能直接打 APK。

---

## 附录 B:常用命令速查

```powershell
# === Build 相关 ===
npm install                              # 装依赖
npm run dev                              # 浏览器 dev
npm run build                            # tsc + vite build
npm run sync                             # build + cap sync
npm run android:apk                      # build + sync + assembleDebug (Mac/Linux)
npm run fresh                            # 清缓存 + 重 build + 打 APK

# === Gradle 相关 ===
cd android
.\gradlew.bat assembleDebug              # 打 debug APK
.\gradlew.bat assembleRelease            # 打 release APK(需签名)
.\gradlew.bat clean                      # 清 build 目录
.\gradlew.bat installDebug               # build + 装到当前连接设备

# === adb 相关 ===
adb devices                              # 看连接的设备
adb uninstall com.leoliao.app            # 卸老版本
adb install -r <path-to-apk>             # 装新版本
adb logcat                               # 实时日志
adb shell screencap -p /sdcard/s.png     # 截图
adb pull /sdcard/s.png .                 # 拉截图到电脑

# === 文件/目录操作 ===
Remove-Item -Recurse -Force xxx          # 强制删目录
Expand-Archive xxx.zip -DestinationPath yyy  # 解压 zip
tar -xzf xxx.tar.gz -C yyy               # 解压 tar.gz

# === 验证 hash ===
Get-ChildItem dist\assets\index-*.js | Select Name              # dist hash
Get-ChildItem android\app\src\main\assets\public\assets\index-*.js | Select Name   # Android assets hash
.\check-hash.ps1                                                  # 自动三处比对
```

---

## 附录 C:关键文件位置速查

```
源码:               D:\leoliao-app\src\
入口:               D:\leoliao-app\src\main.ts
样式:               D:\leoliao-app\src\styles.css
导出服务:           D:\leoliao-app\src\services\export-service.ts
分享面板:           D:\leoliao-app\src\components\share-panel.ts
项目配置:           D:\leoliao-app\package.json
Capacitor 配置:     D:\leoliao-app\capacitor.config.ts
Vite 配置:          D:\leoliao-app\vite.config.ts

编译输出:           D:\leoliao-app\dist\
Android assets:     D:\leoliao-app\android\app\src\main\assets\public\
APK 输出:           D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk
```

---

文档位置: `D:\leoliao-app\APK-DEV-GUIDE-V32.md`
最后更新: 2026-07-09(V33 部署踩坑后,加了 8 个新坑 + 修正 gradlew.bat 用法)
涵盖版本: V1 - V33
配套文档:
- `README.md` — 项目入口(用户视角)
- `BUILD-GUIDE.md` — 旧版构建指南(V26 时写,本文档已涵盖其内容)
- `APP-DEV-COMPLETE-GUIDE.md` — 旧版方法论(V30 时写,本文档已涵盖其内容)
- `PLATFORM-GUIDE.md` — 跨平台架构细节

如果你跟着这份指南**走到这里并打出了 APK**,恭喜你,你现在已经会做 Capacitor + Lit + Vite + TypeScript + Android 全栈开发了 🎉