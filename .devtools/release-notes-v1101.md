# v1.10.1-epub-fix — EPUB 索引 webview 兼容性补丁

🎉 V51 修 EPUB 在 webview 里 JSZip 完全无法解析(5 个嵌套 bug)

## 🐛 Bug 修复

真机测试 v1.10.0 时发现:用户打开任何合法 EPUB(《鬼笑石》《汴京之围》《互联网+战略版》等)都被 `indexLocalEpub` 判定为"不是合法 EPUB"。根因是 JSZip 在 webview build(Vite 打包 + Capacitor WebView)里有 5 个嵌套问题。

### 5 个嵌套 bug + 修复

| # | 问题 | 修复 |
|---|---|---|
| 1 | `Object.keys(zip.files)` 返回 toString'd Uint8Array 字符串(逗号分隔 ASCII) | 用 ASCII 码反查解码还原真实路径 |
| 2 | `zip.file(stringPath)` 找不到(内部 hash 用原 rawKey) | 直接用 rawKey 调 `zip.file(rawKey)` |
| 3 | `entry.async('string')` 也返回 toString'd 数组 | 改用 `async('uint8array')` + TextDecoder |
| 4 | DOMParser 不识别 EPUB OPF namespace `<package xmlns="...">` | 加 `getElementsByTagNameNS` + `getElementsByTagName` fallback |
| 5 | media-type regex `/(xhtml\|html)$/` 不匹配 `application/xhtml+xml`(末尾是 xml) | 改成子串匹配 `/(xhtml\|html)/` |

### 验证

- 真机 `M4T0224612003168` 测试《鬼笑石(全二册)-呼延云.epub`:
  - **索引 29/30 章,432,347 字,704 chunks**(之前 0 章)
- EPUB 共 60 文件全部正确解析
- 容错:无 META-INF/container.xml / 无 rootfile[full-path] / 无 OPF / 无章节都 graceful skip + console.warn

## 🔧 改动

- `src/services/file-opener.ts` — indexLocalEpub 全部重写,加 webview JSZip 兼容性层
- `.devtools/diag-now.mjs / diag-xhtml.mjs` — 调试用(不入仓)

## 📦 验证

- 真机 `M4T0224612003168`(华为 ALN-AL10P, Android 14)
- CDP 端到端 `verify-v110.mjs`:
  - ✅ Dexie schema 验证(`chunks` / `chunkVectors` 表存在)
  - ✅ `📘 sample.epub` chunks 灌入 + 重新打开验证(2 条,内容含 `philosophy` 关键词)
  - ✅ chunkVectors 256 维向量同步
  - ✅ includeLocal checkbox UI 状态正常
  - ✅ NO_ERRORS
- typecheck + vite build: pass (0 error)
- 真机《鬼笑石》EPUB: 29/30 章,432,347 字,704 chunks

## 🔗 链接

- Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.10.1-epub-fix
- 父版本: v1.10.0-epub(已发,索引功能框架在,webview 解析失败)
- APK: `app-debug.apk`(5.46 MB, versionName 1.10.1, versionCode 7)

## 📝 已知 TODO(v1.11 候选,继承 v1.10)

- DRM 加密 EPUB unicode sanity check(目前只 console.log)
- PDF / EPUB 增量索引(只重 index 改动页/章节)
- 检索结果按 `📕` / `📘` emoji 分组
- 引用卡片页码 / 章节跳转
- JSZip 直接 inline(去掉运行时 import 路径,减小 bundle)
- release.ps1 加 `--skip-push` / `--skip-tag` 参数
- **V50.1 兼容层可以精简**:Node.js 路径也走 rawKey 路径,统一逻辑不分支