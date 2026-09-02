# v1.6.0-memory — 长期记忆

🎉 V46 LLM 自动从对话中提取用户偏好/事实,作为长期记忆

## ✨ 新功能

#### 1. 记忆自动提取
- 每次对话完成后,后台异步调 LLM 1 次
- prompt 让 LLM 提取"用户偏好 / 个人事实 / 长期目标"
- LLM 返回 JSON → 写入 `memoryTopics` + `memoryItems`
- **跨对话价值判断**:只记长期有用的,不记临时问题

#### 2. Dexie v7 新增 2 张表
- `memoryTopics`(id/title/summary/createdAt/lastUsed/sessionId/status)
- `memoryItems`(++id/topicId/kind:fact|quote|pref/content/source/ts)
- 6 个 CRUD API:
  - `listMemoryTopics` / `getMemoryTopicWithItems`
  - `createMemoryTopic` / `deleteMemoryTopic`
  - `touchMemoryTopic` / `exportAllMemory`

#### 3. 记忆设置 UI
- settings 加 `💭 长期记忆 (V46)` fieldset
- 2 个 checkbox:
  - ✅ **自动提取用户偏好/事实**
  - ✅ **注入到 system prompt**
- 2 个按钮:
  - 📚 查看记忆主题
  - 📥 导出 Markdown

#### 4. 记忆面板
- 点击"查看记忆主题"弹 modal
- 折叠列表显示 topic(标题/更新时间/item 数)
- 展开看 summary + items
- 删除按钮(每条主题独立)

#### 5. Markdown 导出
- 一键导出全部主题 + items 为 .md
- 文件名:`leoliao-memory-{YYYY-MM-DD}.md`

## 🔧 改动

```
5 files changed, 465 insertions(+)
新增文件: src/services/memory.ts + src/services/memory-settings.ts
commit 98c73e0
```

| 文件 | 改了什么 |
|---|---|
| `src/services/memory.ts` | **新增** 提取引擎 + buildMemoryPrompt + exportMemoryMarkdown |
| `src/services/memory-settings.ts` | **新增** 记忆配置 enabled/mode/injectInPrompt |
| `src/services/db.ts` | Dexie v7 + memoryTopics/memoryItems + 6 API |
| `src/components/chat-panel.ts` | +memory state + 触发提取 + memory panel + settings fieldset |
| `src/styles.css` | +.memory-topic / .memory-item / .btn-delete-topic |

## 📦 验证

- 真机 `M4T0224612003168`
- CDP 端到端:
  - ✅ settings 显示 `💭 长期记忆 (V46)` fieldset
  - ✅ 2 个 checkbox + 2 个按钮全在
  - ✅ Memory panel 弹出正常
  - ✅ 空状态文案正确
  - ✅ NO_ERRORS
- typecheck: pass
- 实际提取需用户配置 LLM key + 发几条对话

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.6.0-memory
- Commit: `98c73e0`
- APK: `app-release.apk`