# v1.4.0-chunk-rag — Chunk 切分 + KB 检索范围选择

🎉 V44 检索粒度从"整篇文档"升级到"chunk(~500字)"

## ✨ 新功能

#### 1. Chunk 切分引擎
- 新建 `src/services/chunker.ts`:按**二级标题 + 段落**切分
- 每 chunk 目标 500-800 字,100 字 overlap
- Dexie v6 新增 `chunks` 表(主键 `[path+idx]`,path 索引)
- sync.ts 同步完成后自动全量 reindexChunks
- 实测: **1313 notes → 17734 chunks**(平均 13.5 chunks/篇,~360 字/chunk)

#### 2. 检索改用 chunks
- `src/lib/search.ts` 重写:BM25 打分对象从整篇 → chunk
- 返回结果含 `heading`(所属二级标题),UI 可显示"小节"
- `buildFullRAGPrompt` 升级:prompt 注入"小节"上下文
- LLM 引用更精准,幻觉减少

#### 3. KB 检索范围选择
- chat 设置面板加 `📁 KB 检索范围` 按钮
- 弹 modal 多选 187 个目录
- 支持 `全选 / 全部清除 / 完成`
- send 把 `searchPaths` 传给 `kbSearch()`,精准限定 RAG 范围
- 例:只看 `01.公众号/` 不看 `02.技术/`

## 🔧 改动

```
6 files changed, 423 insertions(+), 55 deletions(-)
commit e0c2a5c
```

| 文件 | 改了什么 |
|---|---|
| `src/services/chunker.ts` | **新增**:`chunkDocument()` + `splitByHeadings()` + `splitByParagraph()` + `chunkHash()` |
| `src/lib/search.ts` | 重写 search() 走 chunks;buildRAGPrompt 加 heading |
| `src/services/db.ts` | Dexie v6 + `chunks` 表 + 3 API (saveChunks/loadAllChunks/deleteChunksForNote) |
| `src/services/sync.ts` | runSync 后调 `reindexChunks()` |
| `src/components/chat-panel.ts` | +`searchPaths` + `allDirs` + `refreshDirs()` + picker modal |
| `src/styles.css` | +`.btn-path-pick` + `.path-picker-list` |

## 📦 验证

- 真机 `M4T0224612003168`
- CDP 端到端:
  - ✅ `[sync] chunked: 1313 notes → 17734 chunks`
  - ✅ path picker 显示 **187 个目录**
  - ✅ 选第一个 → `📁 1 个目录` 反馈
  - ✅ NO_ERRORS
- typecheck: pass

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.4.0-chunk-rag
- Commit: `e0c2a5c`
- APK: `app-release.apk`