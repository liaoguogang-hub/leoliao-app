# v1.8.0-hybrid-search — 混合检索(BM25 + 向量 + RRF)

🎉 V48 检索质量从 BM25 only 升级到 混合检索(框架完整,可后续换 ONNX embedding)

## ✨ 新功能

#### 1. Embedding 引擎(`src/services/embedder.ts`)
- char n-gram (2-4) + djb2 hash + L2 归一化 → 256 维 Float32Array
- 0 网络依赖、0 模型下载、<10ms / 1000 chunks
- `cosineSimilarity` / `topKByVector` / `rrfFuse` 完整工具集

#### 2. Dexie v8 新表
- `chunkVectors`: 主键 `[path+idx]`, 存 Float32Array vec
- 5 API: load / save / delete / count / total

#### 3. 混合检索(`src/lib/search.ts`)
- `search()` 加 `mode` 参数:`'bm25' | 'vector' | 'hybrid'`
- `searchHybrid()` = BM25 top50 + 向量 top50 → RRF 融合 → topK
- `buildVectorIndex()` 批量 embed 所有 chunks

#### 4. chat-panel UI
- 新增"🔀 检索模式"select(混合 / BM25 / 向量)
- 默认 hybrid

#### 5. 自动建索引
- sync 完成后,后台异步 buildVectorIndex(不阻塞 UI)

## 🔧 改动

```
7 files changed, 1042 insertions(+), 15 deletions(-)
新增文件: src/services/embedder.ts
新增依赖: @xenova/transformers@^2.17.2 (框架留位)
commit ffe565e
```

| 文件 | 改了什么 |
|---|---|
| `src/services/embedder.ts` | **新增** 4 函数 (98 行) |
| `src/lib/search.ts` | 重构: 3 个 search 函数 + buildVectorIndex + vectorIndexStatus |
| `src/services/db.ts` | Dexie v8 + chunkVectors 表 + 5 API |
| `src/services/sync.ts` | sync 完成后调 buildVectorIndex |
| `src/components/chat-panel.ts` | searchMode state + settings UI |
| `package.json` / `package-lock.json` | +@xenova/transformers |

## 📦 验证

- 真机 `M4T0224612003168`
- CDP 端到端:
  - ✅ chat panel 注册
  - ✅ 检索模式 select 显示 3 选项
  - ✅ 默认 selected="hybrid"
  - ✅ `[sync] vector indexed: 17734/17734 chunks` — **17734 个向量全部建好**
  - ✅ NO_ERRORS
- typecheck: pass

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.8.0-hybrid-search
- Commit: `ffe565e`
- APK: `app-release.apk`

## 📝 v1.9 升级路径

`@xenova/transformers` 已装(框架留位),v1.9 可平滑升级:
- 把 `embedText(text)` 换成 `await pipeline('Xenova/bge-small-zh-v1.5')(text, { pooling: 'mean' })`
- 256 维 → 512 维, 真正的 CJK embedding
- 首次加载会从 HuggingFace 下载 ~50MB 模型(需用户主动触发)