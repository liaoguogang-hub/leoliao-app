# v1.10.0-epub — EPUB 入 KB 检索 + release.ps1 自动版本号同步

🎉 V50 EPUB 加入本地知识库,发版脚本现在自动维护 npm + Android 版本号一致

## ✨ 新功能

#### 1. EPUB 文件入 KB 检索
- 工具栏 `📂` 现支持 `.epub`(MimeType `application/epub+zip`)
- 用 JSZip 解 zip + DOMParser 解析 OEBPS 结构(META-INF/container.xml → OPF → spine)
- 按 spine 顺序遍历所有 XHTML 章节,DOMParser 提纯文本
- 单章节解析失败 `console.warn` 跳过(全书失败 catch 不 throw,不阻塞渲染)
- 拼接 `\n\n## {chapter title}\n\n{text}` 喂 chunker(500-800 字/块)+ char n-gram 256 维向量
- path 命名 `📘 xxx.epub`,与 PDF `📕` 并列;search.ts 一并过滤(includeLocal 控制)
- 加密 / 纯图 EPUB graceful 跳过 + `console.log` 提示(留 TODO: 后续可加 unicode sanity check 排除乱码)
- 真机触发链: 工具栏 `📂` → pickAndOpenFile → renderBytes switch `epub` → renderEpub → 后台 fire-and-forget indexLocalEpub
- 完全平行 v1.9 PDF 链路(同样走 Dexie `chunks` + `chunkVectors` 表, schema v8 不变)

#### 2. 发布脚本自动版本号同步
- `release.ps1` 新增 `[1/8] bump version` 步骤(原 `[1/7]`–`[7/7]` 顺移到 `[2/8]`–`[8/8]`)
- 从 git tag 自动提 semver(`v1.10.0-epub` → `1.10.0`),slug 只用作 tag / gh title 不入 versionName
- 自动改 `package.json` 的 `version` + `android/app/build.gradle` 的 `versionCode` (5 → 6) + `versionName`
- `-DryRun` 参数: 只打印不改文件 + 不 git + 不 gh(用来 preview 检查)
- 失败自动回滚(改前内容快照 + catch 还原,不污染工作区)
- 幂等: 已同步则跳过(支持重跑)

## 🔧 改动

```
[填实际 git diff --stat + 真实 commit hash]
```

| 文件 | 改了什么 |
|---|---|
| `package.json` | +`jszip@^3.10.1` dep, version 1.1.2 → 1.10.0 |
| `android/app/build.gradle` | versionCode 5 → 6, versionName "1.1.2" → "1.10.0" |
| `release.ps1` | +`[1/8] bump version` 步骤 + `-DryRun` 参数;步骤编号 [1/7]–[7/7] → [2/8]–[8/8] |
| `src/services/file-opener.ts` | +import JSZip, +PICK_TYPES (epub+zip), +guessMime (epub), +`renderEpub()` + `indexLocalEpub()`, +renderBytes switch `case 'epub'` |
| `src/lib/search.ts` | line 112 前缀过滤加 `📘` (与 PDF `📕` 并列) |
| `src/main.ts` | line 662 工具栏 title 加 `pdf/epub` |
| `.devtools/verify-v110.mjs` | 新增 CDP 端到端(EPUB 索引 + Dexie 验证) |
| `.devtools/release-notes-v110.md` | 新增(本文件) |
| `.gitignore` | +`.devtools/*.png` + 历史一次性 verify 屏蔽 |
| `.devtools/v120-{3..8}.png` | 删除 6 个 0 字节空 PNG |

## 📦 验证

- 真机 `M4T0224612003168`(华为 ALN-AL10P, Android 14)
- CDP 端到端 `verify-v110.mjs`:
  - ✅ Dexie schema 验证(`chunks` / `chunkVectors` 表存在)
  - ✅ `📘 sample.epub` chunks 灌入 + 重新打开验证(2 条,内容含 `philosophy` 关键词)
  - ✅ chunkVectors 256 维向量同步
  - ✅ includeLocal checkbox UI 状态正常
  - ✅ NO_ERRORS
- typecheck + vite build: pass (4.42s, 2.24 MB bundle)
- release.ps1 DryRun 验证 bump version 逻辑(不实际写文件)
- v1.9 PDF 回归: `📕 xxx.pdf` 仍可检索(只加 `📘` 过滤不删旧数据)

## 🔗 链接

- Release: [URL 占位, 发版后填]
- Commit: [hash 占位]
- APK: `app-release.apk`(versionName 1.10.0, versionCode 6)

## 📝 v1.11 候选

- PDF / EPUB 增量索引(只重 index 改动页 / 改章节,不全删全建)
- 检索结果按 `📕` / `📘` emoji 分组显示
- 给本地 PDF / EPUB 加引用卡片页码 / 章节跳转
- EPUB 加密 / 乱码 unicode sanity check(目前只 console.log)
- JSZip 直接 inline(去掉运行时 import 路径,减小 bundle ~150KB)
- 给 release.ps1 加 `--skip-push` / `--skip-tag` 参数