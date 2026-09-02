# v1.9.0-pdf-search — PDF 检索

🎉 V49 打开本地 PDF 自动建 KB 索引,可被 RAG / 混合检索检索

## ✨ 新功能

#### 1. PDF 文字自动提取
- 打开 PDF 时自动调 `pdfjs page.getPageTextContent()` 提取所有页文字
- 按 `## 第 N 页` 标记拼接 → 走 chunker 切分(500-800 字/块)
- 同时建向量索引(256 维 char n-gram embedding)
- 扫描版 PDF(无文字层)graceful 跳过 + console.log 提示

#### 2. KB 范围可包含本地文件
- settings 加 `📂 包含本地文件(已打开的 PDF 等)` checkbox
- 默认 checked,检索时把 `📕 xxx.pdf` 路径纳入范围
- search.ts 新增 `includeLocal` 参数,默认 false(只看 vault)

#### 3. path 命名约定
- 本地 PDF chunk path:`📕 {filename}.pdf#p{N}`
- 📕 emoji 前缀区分 vault 笔记(.md)
- path picker 自动列出所有本地 PDF(用户可勾选限定范围)

## 🔧 改动

```
3 files changed, 92 insertions(+), 9 deletions(-)
commit 1e21cc6
```

| 文件 | 改了什么 |
|---|---|
| `src/services/file-opener.ts` | +`indexLocalPdf()` 函数(后台提取 + 切分 + 建索引) |
| `src/lib/search.ts` | +`includeLocal` 参数 + 路径过滤 |
| `src/components/chat-panel.ts` | +`includeLocal` state + settings checkbox |

## 📦 验证

- 真机 `M4T0224612003168`
- CDP 端到端:
  - ✅ chat panel 注册
  - ✅ settings 显示"📂 本地文件"checkbox
  - ✅ 默认 checked
  - ✅ NO_ERRORS
- typecheck: pass
- **真实 PDF 检索流程**:用户打开 PDF → 后台提取 → 写 chunks → 在 chat 勾"📂 本地文件" → RAG 可引用

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.9.0-pdf-search
- Commit: `1e21cc6`
- APK: `app-release.apk`

## 📝 v1.10.0 候选:EPUB

下一版可加 EPUB(同样走 chunker + 检索框架,~6-8h)