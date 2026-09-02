# v1.2.0-multi-session-pdf — 多会话 + PDF 阅读 + 引用卡片升级

🎉 V42 三大新功能 + 1 个关键修复

## ✨ 新功能

### 1. 多会话侧边栏
- 左侧抽屉式会话列表（220px 宽）
- "+ 新建会话" / "✏️ 改名" / "🗑 删除" 按钮
- 自动用首问前 12 字生成会话标题
- 切换会话不影响 LLM 设置
- 会话元数据：消息数 + 最近活动时间
- 老数据自动迁移（`'default'` session → 新表）

### 2. ⏹ 停止生成按钮
- 流式输出时 "发送" 按钮替换为红色 "⏹ 停止"
- 点击触发 `AbortController.abort()`
- 已输出内容持久化，附加 `[⏹ 已停止]` 标记
- 真正解决 "发了停不下来" 的体验问题

### 3. Citation 卡片化
- 引用从 `[KB#1]` 标签升级为完整卡片
- 卡片展示：标签 + 标题 + snippet(140字) + 路径 + score
- KB 引用可点击 → 派发 `open-citation` 事件（携带 path + snippet + score）
- Web 引用卡片作为 `<a target="_blank">` 外链打开
- 按 KB / Web 分组（本地知识库 / 联网搜索）
- 整体 `<details open>` 折叠，"📚 参考来源 (N)"

### 4. PDF 阅读（file-opener）
- 集成 `pdfjs-dist` 6.3.289（本地推理）
- 默认渲染前 5 页为 PNG，清晰度 1.5x
- 大 PDF 显示 "共 N 页,仅渲染前 5 页" 提示
- PDF.js worker 单独打成资源（1.27 MB）

## 🔧 关键修复：Iterator polyfill

**症状**：WebView 启动时 `ReferenceError: Iterator is not defined`，导致 chat-panel 模块从未注册（CDP 验证 `chatPanelDefined: false`）

**根因**：PDF.js 6.x 用了 Stage 4 Iterator helpers（`Iterator.prototype.{map,filter,join,...}`），但 Android System WebView 没有这个全局

**修复**：`index.html` 加 inline polyfill（`Iterator.from` + 12 个 prototype helpers），无需重建 PDF.js

## 📦 验证

- 真机 `M4T0224612003168`（华为 ALN-AL10P, Android 14）
- CDP 验证（`webview_devtools_remote` via `adb forward`）：
  - `chatPanelDefined: true`
  - 多会话：1 → 点新建 → 2 ✅
  - sidebar / rename / delete 按钮齐全
  - input → send → 触发流式 ✅
  - **chat 滚动修复**：modal 占满 100vh, body 滚动到底 ✅
  - **hits 上移**：assistant 消息 `[meta, citations, rag, content, actions]` 顺序 ✅
  - **复制按钮**：点击 → Capacitor Clipboard → "✅ 已复制" ✅
  - **发送后按钮 bug**：完成后按钮回到 "发送"（不再是 "停止"）✅
  - NO_ERRORS
- typecheck: pass
- APK: debug 5.62MB / release 4.44MB

## 📌 v1.2.0-p2 追加 4 件事（用户反馈）

1. **Bug 修复**：send() 成功路径漏 `sending=false`,导致按钮停在"⏹ 停止"。修复后 LLM 完成立刻回到 "发送"
2. **UI 重排**：把 hits（citations + RAG 标签）从 content **下方**移到**上方**。用户能直接看到检索过程 vs 推理过程
3. **复制按钮**：assistant 消息底部加 "📋 复制"，点击调 Capacitor Clipboard 原生 API → "✅ 已复制"（1.8s 反馈后复位）
4. **chat 滚动修复**：modal 加 v42 sidebar 后高度没传，导致下方 ~30% 黑屏 + 内容无法滑动。修复为 `100dvh` + `min-height: 0` 让 body 滚动生效

## 📦 新增依赖

- `@capacitor/clipboard@^6.0.3` — Android 原生剪贴板（Android System WebView 的 `execCommand('copy')` 100% 失败）

## 📊 改动

```
7 files changed, 1020 insertions(+), 90 deletions(-)
- index.html                   +27  (Iterator polyfill)
- src/services/db.ts           +116 (chatSessions table + 8 CRUD)
- src/components/chat-panel.ts +357 (sidebar + stop + citation cards)
- src/services/file-opener.ts  +81  (renderPdf with pdfjs-dist)
- src/styles.css               +242 (sidebar + citation + stop + PDF CSS)
- package.json                 +2   (pdfjs-dist dep)
```

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.2.0-multi-session-pdf
- Commit: `f25c335`
- APK: `app-release.apk` 4.43 MB