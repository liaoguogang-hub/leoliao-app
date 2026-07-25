# App 开发完整指南 — 从 V22 到 V30 所有经验

> 从 2 天实战(Android 知识库 APK)中提炼的 App 开发完整方法论,用于未来任何平台(iOS/iPadOS/macOS/Web)。
> 写于: 2026-07-08
> 涵盖: 设计哲学 / 状态管理 / 跨平台架构 / 构建流程 / 调试验证 / 主题定制 / 分享 / 数据同步 / 26 个踩过的坑

---

## 0. 速查 — 8 个核心认知

1. **Hash 是真话的来源** — `dist/`、`android/assets/`、APK 里三处必须一致
2. **状态分清楚** — 数据源、展示、过滤、派生要分字段,不能一个字段当两个用
3. **事件绑多兜底** — 跨平台 WebView 行为不一致,`@input` `@change` `@search` `@keyup` 都绑上
4. **派生属性不存 state** — 用 getter 在 render 里算,不要 mutate
5. **插件加完 npm install + cap sync** — Capacitor 插件必须装两次才生效(依赖 + 项目链接)
6. **主题变量要全套** — applySettings 必须覆盖所有相关 CSS var(--bg/--bg-2/--border/--dim)
7. **永远验实际行为** — 不能 alert 就不能,得给替代方案
8. **数据不要人为截断** — 分享给完整内容,超大才截并提示

---

## 1. 跨平台架构总图

```
┌────────────────────────────────────────────────────────────┐
│ 应用包层 (APK / IPA / APP / Web Bundle)                    │
│   - 签名 + 资源 + native 壳                                  │
│   - 包名 (com.example.app)                                   │
│   - 显示名                                                    │
└────────────────────────────────────────────────────────────┘
                            ↑ 打包
┌────────────────────────────────────────────────────────────┐
│ 平台原生项目                                                   │
│   Android:  android/ + Gradle build                          │
│   iOS:      ios/ + xcodebuild                                 │
│   Web:      dist/ 直接 serve                                  │
└────────────────────────────────────────────────────────────┘
                            ↑ 拷贝
┌────────────────────────────────────────────────────────────┐
│ Web 资源 (编译产物)                                            │
│   index.html + assets/index-XXXXXX.js (内容 hash)             │
│   css + 图片 + 服务端 mock                                    │
└────────────────────────────────────────────────────────────┘
                            ↑ 编译
┌────────────────────────────────────────────────────────────┐
│ 源码层                                                          │
│   src/main.ts / components/*.ts                              │
│   package.json (deps + scripts)                              │
│   capacitor.config.ts (桥接配置)                              │
└────────────────────────────────────────────────────────────┘
```

### 跨平台选型决策树

| 需求 | 推荐 | 备注 |
|---|---|---|
| 简单 web 套壳 | **Capacitor** + Lit/Vue/React | 一套代码双端跑,配置最少 |
| 复杂交互 + 跨平台一致性 | **React Native** | 调试工具更成熟 |
| 高性能 + 跨平台 | **Flutter** | 自带渲染,UI 一致性强 |
| 单端 + 重平台集成 | 各平台原生 | iOS Swift, Android Kotlin |

本次知识库用了 Capacitor + Lit + TypeScript。

---

## 2. 环境与工具

### 2.1 通用
| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | 18+ | vite / tsc / cap CLI |
| TypeScript | 5.6+ | 类型检查 |
| Vite | 5.4+ | 前端打包 (内容 hash 命名) |
| Git | 任意 | 版本管理 |

### 2.2 Android
| 工具 | 来源 | 备注 |
|---|---|---|
| Java JDK 17 | Oracle / OpenJDK | Gradle 必需 |
| Android SDK | cmdline-tools 或 Android Studio | platform-tools + platforms;android-34 + build-tools:34.0.0 |
| Gradle wrapper | 项目自带 (`./gradlew.bat` Windows / `./gradlew` Mac) | 不用单独装 |
| adb | SDK 自带 | 装/卸 APK |

### 2.3 iOS 准备清单 (未来启动时)
| 工具 | 来源 | 备注 |
|---|---|---|
| macOS | Apple | iOS 开发必需 |
| Xcode 15+ | App Store | 自带 iOS Simulator + SDK |
| Xcode CLT | `xcode-select --install` | xcodebuild / simctl |
| CocoaPods | `brew install cocoapods` | Capacitor 用它装 iOS 依赖 |
| ios-deploy | `brew install ios-deploy` | 真机装 IPA |
| Apple Developer | developer.apple.com ($99/yr) | 真机 + 发布 |

### 2.4 Capacitor 命令速查

```bash
npx cap add android      # 创建 android/ (首次)
npx cap add ios          # 创建 ios/ (首次)
npx cap sync android     # 同步 web 资源 + 链接插件
npx cap sync ios         # 同上 iOS
npx cap open android     # 用 Android Studio 打开
npx cap open ios         # 用 Xcode 打开
```

---

## 3. 完整构建流程

### 3.1 Android (Capacitor)

```powershell
# 0. 一次性:装依赖 (含新增 Capacitor 插件时)
npm install

# 1. 同步插件到 Android 项目 (新增插件时)
npx cap sync android

# 2. 编译 + 同步 web 资源
npm run sync   # = tsc + vite build + cap sync

# 3. 打 APK
cd android
.\gradlew.bat assembleDebug   # Windows
# 或 ./gradlew assembleDebug  # Mac/Linux

# 4. 部署
adb uninstall com.example.app
adb install app\build\outputs\apk\debug\app-debug.apk
```

### 3.2 iOS (Capacitor) — 后续做

```bash
# 0. 一次性
npm install
cd ios && pod install && cd ..

# 1. 编译 web 资源
npm run sync

# 2. 模拟器 build
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App -configuration Debug -sdk iphonesimulator

# 3. 模拟器装
xcrun simctl list devices booted
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.example.app

# 4. 真机 build (要 Apple Developer 证书)
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=<device-udid>"

# 5. 真机装
ios-deploy -b ios/build/Build/Products/Debug-iphoneos/App.app -d <udid>
```

### 3.3 包一把脚本 (跨平台,放 npm scripts)

```json
{
  "scripts": {
    "sync": "npm run build && cap sync android",
    "android:apk": "npm run sync && cd android && ./gradlew assembleDebug",
    "ios:build": "npm run sync && cd ios && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator"
  }
}
```

---

## 4. 三层 hash 一致性 — 唯一真理

### 4.1 三处 hash 必须一致

```
源码改一行
  → ① dist/assets/index-XXXX.js         (内容 hash 变了)
    → ② android/assets/public/index-XXXX.js (cap sync 拷贝过去,应该和 ① 同)
      → ③ APK 里 index-XXXX.js            (gradle 打包,应该和 ② 同)
```

任何一处不对 = 没生效。验证脚本:

```bash
md5sum /dist/index-*.js
md5sum /android/assets/public/index-*.js
# APK 里:
unzip -p app.apk assets/public/assets/index-*.js | md5sum
```

### 4.2 dist hash 变化追踪

Capacitor 自动 copy 资源时会打印新 hash。常见变更场景:
- 改了任何 .ts / .tsx / .css
- 加了新 npm 依赖
- 加了新 Capacitor 插件
- 改了 capacitor.config.ts
- 改了 index.html / public/ 下任何静态资源

### 4.3 PowerShell 验 APK

```powershell
$apk = "android\app\build\outputs\apk\debug\app-debug.apk"
Copy-Item $apk "$env:TEMP\chk.zip"
Expand-Archive "$env:TEMP\chk.zip" -DestinationPath "$env:TEMP\ext" -Force
Get-ChildItem "$env:TEMP\ext\assets\public\assets\*.js" | Select Name
```

---

## 5. 状态管理原则 (V22→V30 核心教训)

### 5.1 单一数据源

| 场景 | 错 | 对 |
|---|---|---|
| 搜索过滤 | `entries` 既存全量又被 mutate | `allEntries` (全量) + `searchTerm` (独立 state) + render 里算 `displayEntries` |
| 主题色 | 单 var 改不全 | 9 个 var 一起覆盖,bg2/border/dim 都要 |
| 模态开关 | 多个 showModal flag | 一个 `@state() activeModal: 'settings'\|'share'\|'help'\|null` |

### 5.2 派生属性用 getter

```ts
private get displayEntries(): ManifestEntry[] {
  if (!this.searchTerm) return this.allEntries;
  return this.allEntries.filter(x => x.path.includes(this.searchTerm));
}

// render() 里:
const entries = this.displayEntries;
```

`@state` 装饰的属性是响应式的存储。但**派生值应该用 getter 计算**而不是存新 state,否则得手动同步容易漏。

### 5.3 写不可变更新

```ts
// 错:mutate 关键 state
this.settings.bgColor = '#ff0000';
this.settings = this.settings;  // 触发重渲染(但其他字段丢了)

// 对:整个对象替
this.settings = { ...this.settings, bgColor: '#ff0000' };
```

### 5.4 跨平台事件绑定兜底

```ts
<input
  @input=${this.onX}      // 主流
  @change=${this.onX}     // 提交/失焦触发
  @search=${this.onX}     // type="search" ×按钮触发
  @keyup=${this.onX}      // 每个键弹起触发
/>
```

每多绑一个事件就少一个 WebView 兼容性问题。 代价是一行代码。

### 5.5 完整状态字段 vs 派生

```ts
// 反例:派生值当 state 存
@state() filteredList: T[] = [];  // 必须手工跟 entries/searchTerm 同步
@state() entries: T[] = [];       // 全量+过滤结果混在一起
@state() searchTerm = '';

// 正例:状态存 + 派生计算
@state() allEntries: T[] = [];          // 数据源
@state() searchTerm = '';               // 用户输入
// render 里: const filtered = ...allEntries.filter(...searchTerm)
```

---

## 6. UI 模式

### 6.1 顶部工具栏 (sticky)

```html
<div class="toolbar">
  <span class="toolbar-title">{currentItem?.name || 'App'}</span>
  <div class="toolbar-actions">
    <button title="设置">⚙️</button>
    <button title="分享">↗️</button>
    <button title="帮助">❓</button>
  </div>
</div>
```

样式: `position: sticky; top: 0; z-index: 5;`

### 6.2 侧栏 + 内容切换 + 主区点击关闭

```ts
// sidebar-open class 控制显隐
// main 区域 click 关闭侧栏(不在 toolbar 元素上)
private handleMainClick(e: MouseEvent) {
  if (!this.sidebarOpen) return;
  const target = e.target as HTMLElement;
  if (target.closest('.toolbar')) return;  // 别关 toolbar 点击
  this.sidebarOpen = false;
}

// ESC 也关
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { ... }
});
```

### 6.3 模态弹窗 (modal)

```html
<div class="modal-overlay" @click=${(e) => {
  if (e.target === e.currentTarget) close();  // 点遮罩关闭
}}>
  <div class="modal">
    <div class="modal-header">
      <h2>标题</h2>
      <button @click=${close}>✕</button>
    </div>
    <div class="modal-body">
      内容
    </div>
  </div>
</div>
```

CSS: `.modal-overlay { position: fixed; inset: 0; ... }`, `.modal { max-width: 520px; max-height: 85vh; }`

### 6.4 主题设置 (localStorage + CSS vars)

```ts
function applySettings(s) {
  // 必须全覆盖所有相关 var,不然部分元素不响应主题切换
  Object.entries({
    '--bg': s.bg, '--bg-2': s.bg2, '--card': s.bg2,
    '--fg': s.fg, '--dim': s.dim, '--border': s.border,
    '--accent': s.accent, '--link': s.link, '--heading': s.heading,
  }).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}
```

**V30 教训**: V29 只设了 `--bg/--fg/--accent/--link` 4 个 var,结果浅色主题下 toolbar 还是深色。

### 6.5 分享 (Capacitor Share 优先 + 多级降级)

```ts
async doShare() {
  if (Capacitor.isNativePlatform()) {
    try { await Share.share({ title, text }); return; }
    catch (e) { /* fall through */ }
  }
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  // 最后降级:复制到剪贴板
  await navigator.clipboard.writeText(text);
}
```

**V30 教训**: 默认发完整内容,超大才截。`slice(0, 500)` 这种行为会让分享基本没用。

---

## 7. 数据持久化

### 7.1 三种存储选择

| 数据 | 存储 | 原因 |
|---|---|---|
| 用户设置 (主题等) | localStorage | 简单快捷 |
| 缓存笔记内容 | Dexie (IndexedDB) | 大对象、查询 |
| 关键配置 | Capacitor Preferences plugin | 跨平台 + 安全 |

### 7.2 设置的保存与加载

```ts
function saveSettings(s: ThemeSettings) {
  localStorage.setItem('kb-settings', JSON.stringify(s));
}
function loadSettings(): ThemeSettings {
  const raw = localStorage.getItem('kb-settings');
  return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
}
```

`connectedCallback` 里:
```ts
this.theme = loadSettings();
applySettings(this.theme);  // 立刻应用,避免切换时一帧不对
```

### 7.3 兼容老格式

```ts
const parsed = JSON.parse(raw);
return {
  ...DEFAULT_SETTINGS,
  ...parsed,
  // V30 补全:老数据可能没这些字段
  bg2Color: parsed.bg2Color ?? DEFAULT_SETTINGS.bg2Color,
  dimColor: parsed.dimColor ?? DEFAULT_SETTINGS.dimColor,
};
```

---

## 8. iOS 启动准备 (未来做 Apple App)

### 8.1 macOS 环境
```bash
xcode-select --install
brew install cocoapods ios-deploy
```

### 8.2 创建 iOS 项目 (有 android 后只需一次)
```bash
npx cap add ios
cd ios && pod install && cd ..
```

### 8.3 iOS 特有坑
- **WKWebView 缓存更激进** — 加 cache-bust query string
- **滚动穿透** — `-webkit-overflow-scrolling: touch` + `touchmove preventDefault`
- **安全区域** — `viewport-fit=cover` + `env(safe-area-inset-*)`
- **iOS 14+ 隐私 manifest** — `NSPrivacyAccessedAPIType` 必须填
- **iPhone 刘海** — `viewport-fit=cover` + CSS 安全区
- **文件上传** — Capacitor 有 `@capacitor/camera` 等原生插件

---

## 9. 调试技巧

### 9.1 远程调试 WebView

```bash
# Android (USB 调试)
adb forward tcp:9222 localabstract:chrome_devtools_remote

# iOS
xcrun simctl list devices booted
xcrun simctl openurl booted "chrome://inspect"
# 或 Xcode → Window → Devices → Inspect
```

Chrome 浏览器打开 `chrome://inspect`,看 console / network / storage。

### 9.2 console.log 是个好东西

不要在生产代码里留 console.log,但开发时大量用 — 看变量值,看函数调用次数。

### 9.3 三处 hash 找问题
- 三处都一致 — 代码生效
- ① ≠ ② — cap sync 没跑
- ② ≠ ③ — Gradle 用了缓存,清 build 再 build
- ① 都没变 — 改了文件但 vite 没生效,清 `node_modules/.vite`

---

## 10. 完整版本演进 (知识库 V22 → V30)

| 版本 | hash | 修复 | 教训 |
|---|---|---|---|
| V22 | DH4RPAG0 | bug: `this.entries=this.entries` | 单字段不能多职责 |
| V23 | DH4RPAG0 | fix 加了但**没 build** | build 没生效 = fix 没生效 |
| V24 | DP6OMa7Z | 真 rebuild + 简单 fix | 修了但方向错 |
| V25 | B2sJAe2N | 重构 `displayEntries` getter | 派生属性用 getter |
| V26 | z_-fCmOo | 多绑 @search/@change/@keyup | 跨平台事件绑多兜底 |
| V27 | BjHQvznE | wikilink 模糊匹配 + 自动开侧栏 | 找不到 → 用搜索框列候选 |
| V28 | JXfuig-5 | wikilink 渲染 bug:删 line 40 | 永远验实际行为 |
| V29 | CR1ZGuEk | 5 打磨:toolbar/设置/分享/帮助/点阅读关侧栏 | 一次 5 个特性大版本 |
| V30 | DYSrAjgp | 主题全套 var + 分享全内容 | applySettings 必须覆盖全部相关 var;数据别人为截 |

---

## 11. 26 个踩过的坑分类清单

### 11.1 Shell/PowerShell 坑 (5)
1. PowerShell 不认 `./gradlew` — 用 `.\gradlew.bat`
2. Windows tar 不支持 `--overwrite` — 先删目录再解压
3. Windows tar 中文路径 warning 乱码 — 可忽略,实际解压 OK
4. cd /d 是 bash 语法 — PowerShell 用 `cd D:\`
5. `cd D:\d` 不存在 — 用 `cd D:\` 完整路径

### 11.2 Build / Cache 坑 (5)
6. 改了源码 vite hash 没变 — 清 `node_modules/.vite`
7. gradle 增量构建跳过 — 清 `android/app/build` 重 build
8. APK hash 不是新 hash — 验证 dist/cap sync 是否跑过
9. 旧 JS 文件累积在 APK — 清理 `android/assets/public/assets/index-*.js`
10. 多了 npm 依赖没装 — `npm install` 后再 `npx cap sync`

### 11.3 adb 坑 (4)
11. adb 找不到设备 — USB 调试要开 + 数据线能传数据
12. adb 不在 PATH — 用绝对路径 `$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe`
13. APK 安装失败 "签名不同" — 先 `adb uninstall` 再装
14. APK 装上但行为没变 — Android WebView 缓存,卸载重装

### 11.4 状态/逻辑 坑 (4)
15. mutate `this.entries` 丢全量 — 改用 `displayEntries` 派生
16. CSS var 漏设 --bg-2 — applySettings 必须全套
17. 分享内容硬截 500 字 — 默认完整,超长才截
18. `<input type="search">` × 按钮不发 @input — 多绑 `@search` 兜底

### 11.5 解析/渲染 坑 (4)
19. wikilink rule 误拒绝 `[[...]]` — 删错的条件分支
20. light DOM + 部分属性绑定失效 — 必要时 shadow DOM
21. markdown-it wikilink 第一个字没了 — 检查 rule 优先级
22. lit unsafeHTML 注入 XSS 风险 — 别直接渲染用户输入

### 11.6 配置/凭证 坑 (4)
23. aliyun CLI profile 名错 — 用实际名 `leo-oss` 不是 `obsidian-sync`
24. `oss cp` 覆盖要 `-f` — 加在 URL 后面
25. 用 `cc-connect send` exit 0 误判成功 — 真的去读 config 验证
26. localStorage 老格式不兼容 — 加载时合并默认值

---

## 12. 自检清单(以后开发任何 App 直接用)

### 12.1 启动检查
- [ ] 改了源码 → `npm run sync` (或 `tsc && vite build && cap sync`)
- [ ] 加了 npm 依赖 → `npm install`
- [ ] 加了 Capacitor 插件 → `npm install && npx cap sync android/ios`
- [ ] 三处 hash 一致 (dist, platform assets, app bundle)

### 12.2 状态设计检查
- [ ] 数据源 / 过滤 / 派生分开
- [ ] 单字段只承担一个职责
- [ ] 派生属性用 getter,不用 @state
- [ ] 关键 state 不可变更新 `{ ...s, key: value }`
- [ ] localStorage 加载容错(老格式补字段)

### 12.3 UI 检查
- [ ] 顶部工具栏 sticky,在 viewport top
- [ ] 侧栏移动端 translateX 动画
- [ ] 主区点击关侧栏,但 toolbar 点击不关
- [ ] ESC 关闭 modal
- [ ] 点遮罩关闭 modal
- [ ] 主题切换 → 所有相关 CSS var 都更新
- [ ] 字体 / 字号独立可调

### 12.4 跨平台兼容
- [ ] 输入事件绑多个 (`@input` `@change` `@search` `@keyup`)
- [ ] WKWebView 缓存策略考虑
- [ ] iOS 安全区
- [ ] Android 后退键关 modal/侧栏
- [ ] 触控 target ≥ 32px

### 12.5 功能完成后
- [ ] APK/IPA 在真机装,跑核心流程
- [ ] 远程 WebView 调试确认 console 无错
- [ ] 设置 / 缓存 / 分享都验证一遍
- [ ] 三处 hash 完全一致

---

## 13. 推荐技术栈 (供未来选型)

| 层 | 推荐 | 备选 | 不推荐 |
|---|---|---|---|
| 前端框架 | **Lit** (轻量 web components) | Vue 3, Svelte | React (重) |
| 类型 | TypeScript | — | JS |
| 构建 | **Vite** | Rollup 直接用 | Webpack (慢) |
| 包管理 | **npm** | pnpm | yarn 1.x |
| 移动壳 | **Capacitor** | Cordova | React Native (跨平台但不够 web) |
| 本地存储 | **Dexie** (IndexedDB wrapper) | localStorage | SQLite (重) |
| 富文本 | markdown-it | remark | 自己写 |
| 状态 | Lit @state | Pinia / Zustand | Redux (重) |
| 测试 | Vitest | Jest | Mocha |
| 部署 | CDN + cap sync | App Store / Play Store | 自己 host |

---

## 14. 文档结构 (项目里沉淀的知识)

```
项目根目录/
├── README.md                   # 项目入口
├── SETUP.md                    # 项目搭建
├── BUILD-GUIDE.md              # 当前平台构建详细步骤  ← BUILD-GUIDE
├── PLATFORM-GUIDE.md           # 跨平台架构 + iOS 准备  ← PLATFORM-GUIDE  
├── APP-DEV-COMPLETE-GUIDE.md   # 本文档: 终极开发者指南  ← APP-DEV-COMPLETE-GUIDE
│
├── src/
│   ├── main.ts                 # 入口组件 (3 按钮 toolbar + 3 modal)
│   ├── styles.css              # 全局样式 + CSS vars
│   ├── components/             # 子组件
│   │   ├── file-tree.ts
│   │   ├── note-view.ts
│   │   ├── settings-panel.ts   # V29
│   │   ├── share-panel.ts      # V29
│   │   └── help-panel.ts       # V29
│   └── services/
│       ├── sync.ts             # 拉 OSS manifest + 文件
│       ├── db.ts               # Dexie (IndexedDB wrapper)
│       ├── renderer.ts         # markdown-it + wikilink + callout
│       └── settings.ts         # V29+V30 主题服务
│
├── android/                    # Capacitor 生成,平台原生项目
├── ios/                        # (未来 npx cap add ios 后才有)
├── capacitor.config.ts          # 桥接配置 (appId/appName/server/android)
└── package.json                # deps + scripts
```

---

## 15. 一日工作流 (推荐流程)

### 开发某 App 的一天:

```
1. 编辑源码 (src/*.ts)
2. npm run sync           → vite build + cap sync
3. cd android && .\gradlew.bat assembleDebug
4. adb install -r ...app-debug.apk
5. 在手机跑一遍核心流程
6. 有问题: chrome://inspect 远程调试 console
7. 没问题: git commit + 写 git tag (vX.Y.Z)

build 时间预期 (V3 后):
- 首次: 10-15 分钟 (下依赖)
- 增量: 30 秒 - 3 分钟
```

### 发布版本的一天:

```
1. npm run sync
2. 清老 JS 文件(可选)
3. cd android && .\gradlew assembleRelease
   (需要签名密钥,在 android/keystore/ 配好)
4. adb install -r ...app-release.apk
5. APK 包含 JS hash 验证
6. 通知发布
```

---

## 16. 参考和资源

- Capacitor 文档: https://capacitorjs.com/docs
- Lit: https://lit.dev
- Vite: https://vitejs.dev
- markdown-it: https://github.com/markdown-it/markdown-it
- Dexie (IndexedDB): https://dexie.org
- iOS HIG: https://developer.apple.com/design/human-interface-guidelines/
- Android Material: https://m3.material.io
- Apple Developer: https://developer.apple.com

---

## 17. 一句话总结

**做 App 的本质 = 在正确的地方存正确的数据 + 让 UI 实时反映数据变化 + 在用户操作出错时给有用的替代方案**。

剩下的就是工具和踩坑了。本文档把已知坑都列了,以后任何 App 都能省 80% 时间。

---

文档位置: `/mnt/work/leoliao-app/APP-DEV-COMPLETE-GUIDE.md`
配套文档:
- `BUILD-GUIDE.md` — Android 详细构建步骤(450 行)
- `PLATFORM-GUIDE.md` — 跨平台架构 + iOS 准备(519 行)
- `APP-DEV-COMPLETE-GUIDE.md` — 终极开发者指南(本文)
最后更新: 2026-07-19(V37 后)
