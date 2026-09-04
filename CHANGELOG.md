# Changelog

所有 leoliao-app 的显著变更都记录在这里。版本号遵循 [Semantic Versioning](https://semver.org/)。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [Unreleased]

### 计划中

(等待下一轮需求)

---

## [1.34.0] - 2026-09-04

### Hotfix: reindexAll 改为从全文 note 重切

> **代号**: `reindex-from-notes`

### Fixed

- **>512KB 文件无法重索引** — history 不存 bytes → 改为从 notes 表全文重切
- **"9 chunks" 澄清** — 9 页 PDF = 9 chunks 正常,5065 字全入库

### Changed

- `src/components/local-files-panel.ts` — reindexAll 用 notes 全文,不依赖 bytes

### 验收

- [x] 不依赖 bytes
- [x] 从 note 重切
- [x] tsc 通过
- [x] APK 装机

---

## [1.33.0] - 2026-09-04

### Hotfix: 启动提速 + Graph 构建修复

> **代号**: `start-fast`

### Fixed

- **每次打开都重新同步** — 5 分钟缓存跳过(localStorage `ll-last-sync`)
- **Graph 构建不成功** — render 重构,拆 renderBody() 修模板闭合

### 验收

- [x] 启动秒开(缓存)
- [x] graph 构建正常
- [x] tsc 通过
- [x] 双设备装机

---

## [1.32.0] - 2026-09-04

### Hotfix: Graph 渲染截断 + 回滚 + auto-wikilinks 全局上限

> **代号**: `graph-safety`

### Fixed

- **Auto-wikilinks 过度注入** — maxTotal=500 + maxPerNote=8
- **Graph "一直构建中"** — 边数渲染截断 800
- **Graph loading 卡死** — finally 强制 loading=false

### Added

- **注入 marker**(`<!--@leoliao:aw:N:...-->`)
- **`revertAutoInjectedWikilinks()`** 一键回滚
- **↩️ 回滚注入** 按钮(只删自动注入的,不影响手写)

### 验收

- [x] maxTotal=500 + maxPerNote=8
- [x] 注入 marker
- [x] revert 函数
- [x] 边数截断
- [x] 回滚按钮
- [x] loading 保险
- [x] tsc 通过
- [x] APK 装机

---

## [1.31.0] - 2026-09-04

### Hotfix: PDF 全 cMap 兜底

> **代号**: `pdf-full-cmap`

### Fixed

- **PDF 正文页文字提取为 0** — 27 个 cMap 不够,扩展到全 169 个
- **加 standardFontDataUrl** — PDF.js 标准字体 fallback

### Changed

- `public/cmaps/` — 27 → 169 个
- `public/standard_fonts/` — 0 → 16 个(新增)
- APK 大小:5.96 MB → 7.43 MB(+1.5 MB)

### 验收

- [x] 全 cMap 复制
- [x] standard_fonts 复制
- [x] PDF.js 配置
- [x] tsc 通过
- [x] APK 装机

---

## [1.30.0] - 2026-09-04

### Feature: 自动注入 Wikilink

> **代号**: `auto-wikilinks`

### Added

- **`auto-wikilinks.ts`** — 扫描 vault 标题,自动在正文里注入 `[[xxx]]`
- **graph-view 加 3 个按钮** — 预览 / 自动建立 / 重建图谱
- **chunker 自动重切** — 注入链接后立即让 graph 节点可见

### 验收

- [x] auto-wikilinks 完整
- [x] graph-view 集成
- [x] dryRun + 真写入
- [x] tsc 通过
- [x] APK 装机

---

## [1.29.0] - 2026-09-04

### Hotfix: PDF/EPUB 索引诊断 + EPUB fallback

> **代号**: `index-diag`

### Fixed

- **PDF/EPUB 索引诊断** — 每页 log
- **EPUB fallback** — spine 失败时扫所有 xhtml

### Changed

- `src/services/file-opener.ts` — 诊断日志 + fallback 扫描

### 验收

- [x] PDF 每页 log
- [x] EPUB 空章节 log
- [x] EPUB fallback
- [x] tsc 通过
- [x] APK 装机

---

## [1.28.0] - 2026-09-04

### Hotfix: reindexAll 等 indexingDone

> **代号**: `reindex-stability`

### Fixed

- **重索引 chunks 错乱** — reindexAll 不等 indexingDone 就开始下一个文件

### Changed

- `src/components/local-files-panel.ts` — `reindexAll` await `indexingDone`

### 验收

- [x] 等 indexingDone
- [x] 200ms 喘息
- [x] tsc 通过
- [x] APK 装机

---

## [1.27.0] - 2026-09-04

### 严格 RAG:严禁幻觉

> **代号**: `strict-rag`

### Fixed

- **RAG fallback 允许训练知识** — KB 空时 prompt 让 LLM "直接回答"
- **结构化问题统一回答** — 强化规则:按章节区分有无原文

### Changed

- `src/lib/search.ts` — `buildRAGPrompt` + `buildFullRAGPrompt` 严格禁止幻觉

### 验收

- [x] 严禁训练知识
- [x] 明确"放进 vault"提示
- [x] 章节结构化区分
- [x] tsc 通过
- [x] APK 装机

---

## [1.26.0] - 2026-09-04

### UX: Chunker 细粒度 + EPUB 可重索引

> **代号**: `chunker-fine`

### Fixed

- **Chunker 切分粒度太粗** — 加 `paragraph-only` 模式 + `forceChunkSize` 参数
- **EPUB 无法重索引** — `reindexAll` 加 `__debugRenderEpub` 公开入口

### Changed

- `chunker.ts` — 加 paragraph-only 模式
- `file-opener.ts` — PDF/EPUB 索引用新模式
- `local-files-panel.ts` — reindexAll 支持 EPUB

### 验收

- [x] chunker 新模式
- [x] PDF/EPUB 自动应用
- [x] reindexAll 支持 EPUB
- [x] tsc 通过
- [x] APK 装机

---

## [1.25.0] - 2026-09-04

### UX: 本地索引重做 + includeLocal 默认开

> **代号**: `local-index-ux`

### Added

- **本地文件一键重索引** — `local-files-panel` 加 `🔄 重索引全部` 按钮
- **`includeLocal` 默认 true** — 新用户开箱即用
- **UI 状态徽章** — `✓ 已启用` / `⚠ 关闭中`
- **localStorage 持久化** — `ll-chat-include-local`

### 验收

- [x] 重索引按钮
- [x] includeLocal 默认开
- [x] 状态徽章
- [x] 持久化
- [x] tsc 通过
- [x] APK 装机

---

## [1.24.0] - 2026-09-04

### Hotfix: Agent 死循环 + 收敛

> **代号**: `agent-converge`

### Fixed

- **Agent 死循环** — 连续 2 次相同工具调用 → 注入 final-answer hint 强制收敛
- **MAX_STEPS 5 → 8** — 给多步推理足够空间
- **fallback 优化** — 用 lastLlmText 替代机械错误提示
- **AgentContext 透传 includeLocal** — 保险

### 验收

- [x] MAX_STEPS 8
- [x] stuck-loop 检测
- [x] final-answer hint
- [x] fallback 优化
- [x] tsc 通过
- [x] APK 安装

---

## [1.23.0] - 2026-09-04

### Bugfix: PDF/EPUB 索引 + Agent 记忆

> **代号**: `hotfix-pdf-epub-agent`

### Fixed

- **Fix A: EPUB/本地文件检索为空** — `agent.kbSearch` 默认 `includeLocal=true`
- **Fix B: PDF 索引不完整** — 分批(每 10 页)+ 进度日志 + scanned PDF 检测
- **Fix C: Agent 无长期记忆** — Agent + 非 agent 路径都注入 `buildMemoryPrompt()`
- **Fix F: 索引完成无提示** — indexingDone 后 `noticeMsg` toast

### 验收

- [x] EPUB 可被 Agent 检索
- [x] PDF 索引完整遍历
- [x] Agent 长期记忆注入
- [x] 索引完成 toast
- [x] tsc 通过

---

## [1.22.0] - 2026-09-04

### Phase X.1 — 导出能力扩展

> **代号**: `export-conv`

### Added

- **`exportConversation(sessionId)`** — chat session → Markdown
- **`exportBook(prefix)`** — 文件夹 → 小书
- **`exportJsonLd(prefix)`** — 知识图谱 → JSON-LD (schema.org Article)
- **`downloadAsFile(content, filename, mimeType)`** — 浏览器下载

---

## [1.21.0] - 2026-09-04

### Phase O.1 — Obsidian 完整语法补全

> **代号**: `obsidian-full`

### Added

- **`%%comment%%` 行内注释** — 静默去除
- **`mermaid` 代码块视觉标记** — 橙色渐变 + 🧜 标签

---

## [1.20.0] - 2026-09-04

### Phase A.2 — 多笔记上下文

> **代号**: `multi-note-ctx`

### Added

- **当前笔记自动注入 chat 上下文**(前 5 个 chunk,score=1.0)
- `chat-panel.currentNotePath` property + `main.ts` 透传

---

## [1.19.0] - 2026-09-04

### Phase A.1 — Agent 工具扩充

> **代号**: `agent-tools-ext`

### Added

- **`get_chunk(path, idx)`** — 读单 chunk 全文
- **`list_tags(limit?)`** — 列所有 tag + 频次
- **`get_history(limit?)`** — 最近打开历史
- **`find_by_tag(tag, limit?)`** — 按 tag 找笔记
- 默认全部启用;`note_edit` 保留但需要手动开

---

## [1.18.0] - 2026-09-04

### Phase G.1 — 知识图谱视图

> **代号**: `graph-view`

### Added

- **`ll-graph-view` 组件** — 纯 SVG 力导向图谱
  - 节点 = 笔记(大小=反链数)
  - 边 = wikilink 引用(粗细=次数)
  - 颜色 = 顶层目录(10 色轮换)
  - hover tooltip + 点击跳转
- **工具栏 🕸 按钮** — 弹出全屏图谱 modal

### Notes

- 零新增依赖(纯 SVG)
- 简化力导向(按 group 圆形分布)
- 最大 200 节点(避免性能问题)

### 验收

- [x] SVG 图谱
- [x] 节点 + 边 + 颜色
- [x] 点击跳转
- [x] 工具栏入口
- [x] tsc 通过

---

## [1.17.0] - 2026-09-04

### Phase W.2 — Wiki MOC

> **代号**: `wiki-moc`

### Added

- **`generateNoteMoc(path)`** — 单笔记 MOC 生成
  - 4 类关联:backlinks / sameTag / parents / downstream
- **note-view 底部 MOC 渲染** — 反链 + 同目录 + 双向引用 + 同 tag
- **颜色区分**:目录(灰)/ 双向(黄)/ tag(绿)

### 验收

- [x] MOC 生成完整
- [x] note-view 集成
- [x] tsc 通过

---

## [1.16.0] - 2026-09-04

### Phase W.1 — 自动 Wiki 生成

> **代号**: `auto-wiki`
> **类型**: 用户体验升级

### Added

- **`wiki-auto.ts` 自动 Wiki 生成引擎**
  - `generateAutoWiki({ prefix, maxConcepts, maxMocs, maxTimeline })`
  - `renderAutoWikiAsMarkdown(wiki)` 导出 markdown
  - 概览/关键概念/MOC/时间线 4 个区块
- **wiki-panel Tab 切换**:`📊 总览` / `✨ 自动 Wiki`
- **自动 Wiki UI**:输入前缀 → 一键生成 → 5 个 badge + 4 个区块
- **MOC 折叠列表** + 时间线点击跳转笔记
- **💾 保存为 .md 文件** — 复用 export-service

### Notes

- L2 统计模式 ~50ms(vault 1000+ 笔记)
- L1 LLM 模式预留接口

### 验收

- [x] wiki-auto.ts 完整
- [x] UI 集成 + Tab 切换
- [x] 生成结果齐全
- [x] 点击跳转
- [x] 保存为 .md
- [x] tsc 通过

---

## [1.15.0] - 2026-09-04

### Phase R.4 — 流式引用侧栏

> **代号**: `stream-citations`
> **类型**: 用户体验升级(向后兼容)
> **亮点**: LLM 流式输出 [KB#N] 时实时新增引用卡片,点卡片跳到笔记 chunk

### Added

- **`liveCitations` state** — 流式实时聚合 `[KB#N]` 引用
- **`parseLiveCitations(fullText, kbCitations)`** — 正则匹配 + 去重 + 增量更新
- **`clearLiveCitations()`** — 每次新对话重置
- **`.citations-drawer` 抽屉** — 固定在屏幕右上角,实时显示引用卡片
- **抽屉动画**:滑入(`drawer-slide-in`) + 卡片飞入(`drawer-card-in`) + 流式呼吸(`pulse`)
- **联动 v1.14.0**:卡片点击 → open-citation(带 idx) → jump-to-chunk
- **发布说明文档**:`docs/releases/v1.15.0.md`

### Changed

- `src/components/chat-panel.ts`:
  - 流式循环每 delta 后调用 parseLiveCitations
  - render 末尾加抽屉 HTML
- `src/styles.css`:+ `.citations-drawer` / `.drawer-card` / 3 个 @keyframes

### Notes

- 零破坏性(无引用时不渲染 drawer)
- 性能:无新增不 setState
- 依赖 RAG prompt 必须输出 `[KB#N]` 格式

### 验收

- [x] 流式解析 + 去重
- [x] 实时新增
- [x] 抽屉 UI + 动画
- [x] 点击 → chunk 跳转联动
- [x] tsc 类型检查通过

---

---

## [1.14.0] - 2026-09-04

### Phase R.3 — Chunk 级跳转 + 高亮

> **代号**: `chunk-jump`
> **类型**: 用户体验升级(向后兼容)
> **亮点**: 点 chat 引用 / 搜索结果 → 跳到笔记对应 chunk + 黄色高亮 3 秒

### Added

- **chunk 锚点注入**(`renderer.ts`)
  - `ParseNoteOptions` 接口:`chunks[]` + `path`
  - `injectChunkAnchors()` 按段落边界轮流插 `<a data-cid="X">`
- **`note-view` 监听 `ll-jump-to-chunk` 事件**
  - 路径校验(不匹配则忽略)
  - `scrollIntoView({ behavior: 'smooth' })`
  - `.highlight-flash` class + 3 秒后移除
- **黄色高亮动画**(`@keyframes cid-flash`)
- **`main.ts.handleSelectDirect(path, idx?)`** + `dispatchJumpToChunk()`
- **`search-results.ts` onNoteOpen 签名扩展**:`(path, idx?)`
- **`chat-panel.ts` open-citation 事件**带 `idx` 字段
- **发布说明文档**:`docs/releases/v1.14.0.md`

### Changed

- `src/services/renderer.ts`:`parseNote()` 接受可选 opts
- `src/services/sync.ts`:`getNote()` 加载 chunks 并传入 parseNote
- `src/components/note-view.ts`:+ `handleJumpToChunk` + 高亮 timer
- `src/main.ts`:chat-panel listener 接收 idx
- `src/styles.css`:+ `.cid-anchor` / `.highlight-flash` / `@keyframes cid-flash`

### Notes

- 零破坏性(老调用不传 opts 跳过锚点注入)
- 包大小 +1 KB
- chunk 必须已索引(否则 console.warn)

### 验收

- [x] 渲染时插 data-cid 锚点
- [x] jump-to-chunk scroll + flash
- [x] 3 秒高亮动画
- [x] 搜索结果 + chat 引用都触发跳转
- [x] 路径校验
- [x] tsc 类型检查通过

---

---

## [1.13.0] - 2026-09-04

### Phase R.2 — 侧栏三 Tab 搜索 UI

> **代号**: `search-tabs`
> **类型**: 用户体验升级(向后兼容)
> **亮点**: 路径/全文/语义三 Tab 切换 + 结果卡片 + Cmd+K 快捷键

### Added

- **三 Tab 切换**:📂 路径 / 📖 全文 / 🧠 语义
- **`ll-search-results` 组件**(`src/components/search-results.ts`)
  - 结果卡片布局(标题 / heading / snippet / 路径 / score)
  - snippet 内 query token 高亮
  - 加载/空态/有结果三种状态
- **200ms 防抖全文/语义检索**(`scheduleSemanticSearch`)
- **Cmd/Ctrl + K 快捷键** — 聚焦搜索框
- **UI 偏好持久化**:localStorage `ll-sidebar-ui` { sidebarTab, useRerank }
- **Rerank 开关复用** — 全文/语义 Tab 时显示,共用 v1.12.1 设置

### Changed

- `src/main.ts`:
  - 新增 state: `sidebarTab` / `semanticResults` / `semanticLoading` / `useRerank`
  - 新增方法: `scheduleSemanticSearch` / `setSidebarTab` / `persistSidebarUI`
  - handleKeydown 增加 Cmd/Ctrl+K 分支
  - 侧栏 render 按 tab 分发(文件树 vs 结果列表)
- `src/styles.css`:+ ~150 行(tab / result-card / spinner 等)

### Notes

- 路径模式行为完全等同 v1.12.x(向后兼容)
- 包大小 +5 KB
- 检索性能:路径 < 10ms / 全文 ~50ms / 语义 ~100ms(无 Rerank)

### 验收

- [x] 三 Tab 切换正常
- [x] 全文/语义模式 bm25/hybrid 调用
- [x] snippet 高亮
- [x] 200ms 防抖
- [x] Cmd+K 快捷键
- [x] UI 偏好持久化
- [x] tsc 类型检查通过

---

---

## [1.12.2] - 2026-09-04

### Phase R.1.2 — Rerank 调优 + LRU 缓存层

> **代号**: `rerank-tune`
> **类型**: 性能优化(向后兼容)
> **亮点**: LRU 缓存 + 权重常量集中 + 命中率统计

### Added

- **`RERANK_WEIGHTS` 常量对象** — 调优一处生效
- **`LRUCache` 类**(私有,单例 `_cache`)— 100 条上限 + 30 分钟 TTL
- **`getCacheStats()`** — 返回 `{ size, hits, misses, hitRate, evictions }`
- **`clearRerankCache()`** — 清空缓存
- **`RerankOptions.skipCache?: boolean`** — 调试用,跳过缓存
- **`RerankStats.cacheHit?: boolean`** — 记录是否命中缓存
- **发布说明文档**: `docs/releases/v1.12.2.md`

### Changed

- `src/lib/reranker.ts`:
  - 文件顶部新增 `RERANK_WEIGHTS` 常量
  - 新增 `LRUCache` 类 + 单例 `_cache`
  - `bm25RescoreOne` 改用 `RERANK_WEIGHTS.*` 替代散落魔数
  - `rerank()` 主入口接入缓存(读+写)

### Notes

- 重复 query 缓存命中:~5ms(原 ~1500ms)
- 30 分钟内反复查 vault,典型命中率 60-80%
- 内存占用 < 1 MB
- 零破坏性,原调用代码无须改动

### 验收

- [x] LRU 缓存实现完整
- [x] 权重常量集中
- [x] 命中率日志
- [x] 零破坏性
- [x] tsc 类型检查通过

---

---

## [1.12.1] - 2026-09-04

### Phase R.1.1 — Rerank UI 接入

> **代号**: `rerank-ui`
> **类型**: 小版本(向后兼容)
> **亮点**: chat-panel UI 接入 Rerank 开关,Agent 路径同步支持

### Added

- **chat-panel 设置面板**:新增 Rerank checkbox + TopN 输入
- **`useRerank` state**(默认 `false`,保持向后兼容)
- **`rerankTopN` state**(默认 `10`)
- **`persistRerank()` 方法**:localStorage key `ll-chat-rerank`
- **`AgentContext` 新增字段**:`searchMode` / `useRerank` / `rerankTopN`
- **Agent 透传**:`kb_search` 工具复用 chat-panel 的 Rerank 设置
- **发布说明文档**: `docs/releases/v1.12.1.md`

### Changed

- `src/components/chat-panel.ts`:
  - kbSearch 调用新增第 7 参数 `rerankOpts`
  - 设置面板新增 Rerank 控件
  - `connectedCallback` 从 localStorage 恢复
- `src/lib/agent.ts`:
  - `AgentContext` 接口扩展
  - `kbSearchTool.execute` 透传 settings

### Notes

- 零破坏性(useRerank 默认 false)
- 首次启用 Rerank 触发 cross-encoder 模型懒下载(~25MB)
- 开启后 chat 略慢 ~1.5s

### 验收

- [x] chat-panel UI Rerank 控件
- [x] localStorage 持久化
- [x] Agent 路径透传
- [x] 默认关闭(向后兼容)
- [x] tsc 类型检查通过 (exit 0)
- [ ] 真机验证 Rerank 效果(开发者本地)

---

## [1.12.0] - 2026-09-04

### Phase R.1 — Cross-Encoder Rerank 上线

> **代号**: `rerank-mvp`
> **类型**: 检索增强(非破坏性)
> **亮点**: 三档降级 Rerank(cross-encoder → BM25 重打分 → passthrough),永不抛错

### Added

- **Rerank 引擎** (`src/lib/reranker.ts`)
  - Level 1: `@xenova/transformers` + `Xenova/ms-marco-MiniLM-L-6-v2`(按需懒下载 ~25MB)
  - Level 2: 零依赖 BM25 重打分(标题 ×3 / heading ×2 / 内容 ×1)
  - Level 3: passthrough 兜底
  - 3 秒硬超时保护
  - 接口:`rerank(query, results, opts?) => SearchResult[]`
- **`search()` 签名扩展**:新增第 7 个可选参数 `rerankOpts`,向后兼容
- **`searchHybrid()` 自动调用 rerank**:在 RRF 融合后 + maxChars 截断前
- **`getRerankerStatus()`**:UI 查询 L1 模型可用性
- **`_resetRerankerForTests()`**:测试钩子,清空懒加载缓存
- **发布说明文档**: `docs/releases/v1.12.0.md`

### Changed

- `src/lib/search.ts`:
  - 新增 `import { rerank as doRerank, type RerankOptions } from './reranker'`
  - `searchHybrid` 函数签名扩展为 `(query, k, maxChars, paths, rerankOpts?)`
  - 文件注释加注 `v1.12.0 Phase R.1`
- `package.json` version: `1.11.12` → `1.12.0`

### Notes

- 零新增依赖(复用 `@xenova/transformers`)
- 包大小:`reranker.ts` ~10KB,模型按需下载不影响主包
- 默认关闭 Rerank,需在 chat-panel 设置中开启(下一版本)

### 验收

- [x] 三档降级实现完整
- [x] 永不抛错,失败自动降级
- [x] 3 秒硬超时保护
- [x] 向后兼容(默认行为不变)
- [ ] chat-panel UI 接入(v1.12.1)
- [ ] APK build 验证(开发者本地)

---

## [1.11.12] - 2026-09-03

历史版本(未详细记录)。已知能力:
- BM25 + 向量(char n-gram) RRF 混合检索
- 文档切分(chunks,~500 字/段)
- ReAct Agent + 5 个工具(kb_search / web_search / note_open / list_files / note_edit)
- 多会话对话(chat-panel + sessions)
- 长期记忆(memoryTopics / memoryItems)
- 流式 LLM 输出
- Obsidian wikilink / callout 渲染
- 5 主题 + 8 项自定义
- 本地 PDF / EPUB / DOCX 解析
- 同步历史、Wiki 主页、节点 CRUD

---

## 版本约定

| 类型 | 规则 | 例 |
|---|---|---|
| **Major(2.x)** | 重大架构变更,需要数据迁移 | — |
| **Minor(1.x)** | 新功能(向后兼容) | 1.12.0 |
| **Patch(1.x.y)** | Bug fix 或小幅优化 | 1.12.1 |

## 阶段代号

| 代号 | 含义 |
|---|---|
| `Phase R` | Retrieval 检索增强 |
| `Phase W` | Wiki 自动归纳 |
| `Phase G` | Graph 知识图谱 |
| `Phase A` | Agent 工具扩展 |
| `Phase O` | Obsidian 语法补全 |
| `Phase X` | eXport 导出能力 |

---

## 链接

- [最新发布说明](./docs/releases/)
- [ROADMAP-V52-V60.md](./docs/ROADMAP-V52-V60.md)(待编写)
- [README.md](./README.md)
