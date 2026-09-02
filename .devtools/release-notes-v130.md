# v1.3.0-kb-crud — KB CRUD 完整闭环

🎉 V43 KB 管理从"只读"升级到"可增删改"

## ✨ 新功能

#### 1. file-tree 节点操作菜单
- **长按 600ms** 或 **右键** 触发
- 文件节点菜单：`✏️ 重命名` / `📁 移动到…` / `🗑 删除`
- 文件夹节点菜单：`➕ 新建子笔记` / `✏️ 重命名文件夹` / `🗑 删除`
- 移动超过 10px 自动取消长按（防误触）
- 派发 `node-action` CustomEvent 到 main.ts

#### 2. note-view 编辑模式
- 顶部 toolbar：`[✏️ 编辑]` ↔ `[取消] [💾 保存]`
- 编辑模式下：
  - 8 个 markdown 按钮：H1/H2/**粗体**/*斜体*/🔗链接/•列表/`代码`/>引用
  - textarea + 实时 markdown 预览（split）
  - 字数统计 + 已保存/未保存标记
  - 修改未保存时退出提示
- 保存：写 Dexie + 更新 manifest + 刷新当前笔记
- 派发 `note-save` CustomEvent

#### 3. + 新建笔记
- 工具栏 ➕ 按钮 / 文件夹菜单 "新建子笔记"
- 弹 modal 输入路径（含文件夹）
- 模板选择：`空白` / `简单模板`
- 自动打开新建的笔记

#### 4. 共享 modal 组件
- `新建 / 重命名 / 移动到` 共用 `renderActionModal()`
- 自动聚焦输入框 + 验证
- 移动到：列出所有现有目录

## 🔧 改动

```
5 files changed, 761 insertions(+), 15 deletions(-)
commit 6ede13b
```

| 文件 | 改了什么 |
|---|---|
| `src/components/file-tree.ts` | +`ctxMenu` state + `onContextMenu`/`onTouchStart`/`emitAction` + `renderCtxMenu` |
| `src/components/note-view.ts` | +`editing`/`draft`/`saveStatus` state + `enterEdit`/`cancelEdit`/`saveEdit`/`insertAtCursor` + 完整 edit 渲染分支 |
| `src/main.ts` | +5 state + 6 methods (`onNodeAction`/`handleDelete`/`handleRenameSubmit`/`handleMoveSubmit`/`handleCreateNote`/`onNoteSave`) + `renderActionModal` + ➕ 按钮 + 事件绑定 |
| `src/services/db.ts` | +`renameNote()` + `deleteManifestEntry()` |
| `src/styles.css` | +`.ctx-menu` / `.note-actions` / `.note-btn` / `.note-toolbar` / `.tb-btn` / `.note-editor-textarea` / `.note-preview` / `.modal-overlay` / `.modal-box` 全套样式 |

## 📦 验证

- 真机 `M4T0224612003168`（华为 ALN-AL10P, Android 14）
- CDP 端到端：
  - ✅ ctx-menu 触发：dispatched → 3 项菜单显示
  - ✅ 打开笔记：title 显示正确
  - ✅ 编辑模式：editing=true, textarea=true, toolbar=8 按钮, saveBtn+cancelBtn+preview
  - ✅ 保存：editing=false, notice "💾 已保存"
  - ✅ 新建 modal：title="➕ 新建笔记", pathInput + templateSelect
  - ✅ NO_ERRORS
- typecheck: pass

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.3.0-kb-crud
- Commit: `6ede13b`
- APK: `app-release.apk`