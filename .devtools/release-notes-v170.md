# v1.7.0-wiki — Wiki 模式

🎉 V47 跨笔记主题关联 — vault 全貌、双向链接、Tag 索引

## ✨ 新功能

#### 1. Wiki 主页（工具栏 📖 按钮）
- **8 个统计卡片**:笔记 / chunks / wikilinks / 反向链接 / tags / 文件夹 / 总大小 / 平均笔记
- 🏷️ **Tag 索引**:按使用次数排序,展开看该 tag 下所有笔记
- 🕐 **最近更新**(20 篇网格卡片)
- 🔗 **反向链接查询**:输入笔记名 → 显示所有引用 + context
- 🕳️ **孤立笔记列表**:没 wikilink 出/进的待整理笔记

#### 2. Wiki service（`src/services/wiki.ts`）
- `backlinks(path)` — 找出所有引用了 path 的笔记 + context(包含 wikilink 的行)
- `tagIndex()` — 按 frontmatter.tags 分组
- `vaultStats()` — 8 项统计
- `recentNotes(limit)` — 最近更新
- `orphanNotes()` — 孤立笔记

#### 3. note-view 反向链接面板
- note 切换时自动加载 backlinks
- footer 加 "🔗 被 N 篇引用" 区域
- 每个 backlink 蓝色标签可点击跳转

## 🔧 改动

```
5 files changed, 655 insertions(+), 1 deletion(-)
新增文件: src/services/wiki.ts + src/components/wiki-panel.ts
commit 90c4e67
```

| 文件 | 改了什么 |
|---|---|
| `src/services/wiki.ts` | **新增** 5 个 wiki 函数（205 行）|
| `src/components/wiki-panel.ts` | **新增** 完整 wiki 主页（227 行）|
| `src/components/note-view.ts` | +`loadBackLinks` + 反向链接 footer |
| `src/main.ts` | +toolbar 📖 按钮 + wiki-panel 渲染 |
| `src/styles.css` | +176 行（wiki 全套样式）|

## 📊 实测数据

```
1313 笔记
17,734 chunks
5,510 wikilinks
5,510 反向链接
1,014 tags
```

## 📦 验证

- 真机 `M4T0224612003168`
- CDP 端到端:
  - ✅ ll-wiki-panel 组件注册
  - ✅ 点 📖 按钮 → modal 弹出
  - ✅ 8 个 stat-cards 渲染
  - ✅ 数值正确（1313 / 17734 / 5510 / 5510 / 1014）
  - ✅ note-view 反向链接 footer（0-索引-内容矩阵 有 4 个 backlinks）
  - ✅ 21 个外链（linkRefs）
  - ✅ NO_ERRORS
- typecheck: pass

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.7.0-wiki
- Commit: `90c4e67`
- APK: `app-release.apk`