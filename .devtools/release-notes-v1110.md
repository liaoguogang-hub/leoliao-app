# v1.11.0-local-files-vault — 本地参考库同步进 vault + UI 面板

🎉 V53 PDF / EPUB 索引自动存 md 进 vault + 新增本地参考库面板

## 🟦 新功能

### 1. PDF / EPUB 自动存 md 进 vault

之前 v1.10.0 起的 PDF / EPUB 索引**只**写 Dexie `chunks` + `chunkVectors`,不显示在文件树、不同步 OSS。现在 **V51** 改为索引完成后**自动**存一份 md 进 vault:

- **PDF**:`📕 gh00-test.pdf.md`(或 `📕 江西省带量采购.pdf.md`)
- **EPUB**:`📘 鬼笑石.md`(或 `📘 流俗地.md`)
- 内容:
  ```markdown
  ---
  local-file: pdf
  original-name: gh00-test.pdf
  chunks: 7
  total-chars: 2557
  ---

  # 📕 gh00-test

  > 🤖 本地 PDF 自动入库(v1.10+)
  > 共 7 页 / 2557 字 / 7 chunks
  > 原文:gh00-test.pdf

  ## 第 1 页
  ...
  ## 第 2 页
  ...
  ```
- **路径用 emoji 前缀**(`📕` / `📘`),跟 Dexie chunks 路径一致,跟 vault 其他笔记区分
- **vault 文件树**自动出现 `📕 gh00-test.pdf.md`
- **sync.ts**自动上传 OSS(下次 sync 时)
- **再次打开同 PDF** → `saveNote` 用 `path` 唯一键覆盖更新(不重复)
- **章节格式**:`## 第 N 页`(PDF)/ `## chapter title`(EPUB),跟 `chunkDocument` 输入格式一致

### 2. 本地参考库 UI 面板

新组件 `ll-local-files-panel`(类似 `ll-history-panel`),从 Dexie 聚合所有 `📕` / `📘` 前缀 chunks,按文件分组显示。

**入口**:工具栏 `📚` 按钮(在 `🕘` 历史旁边)

**显示内容**:
```
▼ 📕 PDF
   gh00-test.pdf       7 chunks · 2,475 字
   最近索引:9/3 07:19
   章节预览:
   • ## 第 1 页
   • ## 第 2 页
   • ## 第 3 页
   💡 vault 中对应 md:📕 gh00-test.pdf.md
```

**特性**:
- 按最近索引时间倒序
- 点击展开看 chapter 预览
- 提示对应 vault md 路径
- 不污染 sync / 不写 vault 文件树外的列表

## 🔧 改动

- `src/services/file-opener.ts`:
  - `indexLocalPdf` 末尾 `saveNote` 存 vault md(带 frontmatter + 全文字符串)
  - `indexLocalEpub` 末尾同样存 vault md
- `src/components/local-files-panel.ts`:新组件(Dexie 直查,聚合 📕 / 📘 chunks)
- `src/main.ts`:import + `showLocalFiles` state + 工具栏 `📚` 按钮 + panel 挂载 + Esc 关闭

## 📦 验证

- 真机 `M4T0224612003168`:
  - 自动 fetch `https://localhost/test.pdf` 触发 renderPdf
  - Dexie `chunks`: 7 条
  - Dexie `chunkVectors`: 7 条  
  - Dexie `notes`: `📕 gh00-test.pdf.md` (2737 字,frontmatter ✅)
  - UI 面板点 `📚` → 列出 `📕 gh00-test` card ✅
- 真机《2026年医药研发年度报告》88 页:117 chunks + vault note(57328+frontmatter 字)

## 🔗 链接

- Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.11.0-local-files-vault
- 父版本: v1.10.3-pdf-path-fix
- APK: `app-debug.apk`(versionName 1.11.0, versionCode 8)

## 📝 v1.12 候选

- 本地参考库面板:加删除按钮(清 Dexie chunks + vault note)
- settings:本地文件**不**自动存 vault 的 toggle(默认开)
- 工具栏 `📚` 按钮加未读角标(未索引文件数量)
- chunker 优化:大 PDF (88 页 117 chunks) 切得跨页太多,改用 smart merge 减少 chunks 数
- 给本地 PDF / EPUB 加引用卡片页码 / 章节跳转(原始 plan 列表里的 v1.11 候选)