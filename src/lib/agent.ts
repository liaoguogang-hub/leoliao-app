/**
 * V45: 本地 Agent 引擎 — ReAct (Reason + Act) 循环
 *
 * 设计:
 * - 5 个内置工具:kb_search / web_search / note_open / note_edit / list_files
 * - 工具调用语法:LLM 输出 `<tool_call>{"name":"...","args":{...}}</tool_call>`
 * - 主循环:解析工具调用 → 执行 → 把结果拼回 messages → 再问 LLM → 直到 LLM 不再调用工具
 * - 最多 5 步,防无限循环
 *
 * 工具参数用 JSON Schema 描述(给 LLM 看)
 */

import { search as kbSearch, type SearchResult } from './search';
import { webSearch as doWebSearch, type WebSearchSettings } from './web-search';

// === 类型定义 ===

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute: (args: Record<string, any>, ctx: AgentContext) => Promise<any>;
}

export interface AgentContext {
  /** 用户选择的 KB 检索范围(chat-panel 的 searchPaths) */
  searchPaths: string[];
  /** 联网搜索配置 */
  webSettings: WebSearchSettings;
  /** 全局变量:用户偏好 */
  signal?: AbortSignal;
  /** v1.12.1: 检索模式(默认 hybrid),与 chat-panel 保持一致 */
  searchMode?: 'bm25' | 'vector' | 'hybrid';
  /** v1.12.1: 是否启用 Rerank(默认 false);Agent 路径透传 chat-panel 设置 */
  useRerank?: boolean;
  /** v1.12.1: Rerank TopN */
  rerankTopN?: number;
  /** v1.23.0 Fix-A: 是否包含本地文件(PDF/EPUB)— 默认 true */
  includeLocal?: boolean;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface AgentStep {
  /** step 序号 */
  step: number;
  /** 思考:LLM 在调用工具前的 reasoning */
  thought?: string;
  /** 调用的工具 */
  tool?: ToolCall;
  /** 工具执行结果(文本) */
  result?: string;
  /** 出错信息 */
  error?: string;
  /** 时间戳 */
  ts: number;
  /** 耗时 ms */
  durationMs?: number;
}

// === 工具定义 ===

/** 工具 1: 在本地 KB 检索 chunks */
const kbSearchTool: Tool = {
  name: 'kb_search',
  description: '在本地知识库中检索与 query 最相关的 chunk 段落。返回 path/heading/snippet/score。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索关键词(必填)' },
      max_results: { type: 'number', description: '最大返回条数(默认 5)' },
    },
    required: ['query'],
  },
  execute: async (args, ctx) => {
    const k = args.max_results || 5;
    // v1.12.1: 透传 searchMode + useRerank(与 chat-panel 一致)
    const rerankOpts = ctx.useRerank
      ? { topN: ctx.rerankTopN || 10, timeoutMs: 3000 }
      : undefined;
    // v1.23.0 Fix-A: Agent 默认 includeLocal=true — 否则 EPUB/PDF (📘📕 前缀) 永远搜不到
    // 之前默认 false 导致本地文件索引完后依然检索为空
    const results = await kbSearch(
      args.query,
      9999,
      30000,
      ctx.searchPaths,
      ctx.searchMode || 'hybrid',
      ctx.includeLocal !== false,  // 默认 true
      rerankOpts
    );
    const sliced = results.slice(0, k);
    return sliced.map((r: SearchResult, i: number) => ({
      idx: i + 1,
      path: r.path,
      heading: r.heading,
      title: r.title,
      score: r.score,
      snippet: r.snippet.slice(0, 300),
    }));
  },
};

/** 工具 2: 联网搜索 */
const webSearchTool: Tool = {
  name: 'web_search',
  description: '在互联网上搜索(query → [{title, url, content}])。需要先在 chat settings 配 web URL/api key。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词(必填)' },
    },
    required: ['query'],
  },
  execute: async (args, ctx) => {
    if (!ctx.webSettings.url) {
      return { error: '未配置联网搜索 URL,请在 chat settings 填 web URL' };
    }
    try {
      const results = await doWebSearch(args.query, ctx.webSettings);
      return results.slice(0, 5).map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content?.slice(0, 300),
      }));
    } catch (e: any) {
      return { error: `联网搜索失败: ${e?.message || e}` };
    }
  },
};

/** 工具 3: 打开笔记 — 返回笔记全文 */
const noteOpenTool: Tool = {
  name: 'note_open',
  description: '读取指定笔记的全文内容(用于深入了解某个 chunk 所在的笔记上下文)。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '笔记路径,例如"01.公众号/xxx.md"(必填)' },
    },
    required: ['path'],
  },
  execute: async (args) => {
    try {
      const { loadNote } = await import('../services/db');
      const note = await loadNote(args.path);
      if (!note) return { error: `笔记不存在: ${args.path}` };
      return {
        path: note.path,
        title: note.path.split('/').pop()?.replace(/\.md$/, '') || note.path,
        size: note.content.length,
        content: note.content.slice(0, 4000),  // 限 4000 字防超 context
        truncated: note.content.length > 4000,
      };
    } catch (e: any) {
      return { error: `打开笔记失败: ${e?.message || e}` };
    }
  },
};

/** 工具 4: 列出文件 — 给定目录前缀,列出路径匹配的文件 */
const listFilesTool: Tool = {
  name: 'list_files',
  description: '列出 vault 中匹配前缀的文件路径(用于查找某目录下所有笔记)。',
  parameters: {
    type: 'object',
    properties: {
      prefix: { type: 'string', description: '目录前缀,如"01.公众号"或留空=全部' },
      limit: { type: 'number', description: '最多返回条数(默认 20)' },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const { loadAllNotes } = await import('../services/db');
      const all = await loadAllNotes();
      const prefix = args.prefix || '';
      const limit = args.limit || 20;
      const matched = all
        .filter(n => !prefix || n.path.startsWith(prefix + '/'))
        .slice(0, limit)
        .map(n => n.path);
      return { count: matched.length, paths: matched };
    } catch (e: any) {
      return { error: `列文件失败: ${e?.message || e}` };
    }
  },
};

/** 工具 5: 编辑笔记 — 自动改笔记内容(慎用) */
const noteEditTool: Tool = {
  name: 'note_edit',
  description: '编辑/追加笔记内容(⚠️ 会修改用户文件,请先确认)。old_content 必须精确匹配,new_content 是新内容。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '笔记路径' },
      old_content: { type: 'string', description: '要替换的精确原文' },
      new_content: { type: 'string', description: '替换成的新内容' },
    },
    required: ['path', 'old_content', 'new_content'],
  },
  execute: async (args) => {
    try {
      const { loadNote, saveNote } = await import('../services/db');
      const note = await loadNote(args.path);
      if (!note) return { error: `笔记不存在: ${args.path}` };
      if (!note.content.includes(args.old_content)) {
        return { error: `笔记内容不含要替换的原文(old_content 不匹配),无法编辑` };
      }
      const updated = note.content.replace(args.old_content, args.new_content);
      // 计算 hash(用 djb2 同 note-view)
      const enc = new TextEncoder().encode(updated);
      let h = 5381;
      for (let i = 0; i < enc.length; i++) h = ((h << 5) + h + enc[i]) | 0;
      const hash = (h >>> 0).toString(36);
      await saveNote(args.path, updated, Date.now(), hash);
      return { ok: true, path: args.path, newSize: updated.length };
    } catch (e: any) {
      return { error: `编辑笔记失败: ${e?.message || e}` };
    }
  },
};

/** 工具 6: 取单 chunk 全文(深入读某 chunk 上下文) */
const getChunkTool: Tool = {
  name: 'get_chunk',
  description: '按 path + idx 读取某个 chunk 的全文(用于深入理解某个 chunk 上下文,前面 kb_search 已给出 idx)。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '笔记路径,例如"01.公众号/xxx.md"(必填)' },
      idx: { type: 'number', description: 'chunk 在笔记内的索引(必填)' },
    },
    required: ['path', 'idx'],
  },
  execute: async (args) => {
    try {
      const { loadChunksForNote } = await import('../services/db');
      const chunks = await loadChunksForNote(args.path);
      const chunk = chunks.find(c => c.idx === args.idx);
      if (!chunk) return { error: `未找到 chunk: ${args.path}#${args.idx}` };
      return {
        path: chunk.path,
        idx: chunk.idx,
        heading: chunk.heading,
        content: chunk.content,
        hash: chunk.hash,
      };
    } catch (e: any) {
      return { error: `读 chunk 失败: ${e?.message || e}` };
    }
  },
};

/** 工具 7: 列出所有 tag + 频次 */
const listTagsTool: Tool = {
  name: 'list_tags',
  description: '列出 vault 内所有 frontmatter tag 及频次(用于"我有哪些主题可以聊")。',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '最多返回条数(默认 50)' },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const { tagIndex } = await import('../services/wiki');
      const tags = await tagIndex();
      const limit = args.limit || 50;
      return tags.slice(0, limit).map((t: any) => ({
        tag: t.tag,
        count: t.count,
      }));
    } catch (e: any) {
      return { error: `列 tag 失败: ${e?.message || e}` };
    }
  },
};

/** 工具 8: 最近打开历史 */
const getHistoryTool: Tool = {
  name: 'get_history',
  description: '获取最近打开过的笔记/本地文件列表(用于"我之前看过什么")。',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '最多返回条数(默认 20)' },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const { getRecentHistory } = await import('../services/db');
      const items = await getRecentHistory(args.limit || 20);
      return items.map((i: any) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        path: i.path,
        ext: i.ext,
        size: i.size,
        openedAt: i.openedAt,
      }));
    } catch (e: any) {
      return { error: `读历史失败: ${e?.message || e}` };
    }
  },
};

/** 工具 9: 按 tag 找笔记 */
const findByTagTool: Tool = {
  name: 'find_by_tag',
  description: '按 tag 名找出所有带该 tag 的笔记路径(用于"我写过哪些 V8 笔记")。',
  parameters: {
    type: 'object',
    properties: {
      tag: { type: 'string', description: 'tag 名(必填,不含 #)' },
      limit: { type: 'number', description: '最多返回条数(默认 30)' },
    },
    required: ['tag'],
  },
  execute: async (args) => {
    try {
      const { tagIndex } = await import('../services/wiki');
      const tags = await tagIndex();
      const hit = tags.find((t: any) => t.tag === args.tag.replace(/^#/, ''));
      if (!hit) return { tag: args.tag, count: 0, paths: [] };
      const limit = args.limit || 30;
      return {
        tag: args.tag,
        count: hit.count,
        paths: hit.paths.slice(0, limit),
      };
    } catch (e: any) {
      return { error: `按 tag 查找失败: ${e?.message || e}` };
    }
  },
};

/** 全部工具列表 */
export const ALL_TOOLS: Tool[] = [
  kbSearchTool,
  webSearchTool,
  noteOpenTool,
  listFilesTool,
  noteEditTool,
  // v1.19.0: 4 个新工具
  getChunkTool,
  listTagsTool,
  getHistoryTool,
  findByTagTool,
];

/** 按名字找工具 */
export function findTool(name: string): Tool | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}

/** 把工具列表渲染成 system prompt 片段 */
export function toolsPrompt(): string {
  const lines = ALL_TOOLS.map(t => {
    const params = Object.entries(t.parameters.properties)
      .map(([k, v]) => `  - ${k}: ${v.description}`)
      .join('\n');
    return `### ${t.name}\n${t.description}\n参数:\n${params}`;
  });
  return lines.join('\n\n');
}

// === ReAct 主循环 ===

/** 从 LLM 输出解析 <tool_call>{...}</tool_call> */
export function parseToolCall(text: string): { thought: string; tool?: ToolCall } | null {
  // 兼容多种写法:
  // <tool_call>{"name":"kb_search","args":{"query":"河流"}}</tool_call>
  // ```tool_call\n{...}\n```
  const re = /<tool_call>([\s\S]*?)<\/tool_call>|```tool_call\n([\s\S]*?)\n```/;
  const m = text.match(re);
  if (!m) return null;
  const json = m[1] || m[2];
  try {
    const parsed = JSON.parse(json.trim());
    // 兼容 {"name":..., "args":...} 或 {"tool":..., "input":...}
    const name = parsed.name || parsed.tool || parsed.function;
    const args = parsed.args || parsed.input || parsed.parameters || {};
    if (!name) return null;
    // thought = tool_call 之前的文本
    const idx = m.index ?? 0;
    const thought = text.slice(0, Math.max(0, idx)).trim();
    return { thought, tool: { name, args } };
  } catch {
    return null;
  }
}

/** Agent system prompt — 告诉 LLM 怎么用工具 */
export function agentSystemPrompt(): string {
  return `你是一个具备工具调用能力的助手。能使用以下工具:

${toolsPrompt()}

工作流程 (ReAct):
1. 分析用户问题,决定是否需要工具
2. 如果需要,输出 thinking + 工具调用:
   <think>你的思考过程</think>
   <tool_call>{"name":"工具名","args":{...}}</tool_call>
3. 等待工具结果(我会以 <tool_result>...</tool_result> 格式给你)
4. 重复 2-3,直到能给出最终答案
5. 最终答案直接回答用户,**不要再带 <tool_call>标签**

规则:
- 每次只调一个工具
- 工具结果作为事实依据,**不要编造**
- 中文回答,简洁准确,1-3 段
- 如 kb_search 已找到答案,不要再开 web_search
- **用户问"每章/全书/每个部分"这类结构化问题时,必须逐章/逐部分多次 kb_search**(每章一次,query 用"章节名+主题词"),不要只搜一次宽泛 query,否则后面的章节会漏掉
- 检索某章为空时,如实说"该部分 KB 中未检索到原文",**不要**用书的知识编造
- 最终回答尽量覆盖用户要求的全部章节,别漏`;
}

/** 单步执行 — 调一个工具返回结果 */
export async function executeToolCall(
  tc: ToolCall,
  ctx: AgentContext
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const tool = findTool(tc.name);
  if (!tool) return { ok: false, error: `未知工具: ${tc.name}` };
  try {
    const result = await tool.execute(tc.args, ctx);
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 把工具结果包成 LLM 看到的格式 */
export function wrapToolResult(name: string, payload: any): string {
  return `<tool_result name="${name}">\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}\n</tool_result>`;
}