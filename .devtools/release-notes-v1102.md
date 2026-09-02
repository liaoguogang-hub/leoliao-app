# v1.10.2-pdf-fix — PDF.js 降级 + polyfill

🎉 V52 修 PDF.js 6.x 在 webview 完全无法工作 + 真机沙漏卡死

## 🐛 Bug 修复

真机测试 v1.10.1 时打开 PDF(《20190901 江西省药品带量采购...》):
- `Promise.withResolvers is not a function` (PDF.js 6.x 用 ES2024 API)
- `Promise.try is not a function` (同样 ES2024)
- `Cannot destructure property 'docId' of 'e' as it is undefined` (PDF.js fake worker 兜底 bug)
- "沙漏"卡死 (worker fetch 不稳 + fake worker 也不工作)

### 修法 — 降级 PDF.js 6.3.289 → 3.11.174

| 改动 | 修复 |
|---|---|
| `pdfjs-dist@^3.11.174` | 3.x 不用 ES2024 API,不依赖 worker fetch,直接主线程跑 |
| `index.html` polyfill | `Promise.withResolvers` + `Promise.try` 兜底(其他 lib 可能也用到) |
| `file-opener.ts` `getPageTextContent` → `getTextContent` | 3.x API 改名 |
| `file-opener.ts` `render({canvas})` → 去 canvas | 3.x RenderParameters 没有 canvas 字段 |
| `file-opener.ts` 暴露 `__debugRenderPdf` | webview CDP 可跳过 FilePicker 直接渲染测试 PDF |

### 验证

- 真机 `M4T0224612003168` 测试《gh00 发刊词 懂欧洲,你才懂世界.pdf》:
  - **7 页全部加载,前 5 页渲染 PNG,完整**
  - **文字提取 2557 字,7 chunks 入 Dexie**
  - verify-v110.mjs 5 探针全过

## 🔧 改动

- `package.json` — `pdfjs-dist: 6.3.289 → 3.11.174`(bundle -1.4MB)
- `src/services/file-opener.ts`:
  - `pdfjs-dist/build/pdf.worker.min.mjs` → `.min.js`(3.x 用 .js)
  - `getPageTextContent` → `getTextContent`(3.x API)
  - `render({canvas})` → `render({canvasContext, viewport})`(3.x 不需要 canvas)
  - +`__debugRenderPdf` 暴露到 `window.__leoliaoDebug.renderPdf`
- `index.html` + Promise.withResolvers / Promise.try polyfill(向后兼容)
- `.gitignore` + `public/test.pdf` 屏蔽(本地测试 PDF 不入仓)

## 📦 验证

- 真机 `M4T0224612003168`(华为 ALN-AL10P, Android 14)
- CDP 端到端 verify-v110.mjs: 全过
- 真机《gh00 发刊词》PDF(409KB): 7 页,2557 字,7 chunks
- typecheck + vite build: pass
- bundle size: 2.10MB → 2.06MB(更小,因 3.x 精简)

## 🔗 链接

- Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.10.2-pdf-fix
- 父版本: v1.10.1-epub-fix(EPUB 索引已修,PDF 渲染待修)
- APK: `app-debug.apk`

## 📝 已知 TODO

- PDF 文字提取对扫描版(纯图)无效,需要 OCR(超出 v1.10 范围)
- worker 路径在 Vite build 后哈希文件名,未来升级 PDF.js 4.x+ 要重新配置
- v1.11 候选继承 v1.10.1 列表