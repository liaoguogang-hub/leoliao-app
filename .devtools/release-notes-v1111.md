# v1.11.1-vault-search-local — vault 搜索框支持本地 PDF/EPUB notes

🎉 V54 修 vault 搜索框找不到本地自动存的 PDF/EPUB notes

## 🐛 Bug

v1.11.0 起 PDF/EPUB 打开时自动存一份 md 进 vault(`📕 xxx.pdf.md` / `📘 xxx.epub.md`),但 **vault 文件树搜索框搜不到**这些本地 note。原因:

- vault 搜索框 `displayEntries` 只过滤 `allEntries`(来自 `loadManifest()`,即 OSS 同步的 manifest)
- 本地直接写进 Dexie `notes` 表的 `📕 / 📘` entries **没经 OSS 上传**,不在 manifest 里
- **chat 检索**(`search lib`)是直接查 Dexie `chunks`,能搜到;但 **vault 文件树搜索框**走 manifest 缓存,搜不到

## 🛠 修法

`src/main.ts` 加 `localNoteEntries` getter + `loadLocalNotes()`:

```typescript
/** 首次启动 / sync / rename / delete / create 后从 Dexie notes 表读本地 PDF/EPUB */
private async loadLocalNotes(): Promise<void> {
  const all = await db.loadAllNotes();
  const map = new Map();
  for (const n of all) {
    if (!n.path.startsWith('📕') && !n.path.startsWith('📘')) continue;
    map.set(n.path, { content: n.content, mtime: n.mtime, hash: n.hash });
  }
  this.__localNotesMap = map;
}

private get localNoteEntries(): ManifestEntry[] {
  // 把 Dexie 里 📕 / 📘 notes 转成 ManifestEntry 格式
  // displayEntries 把它们合并到 allEntries
}
```

**触发点**:`runSync` 末尾 + `renameNote` + `deleteNote` + `createNote` 后都调一次,保证 vault manifest 跟本地 notes 同步。

## 🔧 改动

- `src/main.ts`:
  - +`loadLocalNotes()`:从 Dexie `notes` 读 📕 / 📘 前缀,缓存到 `__localNotesMap`
  - +`localNoteEntries` getter:转 ManifestEntry 格式注入文件树
  - `displayEntries` getter:`merged = [...allEntries, ...localNoteEntries]`,搜索过滤用 merged
  - `runSync` / `renameNote` / `deleteNote` / `createNote` 后 await loadLocalNotes

## 📦 验证

- 真机 `M4T0224612003168`:
  - `📕 gh00-test.pdf.md` 在 Dexie `notes` 表 ✅
  - vault 搜索框输入 "gh00" → 1 个匹配 `📕 gh00-test.pdf.md` ✅
  - 同步 `📕/📘` notes 文件树正常

## 🔗 链接

- Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.11.1-vault-search-local
- 父版本: v1.11.0-local-files-vault
- APK: `app-debug.apk`(versionName 1.11.1, versionCode 9)