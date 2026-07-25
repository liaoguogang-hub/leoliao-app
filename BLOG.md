# 30 个版本,2 周时间:我从零开始做了个 30KB 的 Obsidian 知识库 APP

> **TL;DR**: 我用 Capacitor + Lit + TypeScript + 阿里云 OSS,做了个 30KB 的 Android 离线知识库阅读器。从 V1 脚手架到 V30 完整应用,迭代了 30 个版本。这篇文章讲完整的过程:技术选型、环境搭建、30 个版本的演进故事、26 个踩过的坑、iOS 怎么迁移。读完之后你应该能自己 fork 出来做一个。

---

## 这篇文章里有什么

- **第一章** 我为什么要做这个(以及不适合什么场景)
- **第二章** 技术栈选型:为什么 Capacitor + Lit + OSS
- **第三章** 三层架构:源码 → 编译产物 → 安装包
- **第四章** 环境搭建:Node + Android Studio + 手机,Mac/Windows 都讲
- **第五章** 30 个版本完整迭代故事(V1→V30,5 个 Phase,关键里程碑)
- **第六章** 26 个踩过的坑(按类别)
- **第七章** 怎么部署 + 自动同步
- **第八章** iOS 怎么迁移(有完整 xcodebuild 命令)
- **第九章** 推荐技术栈 + 写新 App 时的检查清单
- **第十章** 这些文档怎么用

---

## 第一章:为什么做这个 APP

我每天用 Obsidian 记笔记,vault 现在有 1248 个 .md 文件,共 30+ MB。
但每次想在手机上查东西,都要:

- 打开 Obsidian APP(它 1GB+,启动 5 秒)
- 等它同步(网速慢时 30 秒+)
- 找半天才能定位到笔记
- 看完了不一定记得关 APP,后台耗电

**我希望**:点开一个图标,1 秒内看笔记。看完就走。不需要的功能(编辑、同步冲突解决、富文本)统统不要。

**结果**:30 KB JS bundle。启动 200ms。看一篇笔记 0 延迟。

---

📷 **[图 1:APP 在手机上的样子 — 主阅读界面、文件树、设置 modal、分享面板,4 张截图拼图]**

---

## 第二章:技术栈选型

我做这个之前,有几个根本问题要回答:

| 问题 | 选项 | 我的选择 | 为什么 |
|---|---|---|---|
| 跨平台还是单端? | Android-only / iOS-only / 跨平台 | **跨平台** | 写一次,Android 现在用,以后想给 iPhone 也用 |
| 用什么 web 框架? | React / Vue / Lit | **Lit** | 30KB 实现,web components 标准化,少就是好 |
| 怎么跟 Android 集成? | React Native / Flutter / **Capacitor** | **Capacitor** | 不学新语言,直接用我已经会的 web 技术 |
| 数据放哪? | NAS 直接读 / 自建 API / OSS | **OSS** | 公网高速、便宜(NAS 有公网 IP 问题) |
| 本地缓存? | 不用 / IndexedDB / SQLite | **IndexedDB via Dexie** | 大对象存 JS 直接查,不用迁移 |
| markdown 渲染? | 自己写 / remark / **markdown-it** | **markdown-it** | 成熟的 AST + 插件生态,wikilink 自己加 rule |

### 为什么 Lit 比 React 更适合这里

| | Lit | React |
|---|---|---|
| Bundle | **3-15 KB** | 40 KB |
| API | Web Standards (lit-html) | 自有 JSX/Virtual DOM |
| 学习曲线 | **看官方文档 1 小时** | 1 天 |
| 反应式 | 标准 `@property` / `@state` 装饰器 | useState / useReducer |

我做这个项目就花了 10 分钟上手 Lit。如果用 React,光是 useEffect 依赖数组就要 debug 一遍。

### 为什么 Capacitor

📷 **[图 2:Capacitor 工作原理 — WebView 装 web 资源,native 桥访问原生能力(Share/Camera/Filesystem)]**

Capacitor 把 web 资源(`dist/`)打包到 Android 项目里,运行时在原生 WebView 里加载。我不需要学 Kotlin 就能写 APP 也能调原生 API(分享/通知/相机)。

---

## 第三章:三层架构

📷 **[图 3:三层架构图 — 源码层 / 编译产物层 / 安装包层,从 src 到 APK 的数据流]**

```
┌────────────────────────────────────────────────────┐
│ 源码层 (开发时编辑)                                   │
│   src/main.ts                                       │
│   src/components/file-tree.ts                       │
│   capacitor.config.ts                                │
└────────────────────────────────────────────────────┘
                ↓ npm run build (tsc + vite)
┌────────────────────────────────────────────────────┐
│ 编译产物层 (dist/)                                  │
│   dist/assets/index-XXXXXXX.js  ← 内容 hash 命名    │
│   dist/index.html                                   │
└────────────────────────────────────────────────────┘
                ↓ cap sync android
┌────────────────────────────────────────────────────┐
│ Android 项目层                                       │
│   android/app/src/main/assets/public/index-XXXX.js  │
│   (Capacitor 把 dist 拷过来)                          │
└────────────────────────────────────────────────────┘
                ↓ ./gradlew assembleDebug
┌────────────────────────────────────────────────────┐
│ 安装包层 (APK)                                      │
│   android/app/build/outputs/apk/debug/app-debug.apk │
└────────────────────────────────────────────────────┘
```

**最关键的认知:三处 hash 必须一致**。我在 V23/V24 栽过跟头——改了源码,vite dist hash 没变(忘了 build),APK 是老的。详见第六章坑 #6 #7 #8。

---

## 第四章:环境搭建

### 4.1 准备工作清单

📷 **[图 4:Android Studio 首次安装截图 — 选 Standard、安装路径、SDK 34]**

| 软件 | 来源 | 验证命令 |
|---|---|---|
| **Node.js 20+** | https://nodejs.org | `node -v` |
| **Android Studio** | https://developer.android.com/studio | `adb version` |
| **JDK 17** | Android Studio 自带 | `java -version` |
| **手机驱动** (Windows) | Google USB Driver 或品牌驱动 | `adb devices` 看到手机 |

### 4.2 拿源码

```bash
# 从你的笔记仓库 fork 或者直接拷贝
# Mac/Linux
scp -r user@nas:/mnt/work/leoliao-app ~/leoliao-app

# Windows 用 WinSCP / FileZilla / 资源管理器拖
```

或者从 GitHub clone(以后开源):
```bash
git clone https://github.com/你的用户名/leoliao-app.git
```

### 4.3 装依赖

```bash
cd ~/leoliao-app     # 或 D:\leoliao-app
npm install
# → 1-2 分钟,装几十 MB
```

### 4.4 浏览器先看效果(免编译)

```bash
npm run dev
# → http://localhost:5173
# → 应看到 📚 知识库 启动页
# → 浏览器 DevTools Console 看到 [知识库] Platform: web Native: false
```

📷 **[图 5:浏览器跑出的样子 — 文件树 + 笔记 + 搜索框]**

这一步通了说明基础链路 OK。

### 4.5 第一次同步 web → Android 资源

```bash
npm run build         # tsc + vite build → dist/
npx cap sync android  # dist/ 复制到 android/app/src/main/assets/public/
```

### 4.6 第一次 build APK(Windows 用 IDE / 命令行两种)

#### 方式 A:Android Studio(新手推荐)

```powershell
npx cap open android   # 自动打开 Android Studio
```

📷 **[图 6:Android Studio 打开后的界面 — 左侧文件树、Gradle sync 进度条、右下角 Run 按钮]**

第一次打开会:
- 下载 Gradle(~100 MB)
- 下载 Android SDK 依赖(~500 MB)
- 这个过程 **5-15 分钟**(看网速)

手机 USB 连上电脑 + 开 USB 调试(设置 → 开发者选项),点 ▶ Run。

#### 方式 B:命令行(常用)

```powershell
cd android
.\gradlew.bat assembleDebug
# → android\app\build\outputs\apk\debug\app-debug.apk
```

⚠️ **Windows 上必须是 `.\gradlew.bat`,不是 `./gradlew`**。PowerShell 不认 `./`。

### 4.7 装到手机

```powershell
# 先卸老版本 (避免应用签名缓存)
adb uninstall com.leoliao.app

# 装新版本
adb install -r D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk
```

如果 `adb devices` 找不到手机:① 设开发者选项 ② USB 调试开着 ③ 用能**传数据**的线 ④ 手机弹"允许 USB 调试"要按允许。

📷 **[图 7:首次 adb devices 找不到手机的排查链 — USB 调试 / 数据线 / 弹窗允许 / Google USB Driver]**

### 4.8 验证装上的是新版

```powershell
$apk = "D:\leoliao-app\android\app\build\outputs\apk\debug\app-debug.apk"
Copy-Item $apk "$env:TEMP\chk.zip"
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\ext" -Force
Get-ChildItem "$env:TEMP\ext\assets\public\assets\*.js" | Select-Object Name
```

你应该看到一个 `index-XXXXXX.js` 的文件。**比对源码 commit 时记的 hash**,确认是新版本。

---

## 第五章:30 个版本的故事(V1→V30)

> 这一章是全文核心。从最初的脚手架到现在的可用产品,30 个版本分 5 个 Phase,2 周时间。

### 一图概览

```
V1-V9       V10-V15      V18-V21      V22-V28       V29-V30
Phase 0     Phase 1      Phase 2-3     Phase 4       Phase 5
脚手架      MD 阅读器    稳定性优化  bug 修复      体验打磨
(2 周前)    (1 周前)     (本周早)    (本次会话)    (本次会话)
─────────────────────────────────────────────────────────────────
APK 能装    能完整阅读   性能稳       搜到/wikilink 主题/分享/侧栏
           笔记                                5 大特性上线
```

### Phase 0 (V1-V9):脚手架 + 试错(2 周前)

> 这阶段每个版本都是修一个小坑,但每一个都是 APK 能不能跑起来的关键。

📷 **[图 8:V3-V9 的 tar 包大小变化——每个版本只增 1-2 KB,但都是关键 fix]**

| 版本 | 名字 | 改了什么 | 为什么重要 |
|---|---|---|---|
| V1-V2 | - | 初始 Capacitor + Vite + Lit 脚手架 | APK 能装上 |
| **V3** | **fix** | 第一个"能跑"的修复 | 区分"接近能用"和"真能用" |
| **V4** | **cors-fix** | ⭐ 用 CapacitorHttp 绕 WebView CORS | **笔记能从 OSS 拉到手机了** |
| V5 | encode-fix | URL 路径中文编码 | 中文笔记名不乱码 |
| V6 | scroll-fix | 文件树滚动 | 笔记多了能滚 |
| **V7** | **touch-debug** | 全屏触摸事件调试日志 | ⭐ **有了调试能力** |
| V8 | debug-panel | 屏幕右下角实时日志面板 | ⭐ **不再依赖 adb logcat** |
| V9 | trycatch | 包 try-catch + 错误恢复 | APP 不白屏崩溃 |

**V3-V9 阶段总结**: 从"能装"到"能跑 + 能调 + 不崩溃",每个版本 1-2 KB。

📷 **[图 9:V8 调试面板截图 — 屏幕右下角小窗,显示触摸事件和 console log]**

### Phase 1 (V10-V15):MD 阅读器(1 周前)

> "核心功能"上线。从空白 APP 到能真的看笔记。

| 版本 | 改了什么 | 关键决策 |
|---|---|---|
| **V10** | **no-details** | ⭐ 文件树不用 `<details>` 改 div + 手动 toggle。markdown-it 集成 + wikilink 基础语法。sync 用 CapacitorHttp | ⭐ **第一个能完整阅读笔记的版本** |
| V11 | 加 CapacitorHttp 兜底,加文件大小排序 | 性能稳定 |
| **V13** | **callback** | ⭐ file-tree 用回调直调 onNoteOpen,事件不再冒泡,bug 减少 |
| **V15** | **scroll 强制滚动条** | styles.css `overflow-y: scroll !important`,解决滚动穿透 |

📷 **[图 10:V10 第一版能看笔记的截图 — 文件树 + markdown 渲染 + wikilink]**

### Phase 2-3 (V18-V21):稳定性优化(本周早)

性能/同步容错/缓存优化,这个阶段增量小,每个版本 tar 包稳定 8-9 KB。这阶段没什么截图,因为看不出来改了啥。

### Phase 4 (V22-V28):bug 修复密集期(本次会话 7 月 7-8 日)

> 用户开始大量使用,发现了一堆"看起来 OK 但实际有 bug"的问题。

这是本次两天的密集 bug 修复阶段,核心叙事。

#### V22-V24:搜索清空 bug 的曲折修复

📷 **[图 11:V22 → V24 三个版本的 dist hash — V23 没变(hit)→ V24 真变了(突破)]**

| 版本 | hash | 现象 | 学到 |
|---|---|---|---|
| **V22** | DH4RPAG0 | bug:搜索后清空文件树不恢复 | 单一字段承担多职责 = bug |
| **V23** | DH4RPAG0 | fix 加好,**但 build 没真生效** | build 没真重跑 = fix 没生效 |
| **V24** | DP6OMa7Z | 真重 build,加 `allEntries` 字段 | hash 是真话的来源 |

**V23 的教训**: 我当时改完源码就报告成功,Leo 装上发现还是老版本。**根因是 `npm run sync` 没真把 vite 重跑**(依赖被命中缓存了)。

**修法**: 清 `node_modules/.vite` 缓存 + 重 build。

#### V25-V26:从修 bug 到修设计

| 版本 | hash | 改了什么 | 学到 |
|---|---|---|---|
| **V25** | B2sJAe2N | ⭐ 重构成 `displayEntries` getter | 派生值用 getter,**不要 mutate 关键 state** |
| **V26** | z_-fCmOo | ⭐ 多绑 `@search` `@change` `@keyup` | 跨平台 WebView 行为差异,绑多兜底 |

**V25 之前的代码**:
```typescript
// 错:既当全量又当展示
@state() entries = [];

// 用户搜索
this.entries = this.entries.filter(...) // ← 引用被覆写
// 用户清空
this.entries = this.entries // ← 把过滤后的赋给自己
// → 永远恢复不了
```

**修法**:
```typescript
// V25 推荐写法
@state() allEntries = [];        // 全量(永不 mutate)
@state() searchTerm = '';        // 用户输入

render() {
  const entries = this.searchTerm
    ? this.allEntries.filter(x => x.path.includes(this.searchTerm))
    : this.allEntries;
  ...
}
```

📷 **[图 12:V25 vs V24 的代码 diff — 删除 `this.entries = this.entries` 那行,加 displayEntries getter]**

**V26 之前的搜索框**:
```html
<input type="search" @input=${this.onSearch}>
```

用户点了 type="search" 自带的 **× 清除按钮**,Android WebView 上 `@input` 不触发。日志里看到 Leo 反馈"搜索清不掉"。

**修法**:
```html
<input type="search"
  @input=${this.onSearch}
  @search=${this.onSearch}     <!-- type="search" × 按钮专用 -->
  @change=${this.onSearch}
  @keyup=${this.onSearch}>     <!-- 每个键弹起 -->
```

📷 **[图 13:Android WebView 上 type="search" × 按钮不触发 @input 的截屏/chrome devtools 截图]**

#### V27-V28:wikilink 跳转问题

| 版本 | hash | 改了什么 | 学到 |
|---|---|---|---|
| V27 | BjHQvznE | wikilink 找不到 → 自动开侧栏搜索列候选 | 找不到 → 用搜索兜底而不是 alert |
| **V28** | JXfuig-5 | ⭐ wikilink 第一个字消失 → 渲染 bug (line 40 错误拒绝) | 永远验实际行为,逻辑+注释要一致 |

**V28 bug 的真因**:
```typescript
// renderer.ts:40
if (state.src.charCodeAt(start + 1) === 0x5B /* [ */) return false; // 跳过 [[
```

对 `[[Note Name]]`:
- `start` = 第 1 个 `[` 的位置
- `start + 1` = 第 2 个 `[` 的位置 → charCode 是 0x5B
- **永远 return false** → wikilink rule 永远不命中

注释写的"跳过 [[" 是错的(应该是"跳过 `![[image]]` 这种情况,已经由 line 39 处理)。

📷 **[图 14:renderer.ts 删 line 40 后的 diff — wikilink 第一个字回来]**

### Phase 5 (V29-V30):体验打磨(本次会话 7 月 8 日下午)

> Leo 主动提了 5 个需求,我一次做完。

| 版本 | hash | 加了什么 |
|---|---|---|
| **V29** | CR1ZGuEk | ⭐ 顶部工具栏 3 按钮(设置/分享/帮助);5 主题预设;点阅读区自动关侧栏;ESC 关 modal |
| V30 | DYSrAjgp | 浅色主题整体协调(补全 9 个 CSS var);分享内容完整(放开截断) |

**V29 的 5 个特性**:
1. **点阅读区自动关侧栏** — `main` 加 click handler,点 sidebar-overlay 自动收起
2. **顶部工具栏 3 按钮** — sticky bar 在 main 顶部,3 个 36x36 圆角图标按钮
3. **设置 modal** — 5 主题预设 + 8 项颜色 + 字体 + 字号
4. **分享 modal** — Capacitor Share + 降级到 navigator.share + 复制兜底
5. **帮助 modal** — 6 节使用说明

📷 **[图 15:V29 完整功能截图拼图 — 文件树、设置 modal、分享 modal、帮助 modal]**

📷 **[图 16:V30 浅色主题对比 — 默认深色 vs 白色主题,toolbar 同步变白]**

**V30 修复**:
1. **V29 浅色主题不协调** — `applySettings()` 只设了 4 个 CSS var,toolbar 还是深色。V30 补全 9 个 var。
2. **V29 分享内容硬截 500 字** — V30 默认完整分享,超大才截并提示字数。

---

### 7 个跨阶段的关键教训

1. **V3-V9 试错不丢人** — APK 能装上比完美设计重要
2. **V4 加 CapacitorHttp 是关键转折** — 从"装上 app"到"能读笔记"差的就是这一行
3. **V7 debug 面板价值无限** — 没它,V8-V21 全得靠 logcat
4. **V10 的 no-details 决定 render 性能** — `<details>` 在 Android WebView 上 touch 行为不稳
5. **V15 force-scroll 解决滚动穿透** — `overflow-y: scroll !important` 一行省几天
6. **V22-V28 反复修一个 bug 不是浪费时间** — 是"基础功能变日常可用"的必经之路
7. **V29 一次加 5 特性** — 当基础够稳了,半天就能加一整套打磨

📷 **[图 17:7 个跨阶段教训的图示 — V3-V9 重复失败,V29 一次成功的对比]**

---

## 第六章:26 个踩过的坑(按类别)

### 6.1 Shell / PowerShell(5 个)

1. **PowerShell 不认 `./gradlew`** — 用 `.\gradlew.bat`
2. **Windows tar 不支持 `--overwrite`** — 先删目录再解压
3. **Windows tar 中文路径 warning 乱码** — 可忽略,实际解压 OK
4. **`cd /d` 是 bash 语法** — PowerShell 用 `cd D:\`
5. **`cd D:\d` 不存在** — 用 `cd D:\` 完整路径

### 6.2 Build / Cache(5 个)

6. **改了源码 vite hash 没变** — 清 `node_modules/.vite`
7. **gradle 增量构建跳过** — 清 `android/app/build` 重 build
8. **APK hash 不是新 hash** — 验证 dist/cap sync 是否跑过
9. **旧 JS 文件累积在 APK** — 清理 `android/assets/public/assets/index-*.js`
10. **新 npm 依赖没装** — `npm install` 后再 `npx cap sync`

### 6.3 adb(4 个)

11. **adb 找不到设备** — USB 调试要开 + 数据线能传数据
12. **adb 不在 PATH** — 用绝对路径
13. **APK 安装失败 "签名不同"** — 先 `adb uninstall` 再装
14. **APK 装上但行为没变** — Android WebView 缓存,卸载重装

### 6.4 状态 / 逻辑(4 个)

15. **mutate `this.entries` 丢全量** — 改用 `displayEntries` 派生
16. **CSS var 漏设 `--bg-2`** — applySettings 必须全套
17. **分享内容硬截 500 字** — 默认完整,超长才截
18. **`<input type="search">` × 按钮不发 @input** — 多绑 `@search` 兜底

### 6.5 解析 / 渲染(4 个)

19. **wikilink rule 误拒绝 `[[...]]`** — 删错的条件分支
20. **light DOM + 部分属性绑定失效** — 必要时 shadow DOM
21. **markdown-it wikilink 第一个字没了** — 检查 rule 优先级
22. **lit unsafeHTML 注入 XSS 风险** — 别直接渲染用户输入

### 6.6 配置 / 凭证(4 个)

23. **aliyun CLI profile 名错** — 用实际名 `leo-oss` 不是 `obsidian-sync`
24. **`oss cp` 覆盖要 `-f`** — 加在 URL 后面
25. **用 `cc-connect send` exit 0 误判成功** — 真的去读 config 验证
26. **localStorage 老格式不兼容** — 加载时合并默认值

📷 **[图 18:26 个坑按 6 个类别分布的饼图 / 柱状图]**

---

## 第七章:怎么部署 + 自动同步

### 7.1 自动同步(cron)

📷 **[图 19:定时同步架构图 — Obsidian vault → NAS sync_vault.sh → aliyun CLI → OSS → APK reader]**

我设了两个定时任务:

```bash
# 每天 03:20 和 15:20 北京时间各一次
cc-connect cron add --cron "20 19 * * *" --exec "bash sync_vault.sh >> /tmp/leoliao-sync.log 2>&1" --desc "vault → OSS 03:20 BJT" --silent
cc-connect cron add --cron "20 7 * * *" --exec "bash sync_vault.sh >> /tmp/leoliao-sync.log 2>&1" --desc "vault → OSS 15:20 BJT" --silent
```

NAS UTC 时区,03:20 BJT = 19:20 UTC。脚本 `/mnt/work/leoliao-app/scripts/sync_vault.sh` 会自动加载 AK 然后跑 `sync_vault.mjs`。

### 7.2 sync_vault.mjs 的逻辑

```javascript
// 1. 拉远端 manifest.json (缓存所有文件 hash)
// 2. 扫本地 vault,算每个 MD 的 md5
// 3. 比对:
//    本地新增 / hash 变化 → 上传
//    OSS 有但本地没有 → 删除
// 4. 生成新 manifest 上传 OSS
```

⚠️ **3 个常见 bug**:
- aliyun profile 名错(`obsidian-sync` 不存在,实际叫 `leo-oss`)
- `oss cp` 覆盖要 `-f` flag(否则 stdin 关掉时静默 skip + exit 0)
- 启动时 sanity check 凭证,无 AK 就硬退出

### 7.3 一次同步典型流程

📷 **[图 20:典型同步日志输出 — 远端 1248 个 → 本地 1248 个 → 差异 N 个 → 上传完成]**

```
🔄 同步 /vault/LeoLiao → oss://liaoguogang
📋 拉取远端 manifest...
   远端 1216 个文件
📂 扫描本地 vault...
   本地 1248 个 MD
📊 差异:
   需上传: 32 个
   需删除: 0 个
✅ 上传 32 / 失败 0
📋 上传新 manifest...
✨ 同步完成
```

---

## 第八章:iOS 怎么迁移

现在这个项目纯 Android,如果有一天有了 mac 机器 + Apple Developer 账号,可以走 Capacitor 一套代码出 iOS。

### 8.1 环境准备

| 工具 | 来源 | 备注 |
|---|---|---|
| **macOS** | Apple | iOS 开发必需(只有 mac 能 build iOS) |
| **Xcode 15+** | App Store | 自带 iOS Simulator + SDK |
| **Xcode CLT** | `xcode-select --install` | `xcodebuild` `simctl` |
| **CocoaPods** | `brew install cocoapods` | Capacitor 用它装 iOS 依赖 |
| **ios-deploy** | `brew install ios-deploy` | 真机装 IPA |
| **Apple Developer 账号** | developer.apple.com ($99/yr) | 真机和发布必需 |

### 8.2 完整步骤

```bash
# 1. 创建 iOS 项目 (一次性)
cd ~/leoliao-app
npx cap add ios

# 2. 装 iOS 依赖
cd ios && pod install && cd ..

# 3. 编译 (模拟器)
npm run sync  # vite build + cap sync (含 iOS)
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator

# 4. 模拟器装
xcrun simctl list devices booted
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.leoliao.app

# 5. 真机 build (要 Apple Developer 证书)
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphoneos \
  -destination "platform=iOS,id=<device-udid>"

# 6. 真机装
ios-deploy -b ios/build/Build/Products/Debug-iphoneos/App.app -d <udid>
```

📷 **[图 21:Capacitor 生成 ios/ 目录后的 Xcode 工程截图 — ios/App/App.xcworkspace]**

📷 **[图 22:Xcode 选择 Development Team + Bundle Identifier 截图]**

### 8.3 iOS 特有坑

| 坑 | 描述 | 修法 |
|---|---|---|
| **WKWebView 缓存更激进** | 改了代码不重载 | 加 cache-bust query string |
| **iPhone 刘海** | 内容被刘海/底部 home indicator 挡住 | `viewport-fit=cover` + `env(safe-area-inset-*)` |
| **iOS 14+ 隐私 manifest** | 上架被拒 | 填 `NSPrivacyAccessedAPIType` |
| **滚动穿透** | 弹层滚动漏到背景 | `-webkit-overflow-scrolling: touch` + `touchmove preventDefault` |
| **WKWebView file input** | 文件上传行为不同 | Capacitor 有 `@capacitor/camera` 等原生插件 |

---

## 第九章:推荐技术栈 + 写新 App 时的检查清单

### 9.1 推荐技术栈(2026 年做新 App)

| 层 | 推荐 | 备选 | 不推荐 |
|---|---|---|---|
| 前端框架 | **Lit** | Vue 3, Svelte | React (重) |
| 类型 | TypeScript | — | JS |
| 构建 | **Vite** | Rollup 直接用 | Webpack (慢) |
| 包管理 | **npm** | pnpm | yarn 1.x |
| 移动壳 | **Capacitor** | Cordova | React Native (跨平台但不够 web) |
| 本地存储 | **Dexie** (IndexedDB) | localStorage | SQLite (重) |
| 富文本 | markdown-it | remark | 自己写 |
| 状态 | Lit @state | Pinia / Zustand | Redux (重) |
| 测试 | Vitest | Jest | Mocha |
| 部署 | CDN + cap sync | App Store / Play Store | 自己 host |

### 9.2 自检清单(写新 App 之前跑一遍)

#### 启动检查
- [ ] 改了源码 → `npm run sync` (或 `tsc && vite build && cap sync`)
- [ ] 加了 npm 依赖 → `npm install`
- [ ] 加了 Capacitor 插件 → `npm install && npx cap sync android/ios`

#### 状态设计检查
- [ ] 数据源 / 过滤 / 派生分开
- [ ] 单字段只承担一个职责
- [ ] 派生属性用 getter,不用 @state
- [ ] 关键 state 不可变更新 `{ ...s, key: value }`
- [ ] localStorage 加载容错(老格式补字段)

#### UI 检查
- [ ] 顶部工具栏 sticky
- [ ] 侧栏移动端 translateX 动画
- [ ] 主区点击关侧栏,但 toolbar 点击不关
- [ ] ESC 关闭 modal
- [ ] 点遮罩关闭 modal
- [ ] **主题切换 → 所有相关 CSS var 都更新** ⭐
- [ ] 字体 / 字号独立可调

#### 跨平台兼容
- [ ] ⭐ **输入事件绑多个** (`@input` `@change` `@search` `@keyup`)
- [ ] WKWebView 缓存策略考虑
- [ ] iOS 安全区
- [ ] Android 后退键关 modal/侧栏
- [ ] 触控 target ≥ 32px

#### 完成后
- [ ] APK/IPA 在真机装,跑核心流程
- [ ] 远程 WebView 调试(`chrome://inspect`)
- [ ] 设置 / 缓存 / 分享都验证一遍
- [ ] ⭐ **三处 hash 完全一致** (dist, platform assets, app bundle)

---

## 第十章:这些文档怎么用

📷 **[图 23:5 份文档的关系图 — README 是入口,其他按需读]**

我沉淀了 5 份文档,**每份针对不同场景**:

| 文档 | 受众 | 何用 |
|---|---|---|
| **README.md** (502 行) | 任何读者 | 下载、安装、用、知道它怎么来的。**这是入口** |
| **SETUP.md** (123 行) | 早期搭建视角 | 项目搭建初期(已并入 README) |
| **BUILD-GUIDE.md** (459 行) | 开发者 | 在 Windows 上 rebuild APK 详细步骤 |
| **PLATFORM-GUIDE.md** (519 行) | 开发者 | 要做 iOS 或理解架构 |
| **APP-DEV-COMPLETE-GUIDE.md** (668 行) | 任何开发者 | 做新 App 项目时 |
| **BLOG.md** (本文) | 公众 / 自己归档 | 你正在读的 |

**推荐读法**:
- 想用这个 APP → README
- 想自己 fork 做一个 → README + BLOG(本文) + BUILD-GUIDE
- 想做 iOS 版本 → + PLATFORM-GUIDE
- 想做完全不同的新 App → 直接看 APP-DEV-COMPLETE-GUIDE

---

## 写在最后

这个项目从脚手架到可用 APP 用了 2 周、30 个版本、26 个坑。如果你跟着做一遍,**预计自己也用 2 周**,因为:

- ✅ 我已经把坑都踩了一遍,跟着做不会重复
- ✅ 三层架构清晰,改源码就能看到效果
- ✅ OSS 配置一次,以后所有项目都能复用
- ✅ iOS 迁移只需再加一个 `npx cap add ios`

如果你 fork 出来做了自己的版本,我很乐意看到。最重要的是——**别追求完美先跑起来**。我 V3 第一次跑通花了 30 分钟,后续 27 个版本都是建立在那个能跑的版本之上。

📷 **[图 24:整个项目最终样子:手机截图 + iOS 模拟器截图 + tar 包截图 三拼图]**

---

**附录**:
- [GitHub repo](占位,开源后填)
- [Android 下载链接](OSS 公开后填)
- [iOS App Store](占位)

写于 2026 年 7 月,V30 之后。如果你有反馈或问题,飞书 @Leo 即可。

最后更新: 2026-07-09
