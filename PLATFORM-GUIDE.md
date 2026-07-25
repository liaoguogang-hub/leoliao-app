# 知识库 App 跨平台开发经验总结

> 从 Android 知识库 APK 提炼的跨平台经验总结,用于未来 iOS / iPadOS / macOS App 开发。
> 写作时间: 2026-07-08

---

## 0. TL;DR — 5 条最重要的认知

1. **Hash 是真话的来源** —— 改了源码看 hash,改了 config 看 hash,改了 app 看 store hash。"我看代码改了"不算数,字节级校验才算。
2. **分层 + 边界清晰** —— 状态是状态、配置是配置、显示是显示。**绝不**让一个字段承担多个职责 (这次的 `this.entries` 同时是"原始数据"和"过滤结果"是核心 bug)。
3. **事件 + 输入要兜底** —— 跨平台运行时(WebView / 移动浏览器 / 系统版本)行为不一致。一个事件不够,绑 4 个:input / change / search / keyup。
4. **bundler 不是编译器** —— vite/webpack 输出的 bundle 文件名是内容 hash。改一个变量可能让整个文件 hash 变,但也可能不变 (取决于 minify 后的实际字节)。**永远验 APK/IPA 里实际打包的文件**。
5. **永远验实际安装的版本** —— 你装了新 APK,但 Android 系统可能因为签名相同/缓存层叠没替换。要"卸载+装",不是 install -r。

---

## 1. 跨平台架构总览

### 1.1 三层架构（不管 Android 还是 iOS 都是这个）

```
┌────────────────────────────────────────────────────────┐
│ Layer 3: 应用包 (APK / IPA / APP)                        │
│   - 签名 + 资源 + native 代码 + WebView 壳                │
│   - 包名:com.example.app                                   │
│   - 显示名:用户看到的名字                                   │
└────────────────────────────────────────────────────────┘
                            ↑ 打包
┌────────────────────────────────────────────────────────┐
│ Layer 2: 平台原生项目                                     │
│   - Android: android/ 目录 + gradle build                 │
│   - iOS:     ios/ 目录 + xcodebuild                       │
│   - 这一层做的事:把 web 资源 + native 桥打包成可分发格式   │
└────────────────────────────────────────────────────────┘
                            ↑ 拷贝
┌────────────────────────────────────────────────────────┐
│ Layer 1: Web 资源 (编译产物)                              │
│   - HTML / CSS / JS bundle                                │
│   - 文件名是 hash: index-XXXXXX.js                        │
│   - 这一层桥接前端框架(Lit/Vue/React) + Capacitor API     │
└────────────────────────────────────────────────────────┘
                            ↑ 编译
┌────────────────────────────────────────────────────────┐
│ Layer 0: 源码 (开发时编辑的)                               │
│   - src/main.ts / src/components/*.ts                      │
│   - package.json (声明 scripts 和依赖)                     │
│   - capacitor.config.ts (桥接配置)                          │
└────────────────────────────────────────────────────────┘
```

### 1.2 用 Capacitor 一套代码双端跑

知识库用的是 **Capacitor** + Lit (轻量 web components):

| 框架 | Web 端 | Android | iOS |
|---|---|---|---|
| **Capacitor** | ✅ 浏览器直接跑 | ✅ 同源打包 | ✅ 同源打包 |
| **Cordova** | ✅ | ✅ | ✅ |
| **React Native** | ❌ (Metro 单独跑) | ✅ | ✅ |
| **Flutter** | ✅ (Canvas) | ✅ | ✅ |

**推荐**: 如果只是简单 web 套壳,**Capacitor 最快、配置最少**。写一次 Lit/Vue/React 代码,两端都用同一个 webview (Android = Chrome WebView, iOS = WKWebView)。

### 1.3 状态管理原则 (适用所有框架)

| 原则 | 错例 | 对例 |
|---|---|---|
| **单一数据源** | `this.entries` 既装"全量"又装"过滤结果" | 分 `allEntries` + `searchTerm`,render 时算 `displayEntries` |
| **派生属性不存 state** | 把 `displayEntries` 存成 `@state` | 用 `get displayEntries()` 在 render 里算 |
| **事件不 mutate 关键 state** | `@input` handler 把全量扔了 | `@input` 只改 `searchTerm`,全量在另一个字段 |
| **副作用单独函数** | `runSync()` 里既读又写又通知 | `runSync()` 只负责这件事本身 |

---

## 2. 开发环境

### 2.1 通用工具 (两个平台都需)

| 工具 | 用途 |
|---|---|
| Node.js 18+ | 跑 vite/tsc/cap CLI |
| 包管理器 (npm/pnpm) | 装依赖 |
| TypeScript | 类型检查 + 编译 |
| Vite (或 webpack) | 打包前端 |
| Git | 版本控制 |

### 2.2 Android 工具

| 工具 | 来源 | 备注 |
|---|---|---|
| Java JDK 17 | Oracle / OpenJDK | Gradle 必需 |
| Android SDK | cmdline-tools 或 Android Studio | 装 platform-tools + platforms;android-34 + build-tools;34.0.0 |
| Gradle wrapper (./gradlew) | 项目自带 (`./gradlew.bat` on Windows) | 不用单独装 |
| adb | SDK 自带 | 装/卸 APK 用 |
| Android Studio (可选) | 装 SDK 的最简方式 | 自带 SDK + AVD 模拟器 |

### 2.3 iOS 工具 (未来准备)

| 工具 | 来源 | 备注 |
|---|---|---|
| macOS (必需!) | Apple | iOS 开发只能在 macOS 上做 |
| Xcode 15+ | App Store | 自带 iOS Simulator + SDK |
| Xcode Command Line Tools | `xcode-select --install` | 含 `xcodebuild` `simctl` 等 CLI |
| CocoaPods | `brew install cocoapods` 或 `sudo gem install cocoapods` | Capacitor 用它装 iOS 依赖 |
| ios-deploy | `brew install ios-deploy` | 命令行装 IPA 到真机 |
| Apple Developer Account ($99/yr) | developer.apple.com | 真机测试和发布必需 |
| Code Signing 证书 | Xcode → Settings → Accounts | 自动管 |

### 2.4 Capacitor 跨平台命令速查

```bash
# 这些命令同时支持 Android 和 iOS

npx cap add android      # 第一次创建 android/ 项目
npx cap add ios          # 第一次创建 ios/ 项目
npx cap sync android     # 同步 web 资源到 Android
npx cap sync ios         # 同步 web 资源到 iOS
npx cap open android     # 用 Android Studio 打开
npx cap open ios         # 用 Xcode 打开
npx cap run android      # 构建 + 装 + 跑
npx cap run ios          # 同上 iOS
```

---

## 3. 构建流程对比

### 3.1 Android 完整流程 (经验证)

```
源码 (src/*.ts)
    ↓ tsc (类型检查)
    ↓ vite build (打包 + 内容hash 命名)
dist/assets/index-XXXX.js
    ↓ cap sync android
android/app/src/main/assets/public/assets/index-XXXX.js
    ↓ ./gradlew.bat assembleDebug
android/app/build/outputs/apk/debug/app-debug.apk
    ↓ adb install
📱 装到手机
```

### 3.2 iOS 完整流程 (Capacitor, 推荐路径)

```
源码 (src/*.ts)
    ↓ tsc
    ↓ vite build
dist/assets/index-XXXX.js
    ↓ cap sync ios
ios/App/public/assets/index-XXXX.js
    ↓ cd ios && pod install  (CocoaPods 装 iOS 依赖)
    ↓ xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator
ios/build/Build/Products/Debug-iphonesimulator/YourApp.app  (或在真机:Debug-iphoneos/)
    ↓ xcrun simctl install booted /path/to/YourApp.app     (装到模拟器)
    ↓ ios-deploy -b -d <udid> /path/to/YourApp.ipa        (真机,需要 Apple Developer 证书)
📱 装到设备
```

### 3.3 自动化两条命令 (未来想做的)

```json
// package.json scripts,加这两条:
{
  "scripts": {
    "build:android": "tsc && vite build && cap sync android && cd android && ./gradlew assembleDebug",
    "build:ios":     "tsc && vite build && cap sync ios && cd ios && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator"
  }
}
```

---

## 4. 测试 + 验证通用方法

### 4.1 三处 hash 一致性检查 (适用任何平台)

不管是 Android APK 还是 iOS IPA,都是一个 zip:

```
源码编译 → 
  ① dist/ 里的 bundle               (hash-XYZ)
  ② 平台原生项目里被 cap sync 拷贝的   (hash-XYZ ← 应该和 ① 一样)
  ③ 打包后的应用包(APK/IPA)里的      (hash-XYZ ← 应该和 ② 一样)
```

验证 ③ 的方法:

**Android**:
```powershell
$apk = "app-debug.apk"
Copy-Item $apk "$env:TEMP\chk.zip"
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\ext" -Force
Get-ChildItem "$env:TEMP\ext\assets\public\assets\*.js" | Select Name
```

**iOS**:
```bash
# 解 IPA 是 zip
unzip -p YourApp.app/Frameworks/...   # 但 web 资源通常在 app bundle 里
# 或者 Xcode → Devices → Download Container → 查看
```

### 4.2 字符串 grep 验证

打进 bundle 后 `class`/`id`/`var` 都被 minify,但有些稳定字符串保留:
- 注释里的版本号（V28-fix, V25-fix 这类）
- 关键中文/常量（搜索框 placeholder 等）
- console.log 的字符串

如果 grep 找得到,代码确实进了 bundle。

### 4.3 远程调试移动 WebView

不管 Android 还是 iOS 都能连 Chrome DevTools:

```bash
# Android: 需先 adb forward
adb forward tcp:9222 localabstract:chrome_devtools_remote

# iOS:  
# Xcode → Window → Devices → 选设备 → 选 app → 点 Inspectors
# 或者: ios_webkit_debug_proxy -d <udid>
```

然后浏览器开 `chrome://inspect` 看 console 和 network。

---

## 5. 这次踩的 8 个具体坑 + 跨平台教训

### 坑 1:PowerShell 不认 `./gradlew` (Windows + npm scripts)

**症状**:
```
'.' 不是内部或外部命令
```

**教训**: npm scripts 里如果写 `./gradlew assembleDebug`,只在 bash 环境下能跑。

**修法 - 现在**:
- Windows: `.\gradlew.bat assembleDebug`
- Mac/Linux: `./gradlew assembleDebug`

**修法 - 未来 (跨平台 scripts)**:
```json
// package.json
"scripts": {
  "build:android:debug": "tsc && vite build && cap sync android && cd android && npm run gradle-debug"
}

// 加 cross-env + npm-run-all 让脚本可以平台无关:
// 或者用 capacitor 自己的命令: cap run android 直接处理构建+安装
```

**iOS 对应坑**: xcodebuild 命令可能因为 SDK 缺失而出错。先 `xcodebuild -showsdks` 验证 SDK 装了。

### 坑 2:服务端的 Send 命令看似返回 0 但实际失败

**症状**: 
- shell `runCmd('cc-connect', ['send', ...])` 返回 exit code 0
- cc-connect 实际没收到消息

**原因**: aliyun CLI 在覆盖文件时弹交互式确认,stdin 关了导致 silent skip + exit 0。

**教训**: **永远不信"看起来成功"的退出码,要验副作用**。

**修法 - watchdog**:
```js
// 不光看 exit code,要自己读 config + 验证
async directSwitchProvider(target) {
  // 1. 改 config
  // 2. restart cc-connect
  // 3. 读 config 回检查  ← 关键!验证不只是看 exit code
  // 4. status 检查进程
}
```

**跨平台启示**: iOS 上的 `xcodebuild` 也是类似,有时候 build 报告 SUCCESSFUL 但产物没生成。**永远 stat 一下产物文件**。

### 坑 3:tar --overwrite 在 Windows 不支持

**症状**: 
```
tar.exe: Option --overwrite is not supported
```

**修法 - 现在**: 先删目标再解压
```powershell
Remove-Item -Recurse -Force D:\target
tar -xzf archive.tar.gz -C D:\
```

**更好的修法**: 用 zip! PowerShell `Expand-Archive` 原生支持。Capacitor 项目不挑 zip 还是 tar,zip 更适合跨平台传输。

### 坑 4:bundle hash 看错了 → APK 是老的但 hash 是新的

**症状**: 
- 改了源码
- `npm run sync` 输出新 hash
- 但 APK 里 hash 没变 (老的)

**原因**: `npm run android:apk` = vite + cap sync + gradle。前面成功但 gradle 增量构建认为 android assets 没变 (实际上 vite 出新 hash 已经触发了 cap sync,可能没生效)。

**教训**: 三层 hash (dist, android assets, APK) 必须都验。

**修法**: 加验证步骤在 deploy 流程里:
```bash
expected_hash = ...
actual_hash = $(unzip -p app.apk assets/public/assets/*.js | sha256sum | cut -c1-7)
[ "$expected_hash" = "$actual_hash" ] || { echo "HASH MISMATCH"; exit 1; }
```

### 坑 5:`type="search"` × 清除按钮在 Android WebView 上不触发 @input

**症状**: 
- 用户点搜索框右上角的 × 清除
- 文件树不恢复(因为 onSearch 没被调)

**原因**: Android 不同 WebView 版本对 type="search" 的 × 事件触发不一致。MDN 说应该触发 @input,但实际行为各异。

**修法 - 这次**: 多绑事件兜底
```ts
@input=${...}
@search=${...}      // type="search" 专用
@change=${...}
@keyup=${...}
```

**iOS 上类似的问题**:
- WKWebView 里 `<input type="file">` 点击行为不一致
- WKWebView 里 `position: fixed` 弹层 + 滚动穿透问题
- select 弹层在 iOS PWA 上是 native picker,但事件可能不同

**跨平台教训**: **永远不假设 web API 在移动 WebView 上和桌面 Chrome 一致**。要测就要在真机/真模拟器上测。

### 坑 6:Light DOM (createRenderRoot → this) 在某些场景下属性绑定失效

**当前代码**:
```ts
protected createRenderRoot() { return this; }
```

**优势**: 没有 shadow DOM,样式继承,简单
**风险**: 某些情况下属性绑定 (@property) 检测不到?这次没踩,但 iOS WKWebView 可能有差异

**修法 - iOS 时**: 保留默认 (shadow DOM),把样式文件用 `:host` 限定。

### 坑 7:lit 表达式丢字符 (${} 里 `<` 会被解析)

**症状**: 之前的 debug 发现某些模板表达式不渲染

**修法**: 用 `unsafeHTML()` directive 而不是 `${}` 拼接,或者把数据用 `escape` 处理。

### 坑 8:JS 中的 Array reference 误用导致 filter "丢失"原数据

**症状 (V22 bug)**:
```ts
this.entries = this.entries.filter(...)  // ← 原引用丢了
// 用户清空搜索:
this.entries = this.entries  // ← 把过滤后的赋给自己
```

**教训**: **永远不要让一个字段"既是数据源又是展示结果"**。

**修法**:
```ts
@state() allEntries = [];        // 数据源(永不 mutate)
@state() searchTerm = '';        // 用户输入

render() {
  const entries = this.searchTerm
    ? this.allEntries.filter(x => x.path.includes(this.searchTerm))
    : this.allEntries;
  ...
}
```

**跨平台启示**: 这是所有 reactive 框架都适用的原则 (React useState / SwiftUI @State / Vue ref 都有类似坑)。

---

## 6. iOS 准备工作清单 (未来启动时直接照着做)

### 6.1 一次性环境准备

```bash
# 在 macOS 上

# 1. Xcode Command Line Tools
xcode-select --install

# 2. Xcode (从 App Store)
# 然后安装 iOS Simulator (Xcode 里)

# 3. CocoaPods
brew install cocoapods
# 或 sudo gem install cocoapods

# 4. ios-deploy (真机调试时用)
brew install ios-deploy

# 5. Node (从官网装 LTS)
# https://nodejs.org/

# 6. 验证
node -v
xcodebuild -version
pod --version
ios-deploy --version
```

### 6.2 Capacitor iOS 项目初始化

```bash
cd your-project
npm install

# 添加 iOS 平台(第一次)
npx cap add ios
# 创建 ios/ 目录,Podfile 等

# 装 iOS 依赖
cd ios && pod install && cd ..
```

### 6.3 配置 (capacitor.config.ts 已有,加 ios 段)

```ts
ios: {
  contentInset: 'automatic',  // iOS safe area
  backgroundColor: '#ffffff',
  // iOS 不像 Android 需要 allowMixedContent 那些
}
```

### 6.4 iOS build 命令

```bash
# Debug build (模拟器)
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath ios/build

# 模拟器装
xcrun simctl list devices booted  # 查 booted 模拟器的 UDID
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.example.app  # 启动 app

# Debug build (真机) - 需要 Apple Developer 账号 + 证书
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphoneos \
  -destination "platform=iOS,id=<device-udid>"

# 真机装
ios-deploy -b ios/build/Build/Products/Debug-iphoneos/App.app -d <udid>
```

### 6.5 iOS 特有的坑 (前置了解)

| 坑 | 描述 | 修法 |
|---|---|---|
| WKWebView 缓存 | 比 Android Chrome WebView 缓存更激进 | iOS wkwebview 加 cache busting 或 disable cache |
| 滚动穿透 | iOS 上 fixed 弹层滚动穿透到背景 | CSS `-webkit-overflow-scrolling: touch` + touchmove preventDefault |
| 安全区域 | iPhone 刘海/底部 home indicator | 设置 `viewport-fit=cover` + CSS `env(safe-area-inset-*)` |
| 文件上传 | iOS WKWebView 的 `<input type="file">` 行为 | Capacitor 有 `@capacitor/camera` 等原生插件 |
| 推送通知 | iOS APNS 需要证书 | 用 `cordova-plugin-push` 或 Capacitor 推插件 |
| 隐私权限 | iOS 14+ 隐私 manifest | 必须填 NSPrivacyAccessedAPIType |

---

## 7. 知识库 V22→V28 版本演进 (历史)

| 版本 | hash | 修复 | 教训 |
|---|---|---|---|
| V22 | DH4RPAG0 | bug: `this.entries = this.entries` 之后清空搜索丢全量 | 单一字段不能承担多职责 |
| V23 | DH4RPAG0 | 加了 fix 但**没 rebuild** | build 没真生效 = fix 没生效 |
| V24 | DP6OMa7Z | 真正 rebuild 后,`@input` 还是问题 | 修了但方向错 |
| V25 | B2sJAe2N | 重构 `displayEntries` 派生 getter | 派生属性不要存 state |
| V26 | z_-fCmOo | 多绑 `@search` `@change` `@keyup` | 跨平台:事件绑多兜底 |
| V27 | BjHQvznE | wikilink 模糊匹配 + 自动开侧栏 | 模糊匹配统一做法 + 复用搜索框 |
| V28 | JXfuig-5 | wikilink 解析 bug:删 line 40 错误拒绝 | 永远验证实际行为,逻辑和注释要对得上 |

V22 → V28 跨了 6 个版本,2 天时间。**如果一开始就按现在的认知写,可能一天就完成**。

---

## 8. 自检清单 (以后遇到类似问题直接用)

| 检查 | 方法 | 期望 |
|---|---|---|
| 三处 hash 一致 | dist/ + android assets + APK 里 grep | 全部一样 |
| 改了源码 = 改了 bundle | 改一行变量,vite hash 必变 | hash 变了 ✓ |
| 进 APK 了 | 解压 APK 看 JS bundle hash | 等于 step 2 的新 hash |
| 实际安装生效 | adb uninstall + 重装 | 卸载再装 ✓ |
| 跨平台事件兼容 | 多绑 @input/@change/@keyup | 都触发 ✓ |
| 派生属性不存 state | `get displayEntries()` 而不是 `@state displayEntries` | 不混 |
| watcher/sync 真生效 | 检查 state.json / config file mtime + 内容 | mtime 变且内容对 ✓ |

---

## 9. 一些资源链接 / 参考

- Capacitor iOS 文档: https://capacitorjs.com/docs/ios
- Lit 文档: https://lit.dev
- vite: https://vitejs.dev
- markdown-it wikilink plugin 范例: https://github.com/markdown-it/markdown-it
- iOS HIG: https://developer.apple.com/design/human-interface-guidelines/

---

文档位置: `/mnt/work/leoliao-app/PLATFORM-GUIDE.md`
最后更新: 2026-07-08
配套: `BUILD-GUIDE.md` (Android 详细步骤)
