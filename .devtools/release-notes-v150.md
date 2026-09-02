# v1.5.0-agent-engine — 本地 Agent 引擎 + ReAct 循环

🎉 V45 LLM 可调用工具,自动推理 + 行动

## ✨ 新功能

#### 1. Agent 引擎（`src/lib/agent.ts`）
5 个内置工具,每个有 `name` / `description` / `parameters` / `execute`：

| 工具 | 用途 |
|---|---|
| `kb_search` | 检索本地 KB chunks(返回 path/heading/snippet/score) |
| `web_search` | 联网搜索(需先在 settings 配 web URL) |
| `note_open` | 读笔记全文(深入上下文) |
| `list_files` | 列 vault 文件(按目录前缀) |
| `note_edit` | 编辑笔记(自动校验 old_content 匹配) |

#### 2. ReAct 主循环
- LLM 输出 `<tool_call>{"name":"...","args":{...}}</tool_call>` → 解析 → 执行 → 把结果以 `<tool_result>` 拼回 → 再问 LLM
- 最多 5 步,防无限循环
- 自动合并 `kb_search` / `web_search` 结果到最终引用卡片
- 用户中断时优雅退出

#### 3. Chat UI 集成
- "Agent 模式" toggle（沿用 v1.2 设置）
- 启用 Agent 后显示 5 个工具 checkbox,可单独启用/禁用
- assistant 消息新增 `agentSteps` 折叠区:
  - 步骤序号 #1 #2 #3...
  - 🔧 工具名 + 耗时
  - 💭 思考过程
  - args 完整 JSON
  - 错误信息(红色)
  - 结果(JSON 折叠,160px 高)
- `agentSteps` 持久化到 Dexie chat 表

## 🔧 改动

```
3 files changed, 613 insertions(+), 5 deletions(-)
新增文件: src/lib/agent.ts (301 行)
commit 2889281
```

| 文件 | 改了什么 |
|---|---|
| `src/lib/agent.ts` | **新增** 工具定义 + `parseToolCall` + `executeToolCall` + `wrapToolResult` + `agentSystemPrompt` |
| `src/components/chat-panel.ts` | +`useAgent` state +` runAgentReAct` 主循环 + 5 行 settings UI + agentSteps 渲染 |
| `src/styles.css` | +`.agent-steps` / `.agent-step-*` / `.tool-toggle` 全套样式 |

## 📦 验证

- 真机 `M4T0224612003168`
- CDP 端到端:
  - ✅ `chatPanel: true` 模块注册
  - ✅ 5 个工具 toggle 显示（kb_search / web_search / note_open / list_files / note_edit）
  - ✅ 全部默认 checked
  - ✅ `enabledTools: 5` state 正确
- typecheck: pass
- ReAct 循环逻辑可单元测试(用户装了 LLM key 后可直接跑通)

## 🔗 链接

- GitHub Release: https://github.com/liaoguogang-hub/leoliao-app/releases/tag/v1.5.0-agent-engine
- Commit: `2889281`
- APK: `app-release.apk`