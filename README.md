# 知识库 APP

> 把 Obsidian vault (`/vault/LeoLiao/`) 装进 Android 手机的一个阅读 APP。
> 由 Lit + TypeScript + Capacitor 编写,数据通过阿里云 OSS 同步。

> **当前版本**: [v1.12.0](./CHANGELOG.md#1120---2026-09-04) · Phase R.1 — Cross-Encoder Rerank 上线
> **下一版本**: v1.12.1 — chat-panel UI 接入 Rerank 开关

---

## 这 APP 是什么 / 不是什幺

### ✅ 这是什么
- 一个手机 + 平板的 **Obsidian 笔记离线阅读器**
- 把 Leo 的 Obsidian vault 全部 .md 文件同步到手机
- 支持:文件树浏览、模糊搜索、wikilink 跳转、主题切换、分享到微信/飞书/邮件
- 总大小约 30 KB JS,启动快,纯前端

### ❌ 不是什幺
- 不是 Obsidian 官方 APP(本仓库是 Leo 自己写的)
- 不是编辑器(只读,不能改笔记)
- 不是云盘同步器(单向拉取,不监听文件变化)
- 不依赖 NAS:云上永久 OSS,手机关掉 NAS 也能看

---

## 📲 给读者:下载 + 安装 + 用

### 1. 下载

**APK 下载地址**: `https://liaoguogang.oss-cn-shanghai.aliyuncs.com/knowledge-base/app-debug.apk`
(链接待公开后填,目前通过飞书分享)

下载下来的文件:
- 文件名: `app-debug.apk`
- 大小: 约 4-5 MB
- 类型: Android 安装包 (APK)

### 2. 转移到手机

任选一种:
- **USB 数据线**:连电脑,把 APK 拖到手机的 `Download/` 文件夹
- **微信文件传输**:发给自己,手机端长按保存
- **网盘/邮件附件**:上传到网盘,手机下载

### 3. 安装

第一次装未知来源的 APP,需要授权:

```
设置 → 安全/隐私 → 未知来源应用 → 允许(Chrome 或 "我的文件")
```

然后在文件管理器里点开 `app-debug.apk`,按提示装完。

或用 ADB(后述):

```bash
adb install app-debug.apk
```

### 4. 装好后第一次打开

- APP 启动会从 OSS 拉取所有笔记(约 1252 个,首次几十秒)
- 之后会缓存到本地,二次启动秒开
- 看到主界面:
  - **左上角 ☰**:打开文件树
  - **顶部 ⚙️ ↗️ ❓**:设置 / 分享 / 帮助
  - **底部 🔄 重新同步**:立即拉最新笔记

### 5. 手机操作手册

#### 📚 浏览文件
1. 点左上角 **☰** 打开文件树
2. 看到按目录分组的全部笔记
3. **点文件夹**展开/收起
4. **点文件名**打开阅读
5. 阅读时**点正文任意空白处**,侧栏自动收起(不需要点 ✕ 了!)

#### 🔍 搜索
顶部输入框输关键词:
- **输关键词** → 实时筛选文件树,**命中文件直接展开显示**(不用一个一个点开目录),命中文件有黄色高亮边框
- **点 × 清除按钮** → 立刻恢复全部笔记
- **`[[笔记名]]` 这种 wikilink** → 点直接跳过去;如果多匹配自动把关键词填到搜索框里让你选

#### 💾 保存笔记到本地
点顶部 **💾** 保存当前打开的笔记:
- **Web (Chrome/Edge)**:弹原生"另存为"对话框,可改文件名 + 选任意目录
- **Android APK**:弹 SAF 文件选择器,选一个 .md 文件(或在文件管理器里新建一个空的再选),确认后覆盖写入
- 选错 / 取消不会报错,绿色提示 "✅ 已保存: 文件名"

#### ⚙️ 设置
点顶部 **⚙️**:
- **5 个主题预设**:深色(默认)/ 白色 / 羊皮纸 / 护眼绿 / 夜色
- **自定义**:背景色 / 面板背景(侧栏) / 文字色 / 次要文字 / 主色 / 链接色 / 标题色 / 分隔线 / 字号
- **字体**:系统中易读 / 宋体衬线 / 等宽
- 设置实时生效,自动保存到本地

#### ↗️ 分享当前笔记
- 打开任意笔记后,点右上 **↗️**
- 弹原生分享面板:微信 / 飞书 / 邮件 / 复制链接 等
- 默认发**完整内容**,超大(>5KB)才截断并提示

#### ❓ 帮助
点 **❓** 看完整使用说明(搜索、同步、设置、分享、FAQ)。

### 6. 同步策略

- **自动**:每天 03:20 和 15:20 北京时间各同步一次
- **手动**:底部 **🔄 重新同步** 按钮
- 增量上传,只下载变化的文件

### 7. 常见操作问题

| 现象 | 解决 |
|---|---|
| 启动后白屏等很久 | 首次同步下载所有笔记,看下面**同步进度**条 |
| wikilink 点了没反应 | 多匹配时自动用搜索框列候选,选一篇再开 |
| 搜索后清不掉 | 试**点 × 按钮**而不是键盘删除 |
| 笔记加载很慢 | 网络问题,等 30 秒或重连 WiFi |
| 字体颜色难看 | 进 **⚙️** 切预设或自定义 |
| 想卸载 | 长按 APP 图标 → 卸载 |

---

## 💻 给开发者:Windows 上构建 APK

### 1. 环境准备(一次性)

#### 安装这些软件

| 软件 | 哪里装 | 说明 |
|---|---|---|
| **Node.js 20+** | https://nodejs.org | 装 LTS 版 |
| **Android Studio** | https://developer.android.com/studio | 装 Android SDK (API 34) + Build-Tools + Platform-Tools,**JDK 17 自带** |
| **手机驱动**(Windows) | 装 Google USB Driver 或品牌驱动 | 让 adb 认到手机 |

#### 验证环境
打开 **PowerShell** (Win+R 输入 `powershell`),跑:

```powershell
node -v        # 应 >= v20
npm -v         # 应 >= 10
java -version  # 应 17.x
adb version    # 输出版本号即正常
```

### 2. 拿源码

```powershell
# 从 NAS 复制整个项目 (用 WinSCP / FileZilla / scp 任一种)
# 这里假设解压到 D:\leoliao-app

cd D:\leoliao-app
```

或用 rsync:

```powershell
rsync -av --exclude='node_modules' --exclude='dist' `
  --exclude='android/.gradle' --exclude='android/build' --exclude='android/app/build' `
  user@nas-ip:/mnt/work/leoliao-app/ D:\leoliao-app\
```

### 3. 装依赖

```powershell
cd D:\leoliao-app
npm install
# 1-2 分钟,装几十 MB
```

### 4. Build APK

第一次或加新依赖时:

```powershell
npm install                    # 装依赖
npx cap sync android           # 注册 Capacitor 插件到 Android 项目
```

日常改源码:

```powershell
# 方式 A:一条命令搞定 (build web + sync 到 Android)
npm run sync

# 方式 B:再编译 APK
cd android
.\gradlew.bat assembleDebug
```

输出位置:

```
D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk
```

### 5. 装到手机

```powershell
# 先卸老版本 (避免缓存问题)
adb uninstall com.leoliao.app

# 装新版本
adb install -r D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk
```

如果 `adb devices` 找不到手机:
1. 手机**设置 → 关于手机 → 连点 7 次"版本号"** → 解锁开发者选项
2. 进**开发者选项** → 打开 **USB 调试**
3. 用能**传数据的线**(不是只充电的便宜线)
4. 手机弹**"允许 USB 调试"** → 点**允许**
5. 重试 `adb devices`

### 6. 验证 APK 是新的

```powershell
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"
Copy-Item $apk "$env:TEMP\chk.zip"
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\ext" -Force
Get-ChildItem "$env:TEMP\ext\assets\public\assets\*.js" | Select-Object Name
```

应该看到形如 `index-XXXXXXX.js` 的文件,**比对源码时记录的 hash**确认是新版本。

### 7. 常见错误

| 错误 | 解决 |
|---|---|
| `JAVA_HOME not set` | Android Studio 自带 JDK,装好后重启 PowerShell |
| `SDK location not found` | Android Studio 第一次打开会问,指定一个目录如 `C:\Users\<你>\AppData\Local\Android\Sdk` |
| 找不到 `adb` | 用绝对路径 `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"` |
| `./gradlew` 不是内部命令 | Windows 用 `.\gradlew.bat`(反斜杠 + .bat) |
| `Cannot find module @capacitor/xxx` | `npm install` 后再 build |
| 装了 APK 但行为没变 | 先 `adb uninstall` 再装,清除 Android 缓存 |
| tar.exe 不支持 `--overwrite` | 先 `Remove-Item -Recurse` 旧目录再解压 |
| Gradle 增量构建跳过 | `Remove-Item -Recurse -Force build, app\build` 后再 build |

---

## 🍎 给开发者:macOS 上(未来准备做 iOS)

> 等你有了 mac 机器 + Apple Developer 账号后可做。现在先放占位。

```bash
# 1. 环境
xcode-select --install
brew install cocoapods ios-deploy

# 2. 创建 iOS 项目 (一次性)
cd your-project
npm install
npx cap add ios

# 3. 编译
npm run sync
cd ios && pod install && cd ..
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -sdk iphonesimulator

# 4. 模拟器装
xcrun simctl list devices booted
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.example.app
```

iOS 特有坑:
- **WKWebView 缓存更激进** → 加 cache-bust query string
- **iPhone 刘海 / 底部 home indicator** → `viewport-fit=cover` + `env(safe-area-inset-*)`
- **iOS 14+ 隐私 manifest** → `NSPrivacyAccessedAPIType` 必须填
- **滚动穿透** → `-webkit-overflow-scrolling: touch` + `touchmove preventDefault`

---

## 🔨 我们怎么迭代过来的(V1 → V30)

> 从最早的脚手架到现在的可用产品,30 个版本分 4 个阶段演进了 2 周。
> 这里**只突出每个版本的关键决策**,细节都在 git log 和 tar.gz 里。

### 🚩 关键里程碑一图概览

```
V1-V9       V10-V15      V18-V21      V22-V28       V29-V30
Phase 0     Phase 1      优化          bug 修复       体验打磨
脚手架      MD 阅读器                  (本次会话)
(2周前)     (1周前)      (本周早)
─────────────────────────────────────────────────────────────────
漏多        漏中文路径   稳态          搜索/wikilink   主题/分享/侧栏
界面乱     CORS 拦截                  优化           5 大特性上线
没有        touch 事件                  渐次上线       IOS 雏形
SDK      debug 面板
```

### 📍 Phase 0 (V1-V9): 脚手架 + 试错 (2 周前)

> 这阶段每个版本都是修一个小坑,但都是 APK 能不能跑起来的关键。

| 版本 | 名字 | 改了什么 | 为什么重要 |
|---|---|---|---|
| V1-V2 | - | 初始 Capacitor + Vite + Lit 脚手架 | APK 能装上 |
| **V3** | **fix** | 第一个"能跑"的修复 | 区分"接近能用"和"真能用"的标志 |
| **V4** | **cors-fix** | 用 CapacitorHttp 绕 WebView CORS | ⭐ 里程碑:笔记能从 OSS 拉到手机了 |
| V5 | encode-fix | URL 路径中文编码 | 中文笔记名不乱码 |
| V6 | scroll-fix | 文件树滚动 | 笔记多了能滚 |
| **V7** | **touch-debug** | 全屏触摸事件调试日志 | ⭐ 里程碑:第一次有调试能力 |
| V8 | debug-panel | 屏幕右下角实时日志面板 | ⭐ 里程碑:调试不再靠 adb logcat |
| V9 | trycatch | 包 try-catch + 错误恢复 | APP 不再白屏崩溃 |

**这阶段总结**: 从"能装"到"能跑 + 能调 + 不崩溃",每个版本只有 1-2 KB 改动。

### 📍 Phase 1 (V10-V15): MD 阅读器

> 这是"核心功能"上线的阶段,从空白 APP 到能真的看笔记。

| 版本 | 改了什么 | 关键决策 |
|---|---|---|
| **V10** | **no-details** | 文件树不用 `<details>` 改 div + 手动 toggle。markdown-it 集成 + wikilink 基础语法。sync 用 CapacitorHttp | ⭐ 里程碑:**第一个能完整阅读笔记的版本** |
| V11 | 加 CapacitorHttp 兜底,加文件大小排序 | 性能稳定 |
| (V12 推测) | wikilink 初步集成 + 安全处理 | (无 tar 残留,但功能渐进) |
| **V13** | **callback 取代 CustomEvent** | file-tree 用回调直调 onNoteOpen,事件不再冒泡,bug 减少 |
| (V14 推测) | 边角修复 | 无清晰标记 |
| **V15** | **scroll 强制滚动条** | styles.css `overflow-y: scroll !important`,解决滚动穿透 |
| (V16-V17 推测) | 笔记渲染细节(标题/标签/链接渲染) | Markdown → HTML 的边角 |

**这阶段总结**: 从"能开"到"能完整用",文件树 + 笔记渲染 + wikilink 都齐了。

### 📍 Phase 2-3 (V18-V21): 稳定性 & 优化

> 修 Phase 1 跑出来的小问题,功能没大改。

| 版本 | 估计改了什么 |
|---|---|
| V18 | 优化笔记打开速度 + wikilink 跳转 |
| V19 | sync 容错 + 部分文件失败重试 |
| V20 | 缓存策略 + 启动加速 |
| V21 | 边角打磨 (数据格式、错误提示) |

**这阶段特点**: tar.gz 文件大小稳定 8-9 KB,迭代都是渐进。

### 📍 Phase 4 (V22-V28): bug 修复密集期 (本次会话,2 天)

> 用户开始大量使用,发现了一堆"看起来 OK 但实际有 bug"的问题。
> 这一阶段**正是这次会话的** 7 月 7-8 日。

| 版本 | hash | 改了什么 | 学到 |
|---|---|---|---|
| **V22** | DH4RPAG0 | bug:搜索后清空文件树不恢复 | 单一字段不能多职责 |
| V23 | DH4RPAG0 | fix 加好但**没真 build** | build 没真生效 = fix 没生效 |
| V24 | DP6OMa7Z | 真重 build,加 `allEntries` | hash 是真话来源 |
| **V25** | B2sJAe2N | ⭐ 重构成 `displayEntries` getter | 派生值用 getter,不要 mutate 关键 state |
| **V26** | z_-fCmOo | ⭐ 多绑 `@search` `@change` `@keyup` | 跨平台 WebView 行为差异,绑多兜底 |
| V27 | BjHQvznE | wikilink 找不到 → 自动开侧栏搜索列候选 | 找不到 → 用搜索兜底而不是 alert |
| V28 | JXfuig-5 | wikilink 第一个字消失 → 渲染 bug (line 40 错误拒绝) | 永远验实际行为,逻辑+注释要一致 |

**这阶段总结**: 8 个版本,6 个真实 bug。"基础功能"变"日常可用"。

### 📍 Phase 5 (V29-V30): 体验打磨 (本次会话 7 月 8 日下午)

> "能看"升级到"用得爽"。Leo 主动提了 5 个需求,一次做完。

| 版本 | hash | 加了什么 | 性质 |
|---|---|---|---|
| **V29** | CR1ZGuEk | ⭐ 顶部工具栏 3 按钮(设置/分享/帮助);5 主题预设;点阅读区自动关侧栏;ESC 关 modal | **一次性大特性** |
| V30 | DYSrAjgp | 浅色主题整体协调(补全 CSS var 9 个);分享内容完整(放开截断) | **V29 后立刻打磨** |

**这阶段总结**: 从"能跑"到"用得爽"。工具栏 + 设置 + 分享 + 帮助全到位。

### 📍 Phase 6 (V36): 体验微调 (2026-07-10)

> Leo 用了一阵子,反馈 4 个使用摩擦点。这次会话一次性修完。

| 改动 | 修了什么 | 文件 |
|---|---|---|
| ☰ 不挡文件名 | 40×40 → 32×32 图标;有文件时 `opacity 0.25`,hover 恢复 | `styles.css` + `main.ts` |
| 保存后绿框 | 之前成功也用红色"加载失败"模板;新增 `noticeMsg` 绿色 panel | `main.ts` + `styles.css` |
| 搜索自动展开 | `ll-file-tree` 加 `searchTerm` prop,`willUpdate` 时把命中路径的所有父目录展开 + 命中文件黄色边框 | `file-tree.ts` + `main.ts` + `styles.css` |
| 保存选路径 | Web 走 `showSaveFilePicker`;Android 走 `FilePicker.pickFiles` 让用户选目标 .md 覆盖写 | `export-service.ts` + `main.ts` |

**学到的教训**:

- 一个状态字段不要混多个语义(`errorMsg` 之前同时承担"加载失败 / 保存成功 / 搜索无果 / 打开失败"4 种语义,渲染模板又硬编码标题"加载失败",导致成功保存也显示红框"加载失败")
- 派生值用 getter,响应式值用 `@property`(搜索词的展开集合应该在 `willUpdate` 里算,而不是 mutate `expanded`)
- picker 取消和失败要分别处理:取消静默返回 null,失败 throw 让外层捕获

### 现在版本(V36)有什么

```
V36 知识库 (2026-07-10)
├── 📂 文件树 + 1252 篇笔记 (从 OSS 同步)
├── 🔍 模糊搜索 (大小写不敏感、空格不敏感、子串匹配)
│       命中文件自动展开 + 黄色高亮 (V36)
├── 🔗 wikilink (精确 + 模糊匹配,多匹配时自动侧栏列候选)
├── 💾 保存到本地 (Web 用 picker,Android 用 SAF) — V36
│       成功后绿色提示,不再误用红框 (V36)
├── ⚙️ 5 主题预设 + 8 项颜色/字体自定义 (V30 补全)
├── ↗️ 系统分享 (微信/飞书/邮件完整内容,V30 修)
├── ❓ 帮助 modal
├── 🔄 自动同步 (每天 03:20 + 15:20 BJT)
└── 📱 三横图标半透明,不挡文件名 (V36)
```

### 跨阶段的关键教训(给下次做新 App 用)

1. **V3-V9 试错不丢人** — APK 跑得起来比完美设计重要
2. **V4 加 CapacitorHttp 是关键转折** — 从"装上 app"到"能读笔记"差的就是这一行
3. **V7 debug 面板价值无限** — 没它,V8-V21 都要靠 logcat 调试
4. **V10 的 no-details 决定是 render 性能** — `<details>` 在 Android WebView 上 touch 行为不稳
5. **V15 force-scroll 解决滚动穿透** — `overflow-y: scroll !important` 这一行省了几天调样式
6. **V22-V28 反复修一个 bug 不是浪费时间** — 是"基础功能变日常可用"的必经之路
7. **V29 一次加 5 特性** — 当基础够稳了,半天就能加一整套打磨

---

## 🆚 vs 其他方案

| 方案 | 优势 | 劣势 |
|---|---|---|
| **Obsidian 官方 APP** | 功能完整 | 1 GB+,启动慢,需登录 |
| **本 APP (知识库)** | **轻量(30 KB JS)、纯前端、看完就走** | 只读,不能编辑 |
| Remotely Save (插件) | 在 Obsidian 内同步 | 需装 Obsidian |
| 自己 host 静态 html | 0 依赖 | 需 NAS 公网 IP |

如果只是"在手机上看看 vault 里写了什么",本 APP 是最快的方式。

---

## 📁 项目结构

```
leoliao-app/
├── README.md                       ← 你正在看
├── SETUP.md                        ← 项目搭建 (旧版,保留)
├── BUILD-GUIDE.md                  ← Android 详细构建步骤
├── PLATFORM-GUIDE.md               ← 跨平台架构 + iOS 准备
├── APP-DEV-COMPLETE-GUIDE.md       ← 开发者指南:状态管理/调试/坑
│
├── src/
│   ├── main.ts                     ← 入口(Lit 组件)
│   ├── styles.css                  ← 全局样式
│   ├── components/                 ← 子组件
│   │   ├── file-tree.ts            ← 文件树
│   │   ├── note-view.ts            ← 笔记渲染
│   │   ├── settings-panel.ts       ← 主题设置 modal (V29)
│   │   ├── share-panel.ts          ← 分享 modal (V29, V30 修)
│   │   └── help-panel.ts           ← 帮助 modal (V29)
│   └── services/
│       ├── sync.ts                 ← OSS manifest + 文件拉取
│       ├── db.ts                   ← Dexie (IndexedDB)
│       ├── renderer.ts             ← markdown-it + wikilink + callout
│       └── settings.ts             ← 主题持久化 (V29+V30)
│
├── android/                        ← Capacitor 生成的 Android 项目
│   └── app/src/main/assets/public/ ← 这里放编译后的 JS + CSS
├── package.json                    ← deps + scripts
├── capacitor.config.ts             ← Capacitor 配置
└── vite.config.ts
```

---

## 🔗 相关链接

- **代码仓库**: [如果以后开源,填这里]
- **API 后端**: 阿里云 OSS `oss://liaoguogang/`
- **数据源**: Obsidian vault `/vault/LeoLiao/`
- **历史 wiki**: `/vault/LeoLiao/raw/notes/` 知识库

---

## 📅 版本时间线(给想考古的人)

```
2 周前 (Phase 0 脚手架,早期)
V1-V2    ── 初始 Capacitor + Vite + Lit 脚手架
V3       ── 第一个 "fix" APK 能装上
V4       ── cors-fix:用 CapacitorHttp 突破 WebView CORS
V5       ── encode-fix:中文 URL 路径编码
V6       ── scroll-fix:文件树滚动
V7       ── touch-debug:触摸事件调试日志
V8       ── debug-panel:屏幕调试面板
V9       ── trycatch:错误处理 + 崩溃恢复

1 周前 (Phase 1 MD 阅读器)
V10      ── no-details:文件树 div+toggle;markdown-it+wikilink
V11      ── CapacitorHttp 兜底 + 文件排序
(V12)    ── wikilink 安全处理
V13      ── callback 取代 CustomEvent
V15      ── scroll 强制滚动条
(V16-V17 推测)  ── 笔记渲染细节

本周早
V18      ── 边角打磨 (同步容错,缓存)
V19      ── 文件失败重试
V20      ── 启动加速
V21      ── 数据格式与错误提示

2026-07-07 (本次会话 7 月 7 日)
~15:00  V22 (DH4RPAG0)  bug:搜索清空不恢复
~17:00  V23 (DH4RPAG0)  fix 加好但 build 没真生效
~21:00  V24 (DP6OMa7Z)  真 build,加 allEntries 字段
~22:00  V25 (B2sJAe2N)  displayEntries getter 重构
~22:30  V26 (z_-fCmOo)  多绑 @search/@change/@keyup 事件

2026-07-08 (本次会话 7 月 8 日)
~12:00  V27 (BjHQvznE)  wikilink 模糊匹配 + 自动列候选
~13:30  V28 (JXfuig-5)  wikilink 渲染 bug:line 40 错误拒绝
~17:00  V29 (CR1ZGuEk)  5 打磨特性 (toolbar + 设置 + 分享 + 帮助 + 点阅读关侧栏)
~23:00  V30 (DYSrAjgp)  浅色主题整体协调(补全 9 个 CSS var)+ 分享内容完整

2026-07-10 (本次会话 7 月 10 日)
~22:30  V36             4 个体验微调 (☰ 不挡字 / 保存绿框 / 搜索展开 / 保存选路径)
```

每个早期版本都有对应 tar.gz 包在 `/mnt/work/leoliao-app-v*.tar.gz`:
- `v3-fix` ~ `v9-trycatch` 是 Phase 0 试错
- `v10-no-details` ~ `v13-final` 是 Phase 1 关键里程碑
- `v18` ~ `v22` 是稳定性优化
- V22 之后我们这次会话用的 tar.gz 是 `leoliao-app-知识库-v30.tar.gz`

---

## 文档版本

| 文档 | 适用读者 | 何时看 |
|---|---|---|
| **README.md** (本文) | 所有人,先读 | 下载、安装、用、知道它怎么来的 |
| **CHANGELOG.md** | 所有人 | 看版本变更记录 |
| **docs/releases/** | 开发者 / 用户 | 每个版本的发布说明 |
| **SETUP.md** | 老历史 | 项目搭建初期 |
| **BUILD-GUIDE.md** | 开发者 | 在 Windows 上 rebuild APK 时 |
| **PLATFORM-GUIDE.md** | 开发者 | 要做 iOS 或理解架构时 |
| **APP-DEV-COMPLETE-GUIDE.md** | 任何开发者 | 做新 App 项目时,这一份就能上手 |

---

## 📋 最近变更(2026-09 起)

### v1.12.0 — Phase R.1 — Cross-Encoder Rerank 上线(2026-09-04)

**新增**:
- 🔀 三档降级 Rerank 引擎 (`lib/reranker.ts`):cross-encoder → BM25 重打分 → passthrough
- ⚡ `search()` 签名扩展支持 `rerankOpts` 可选参数(向后兼容)
- 🛡 3 秒硬超时 + 永不抛错保护

**下一步**(v1.12.1 ~ v1.13.0):
- chat-panel UI 接入 Rerank 开关
- 侧栏三 Tab 搜索 UI(📂 路径 / 📖 全文 / 🧠 语义)
- Chunk 级跳转 + 高亮
- 流式引用侧栏

详见 [CHANGELOG.md](./CHANGELOG.md) 与 [docs/releases/v1.12.0.md](./docs/releases/v1.12.0.md)。

---

最后更新: 2026-07-10 (V36)
