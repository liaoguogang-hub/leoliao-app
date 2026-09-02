/**
 * 对话面板 — LLM 聊天 UI
 *
 * 设计：
 * - 浮动按钮 (FAB) 在右下角，点开 modal
 * - modal 内:左侧多会话侧边栏 + 主区(可折叠的设置面板 + 消息列表 + 输入区)
 * - 设置:provider / URL / 模型 / API Key / 测试连接 / 是否启用 KB 检索
 * - 消息流式渲染(chatStream),助手消息底部显示引用卡片 [KB#1] [Web#1] 可点击
 * - 对话历史持久化到 Dexie v4 chat 表(按 sessionId 分组)
 * - V42 多会话:每个 session 上限 200 条滚动删旧
 * - ⏹ 停止生成按钮(AbortController)
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { PROVIDERS, PROVIDER_LIST, type ProviderId } from '../lib/llm-providers';
import { chatStream, testConnection, chatOnce, type ChatMessage, type LLMSettings } from '../lib/llm';
import { search as kbSearch, buildFullRAGPrompt, type SearchResult, type SearchMode } from '../lib/search';
import { webSearch, WEB_PROVIDER_LIST, type WebSearchSettings } from '../lib/web-search';
import {
  agentSystemPrompt, parseToolCall, executeToolCall, wrapToolResult,
  type AgentStep, type AgentContext,
} from '../lib/agent';
import { loadLLMSettings, saveLLMSettings } from '../services/llm-settings';
import { loadWebSettings, saveWebSettings } from '../services/web-settings';
import { loadMemorySettings, saveMemorySettings, type MemorySettings } from '../services/memory-settings';
import { extractFromConversation } from '../services/memory';
import {
  getChatHistory, appendChatMessage, clearChatHistory, db,
  listSessions, createSession, renameSession, deleteSession,
  ensureDefaultSession,
  type ChatSessionRow,
} from '../services/db';

interface WebResult { title: string; url: string; content: string }

interface UiMessage extends ChatMessage {
  id: number;
  kbCitations?: SearchResult[];
  webCitations?: WebResult[];
  streaming?: boolean;
  error?: string;
  /** RAG/Web 状态标签：发送时快照,UI 直接展示,方便用户判断 RAG 是否真的工作 */
  ragStatus?: { kb: number; web: number; useKB: boolean; useWeb: boolean };
  /** V42-p2: 复制按钮短暂反馈(1.8s 后自动清掉) */
  _copied?: boolean | undefined;
  /** V45: Agent 工具调用步骤(可折叠显示) */
  agentSteps?: AgentStep[];
}

@customElement('ll-chat-panel')
export class LlChatPanel extends LitElement {
  protected createRenderRoot() { return this; }

  /** 打开 chat / 新消息时自动滚到底部，让用户直接看到最近一轮对话 */
  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has('open') || changed.has('messages')) {
      // 等 DOM commit 完再滚（lit render 是异步的）
      this.updateComplete.then(() => {
        const cb = this.querySelector('.chat-body') as HTMLElement | null;
        if (cb) cb.scrollTop = cb.scrollHeight;
      });
    }
    // V44: modal 打开时重新加载 dirs(可能 sync 完成后 chunks 变多了)
    if (changed.has('open') && this.open && this.allDirs.length === 0) {
      this.refreshDirs();
    }
  }

  /** V44: 重新加载所有目录(从 chunks 表) */
  async refreshDirs() {
    try {
      const { loadAllChunks } = await import('../services/db');
      const allChunks = await loadAllChunks();
      const dirSet = new Set<string>();
      for (const c of allChunks) {
        const parts = c.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          dirSet.add(parts.slice(0, i).join('/'));
        }
      }
      this.allDirs = Array.from(dirSet).sort();
    } catch (e) { console.warn('[chat] refreshDirs failed', e); }
  }

  @state() private open = false;
  @state() private settings!: LLMSettings;
  @state() private web!: WebSearchSettings;
  @state() private showSettings = false;
  @state() private messages: UiMessage[] = [];
  @state() private input = '';
  @state() private sending = false;
  @state() private useKB = true;             // 是否启用 KB 检索（RAG 模式）
  @state() private useWeb = false;           // 是否启用联网搜索
  @state() private useAgent = true;          // V45: Agent 模式(启用后 LLM 可调工具)
  /** V44: KB 检索范围(文件夹前缀列表,空=全部) */
  @state() private searchPaths: string[] = [];
  @state() private showPathPicker = false;
  @state() private allDirs: string[] = [];
  /** V48: 检索模式(bm25 / vector / hybrid) */
  @state() private searchMode: SearchMode = 'hybrid';
  /** V49: 是否把本地 PDF 等加入 KB 范围 */
  @state() private includeLocal = false;
  /** V45: Agent 启用的工具列表(默认全部启用) */
  @state() private enabledTools: string[] = ['kb_search', 'web_search', 'note_open', 'list_files', 'note_edit'];
  /** V46: 长期记忆设置 */
  @state() private memory!: MemorySettings;
  /** V46: Memory panel 是否打开 */
  @state() private showMemoryPanel = false;
  /** V46: 当前记忆主题缓存(用于 panel 显示) */
  @state() private memoryTopics: Array<{ topic: any; items: any[] }> = [];
  @state() private testStatus: { ok: boolean; msg: string } | null = null;
  @state() private vaultNoteCount = 0;     // vault 已同步笔记数 (Dexie notes.count)
  // V42 多会话
  @state() private sessions: ChatSessionRow[] = [];
  @state() private currentSessionId = '';
  @state() private showSidebar = true;      // 左侧会话侧边栏是否显示(可关)
  /** 流式请求的 AbortController — ⏹ 停止按钮用 */
  private currentAbort: AbortController | null = null;
  /** 自动生成标题 — 首问后取前 12 字(避免每个 send 都触发) */
  private sessionTitledSet = new Set<string>();

  async connectedCallback() {
    super.connectedCallback();
    // V1.1.4: 三种方式注入配置（按顺序尝试）
    // 1) ?llm-config=base64JSON URL 参数
    // 2) localStorage 里 _llm_inject_pending 一次性 pending 字段（adb 通过 run-as 写入）
    // 3) /data/data/com.leoliao.app/files/llm-config.json 文件
    let injected = false;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const configB64 = urlParams.get('llm-config');
      if (configB64) {
        const cfg = JSON.parse(atob(decodeURIComponent(configB64)));
        saveLLMSettings(cfg);
        this.settings = cfg;
        injected = true;
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (e) { console.error('URL llm-config inject failed', e); }
    if (!injected) {
      try {
        const pending = localStorage.getItem('_llm_inject_pending');
        if (pending) {
          const cfg = JSON.parse(pending);
          saveLLMSettings(cfg);
          this.settings = cfg;
          localStorage.removeItem('_llm_inject_pending');
          injected = true;
        }
      } catch (e) { console.error('localStorage pending inject failed', e); }
    }
    if (!injected) {
      try {
        // Capacitor 暴露 Filesystem API；用 readFile 试读
        // 避免硬依赖 @capacitor/filesystem：直接用 raw fetch（仅 debug build 支持 http://localhost/）
        const r = await fetch('http://localhost/files/llm-config.json', { cache: 'no-store' });
        if (r.ok) {
          const cfg = await r.json();
          saveLLMSettings(cfg);
          this.settings = cfg;
          injected = true;
        }
      } catch (e) { /* 文件可能不存在 — 静默 */ }
    }
    this.settings = loadLLMSettings();
    this.web = loadWebSettings();
    this.memory = loadMemorySettings();
    // V1.1.2+: 防御性同步 — 如果 settings.baseUrl / model 跟当前 provider 的默认值不一致
    // （典型 bug：用户从 v1.1.0 升级上来，或用 inject 方式灌了 deepseek 配置后切到 MiniMax），
    // 自动 fallback 到 provider 默认值，避免 baseUrl 还是 deepseek 的域名 + MiniMax key 这种错配。
    const p = PROVIDERS[this.settings.provider];
    if (p) {
      const defaults = p;
      const baseUrlMatchesPrevDefault = Object.values(PROVIDERS)
        .filter(other => other.id !== p.id)
        .some(other => other.defaultBaseUrl && this.settings.baseUrl === other.defaultBaseUrl);
      const baseUrlLooksBroken =
        !this.settings.baseUrl ||
        baseUrlMatchesPrevDefault ||
        (defaults.defaultBaseUrl && !this.settings.baseUrl.startsWith('http'));
      const modelNotInList = defaults.models.length > 0 && !defaults.models.includes(this.settings.model);
      if (baseUrlLooksBroken || modelNotInList) {
        this.settings = {
          ...this.settings,
          baseUrl: defaults.defaultBaseUrl || this.settings.baseUrl,
          model: defaults.models.length > 0 ? defaults.models[0] : this.settings.model,
        };
        saveLLMSettings(this.settings);
      }
    }
    // 同样：temperature/maxTokens 兜底（OpenAI 协议默认）
    if (typeof this.settings.temperature !== 'number') {
      this.settings = { ...this.settings, temperature: 0.7 };
    }
    if (typeof this.settings.maxTokens !== 'number') {
      this.settings = { ...this.settings, maxTokens: 1024 };
    }
    await this.loadSessions();
    await this.loadHistory();
    // 加载 vault 笔记数，给 UI 显示"已同步 N 条"信息
    try {
      this.vaultNoteCount = await db().notes.count();
    } catch {}
    // V44: 加载所有目录路径(从 chunks 表的 path 提取 unique 前缀)
    try {
      const { loadAllChunks } = await import('../services/db');
      const allChunks = await loadAllChunks();
      const dirSet = new Set<string>();
      for (const c of allChunks) {
        const parts = c.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          dirSet.add(parts.slice(0, i).join('/'));
        }
      }
      this.allDirs = Array.from(dirSet).sort();
    } catch (e) { console.warn('[chat] load dirs failed', e); }
  }

  /** V42: 加载所有会话 + 默认选第一个 */
  private async loadSessions() {
    this.currentSessionId = await ensureDefaultSession();
    this.sessions = await listSessions();
    // 记录老会话(避免重复自动改名)
    for (const s of this.sessions) {
      if (s.title !== '新对话' && s.title !== '历史对话') {
        this.sessionTitledSet.add(s.id);
      }
    }
  }

  /** V42: 加载当前会话的消息 */
  private async loadHistory() {
    if (!this.currentSessionId) return;
    const rows = await getChatHistory(this.currentSessionId);
    this.messages = rows
      .filter(r => r.role !== 'system')               // 不渲染历史里的 system
      .map<UiMessage>(r => {
        // V42: 兼容老 citations 字段(JSON 字符串),新数据 {kb, web}
        let kbCitations: SearchResult[] | undefined;
        let webCitations: WebResult[] | undefined;
        if (r.citations) {
          try {
            const parsed = JSON.parse(r.citations);
            if (Array.isArray(parsed)) {
              kbCitations = parsed; // 老格式
            } else {
              kbCitations = parsed.kb;
              webCitations = parsed.web;
            }
          } catch { /* ignore */ }
        }
        return {
          id: r.id!,
          role: r.role as 'user' | 'assistant',
          content: r.content,
          kbCitations,
          webCitations,
        };
      });
  }

  /** V42: 切换会话 */
  private async switchSession(id: string) {
    if (id === this.currentSessionId || this.sending) return;
    this.currentSessionId = id;
    await this.loadHistory();
    this.input = '';
  }

  /** V42: 新建会话 */
  private async createNewSession() {
    if (this.sending) return;
    const s = await createSession('新对话');
    this.sessions = [s, ...this.sessions];
    await this.switchSession(s.id);
  }

  /** V42: 删除当前会话(级联删消息) */
  private async deleteCurrentSession() {
    if (this.sessions.length <= 1) {
      alert('至少保留一个会话');
      return;
    }
    if (!confirm(`删除会话 "${this.sessions.find(s => s.id === this.currentSessionId)?.title || ''}" 及其所有消息？`)) return;
    const id = this.currentSessionId;
    await deleteSession(id);
    this.sessionTitledSet.delete(id);
    this.sessions = this.sessions.filter(s => s.id !== id);
    // 切到第一个
    await this.switchSession(this.sessions[0].id);
  }

  /** V42: 重命名当前会话 */
  private async renameCurrentSession() {
    const cur = this.sessions.find(s => s.id === this.currentSessionId);
    if (!cur) return;
    const title = prompt('重命名会话', cur.title);
    if (!title || title.trim() === cur.title) return;
    await renameSession(cur.id, title.trim());
    this.sessionTitledSet.add(cur.id);
    this.sessions = this.sessions.map(s => s.id === cur.id ? { ...s, title: title.trim() } : s);
  }

  /** V42: ⏹ 停止生成 — AbortController 触发 */
  private stopGeneration() {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
  }

  /** V42: 自动生成标题 — 首问后取首句前 12 字 */
  private async maybeAutoTitle(sessionId: string, userMsg: string) {
    if (this.sessionTitledSet.has(sessionId)) return;
    // 取首句前 12 字,strip 掉标点
    const first = userMsg.split(/[。\n!?？]/)[0].trim().slice(0, 12);
    if (!first) return;
    this.sessionTitledSet.add(sessionId);
    await renameSession(sessionId, first);
    this.sessions = this.sessions.map(s => s.id === sessionId ? { ...s, title: first } : s);
  }

  private persistSettings() {
    saveLLMSettings(this.settings);
  }

  private async onTestConnection() {
    this.testStatus = { ok: false, msg: '测试中…' };
    const result = await testConnection(this.settings);
    this.testStatus = result.ok
      ? { ok: true, msg: `✓ 连接成功（${result.model}）` }
      : { ok: false, msg: `✗ 失败: ${result.error || '未知错误'}` };
  }

  private switchProvider(id: ProviderId) {
    const preset = PROVIDERS[id];
    const providerChanged = this.settings.provider !== id;
    // 切换 provider 时：旧 baseUrl/model 跟新 provider 不兼容的概率很大
    // （典型 bug：用户从 deepseek 切到 MiniMax，baseUrl 仍是 deepseek，
    //  实际请求发到 deepseek 域名 + MiniMax key → deepseek 返回 401，
    //  用户误以为 MiniMax 没接通）。切换时强制重置为新 provider 默认值。
    this.settings = {
      ...this.settings,
      provider: id,
      baseUrl: providerChanged ? preset.defaultBaseUrl : (this.settings.baseUrl || preset.defaultBaseUrl),
      model: providerChanged ? preset.defaultModel : (this.settings.model || preset.defaultModel),
    };
    this.persistSettings();
    this.testStatus = null;
  }

  private async send() {
    const q = this.input.trim();
    if (!q || this.sending) return;
    if (!this.settings.apiKey) {
      this.testStatus = { ok: false, msg: '✗ 请先在设置里填 API Key' };
      this.showSettings = true;
      return;
    }
    // V42: 兜底 — 万一没有 currentSessionId,新建一个
    if (!this.currentSessionId) {
      const s = await createSession('新对话');
      this.sessions = [s, ...this.sessions];
      this.currentSessionId = s.id;
    }
    const sessionId = this.currentSessionId;
    this.input = '';
    this.testStatus = null;

    // 1) 用户消息入库 + 上屏
    // 用 appendChatMessage 返回的真实 id，让下面 filter `m.id !== 0` 不会误把当前问题也排除
    // (老 bug：userMsg.id=0 时被 filter 掉 → messages 空数组 → "chat content is empty")
    const userMsgId = await appendChatMessage({ role: 'user', content: q, sessionId });
    const userMsg: UiMessage = { id: userMsgId, role: 'user', content: q };
    this.messages = [...this.messages, userMsg];
    // V42: 自动生成标题(首问后,异步,不阻塞流程)
    this.maybeAutoTitle(sessionId, q).catch(() => {});

    // 2) KB 检索 + 联网搜索（按开关）
    let ragSystem: string | undefined;
    let ragUser: string | undefined;
    let kbCitations: SearchResult[] = [];
    let webCitations: WebResult[] = [];
    // DEBUG: 看真实 useKB/useWeb/maxTokens 状态
    console.log('[chat.send] q=', q, 'useKB=', this.useKB, 'useWeb=', this.useWeb, 'web.url=', this.web?.url, 'maxTokens=', this.settings.maxTokens);
    if (this.useKB) {
      // V49: 传 searchMode + searchPaths + includeLocal(本地 PDF)
      kbCitations = await kbSearch(q, 9999, 30000, this.searchPaths, this.searchMode, this.includeLocal);
    }
    if (this.useWeb && this.web.url) {
      try {
        webCitations = await webSearch(q, this.web);
      } catch (e) {
        console.warn('web search failed', e);
      }
    } else if (this.useWeb && !this.web.url) {
      console.log('[chat.send] useWeb=true 但 web.url 未配置 — 跳过 web search');
    }
    console.log('[chat.send] kbCitations=', kbCitations.length, 'webCitations=', webCitations.length);
    if (kbCitations.length > 0 || webCitations.length > 0) {
      const rag = buildFullRAGPrompt(q, kbCitations, webCitations);
      ragSystem = rag.system;
      ragUser = rag.user;
    }

    // 3) 助手消息占位（id 先给 0，stream 完成后回填真实 id）
    const assistantMsg: UiMessage = {
      id: 0,
      role: 'assistant',
      content: '',
      streaming: true,
      kbCitations,
      webCitations,
      ragStatus: { kb: kbCitations.length, web: webCitations.length, useKB: this.useKB, useWeb: this.useWeb },
    };
    this.messages = [...this.messages, assistantMsg];
    this.sending = true;

    // 4) 组装完整消息列表（含 system）
    const messages: ChatMessage[] = [];
    // V45: Agent 模式 → 用 agent system prompt 替换普通 ragSystem
    if (this.useAgent && this.enabledTools.length > 0) {
      messages.push({ role: 'system', content: agentSystemPrompt() });
      // 如果 RAG 检索可拿到,作为初始 kb_search 结果给 LLM 提示
      if (kbCitations.length > 0 || webCitations.length > 0) {
        const rag = buildFullRAGPrompt(q, kbCitations, webCitations);
        messages.push({ role: 'system', content: rag.system });
      }
    } else if (ragSystem) {
      messages.push({ role: 'system', content: ragSystem });
    }
    // 取最近 8 轮历史（user/assistant）作为多轮上下文
    const recent = this.messages
      .filter(m => m.id !== 0 && m.role !== 'system')   // 排除本次未持久化的占位
      .slice(-16)
      .map(m => ({ role: m.role, content: m.content }));
    // RAG 模式：最后一条 user 用 KB+Web 增强版（ragUser）
    if (ragUser && recent.length > 0 && recent[recent.length - 1].role === 'user') {
      recent[recent.length - 1] = { role: 'user', content: ragUser };
    }
    messages.push(...recent);

    // V45: Agent 模式 → 走 ReAct 循环
    if (this.useAgent && this.enabledTools.length > 0) {
      await this.runAgentReAct(q, messages, sessionId, kbCitations, webCitations);
      this.sending = false;
      this.currentAbort = null;
      return;
    }

    // 5) 流式请求 — V42: AbortController 让 ⏹ 停止按钮能用
    this.currentAbort = new AbortController();
    let fullText = '';
    let aborted = false;
    try {
      const stream = chatStream(messages, this.settings, this.currentAbort.signal);
      for await (const delta of stream) {
        fullText += delta;
        const idx = this.messages.length - 1;
        const updated = [...this.messages];
        updated[idx] = { ...updated[idx], content: fullText };
        this.messages = updated;
      }
    } catch (e: any) {
      // V42: 主动 abort 也走 catch,标记 aborted,文字尾部加 [已停止]
      if (e?.name === 'AbortError' || this.currentAbort?.signal.aborted) {
        aborted = true;
        this.messages = this.messages.map((m, i) =>
          i === this.messages.length - 1 ? { ...m, content: fullText + '\n\n[⏹ 已停止]', streaming: false } : m
        );
      } else {
        this.messages = this.messages.map((m, i) =>
          i === this.messages.length - 1 ? { ...m, content: fullText + `\n\n[错误: ${e?.message || e}]`, streaming: false, error: e?.message } : m
        );
      }
      this.sending = false;
      this.currentAbort = null;
      // 即使出错也持久化(部分回答)
      if (!aborted) {
        await this.persistAssistant(sessionId, fullText, kbCitations, webCitations);
      } else if (fullText) {
        // 停止但已有内容 → 也存(用户能看到内容)
        await this.persistAssistant(sessionId, fullText + ' [⏹ 已停止]', kbCitations, webCitations);
      }
      return;
    }

    // 6) 流式完成 → 入库
    await this.persistAssistant(sessionId, fullText, kbCitations, webCitations);
    this.sending = false;        // V42 fix: 成功路径漏了,导致按钮停在"⏹ 停止"
    this.currentAbort = null;
    // V46: 后台异步触发长期记忆(每轮都跑,慢一点但全自动)
    if (this.memory.enabled && this.memory.mode === 'every-turn') {
      this.triggerMemoryExtract(sessionId);
    }
  }

  /** V46: 后台提取记忆(不阻塞 UI) */
  private triggerMemoryExtract(sessionId: string) {
    // 取最近 6 轮对话
    const recent = this.messages
      .filter(m => m.id !== 0 && m.role !== 'system')
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content } as ChatMessage));
    if (recent.length < 2) return;
    extractFromConversation(recent, this.settings, sessionId)
      .then(topics => {
        if (topics.length > 0) console.log('[memory] extracted', topics.length, 'topics');
      })
      .catch(e => console.warn('[memory] extract failed', e));
  }

  /** V42 helper: 持久化助手消息 + 回填 id */
  private async persistAssistant(
    sessionId: string,
    fullText: string,
    kbCitations: SearchResult[],
    webCitations: WebResult[],
    agentSteps?: AgentStep[]
  ) {
    if (!fullText && (!agentSteps || agentSteps.length === 0)) return; // 空内容不入库(避免 400)
    const citationsBlob = JSON.stringify({ kb: kbCitations, web: webCitations });
    const assistantId = await appendChatMessage({
      role: 'assistant',
      content: fullText,
      citations: citationsBlob,
      sessionId,
    });
    // 用真实 id 回填 assistantMsg，让下次 send() 的 filter `m.id !== 0` 不会误排除它
    const finalAssistant = {
      ...this.messages[this.messages.length - 1],
      id: assistantId,
      streaming: false,
      agentSteps: agentSteps || (this.messages[this.messages.length - 1] as any).agentSteps,
    };
    this.messages = this.messages.map((m, i) =>
      i === this.messages.length - 1 ? finalAssistant : m
    );
  }

  /** V46: 打开 memory panel + 加载主题 */
  private async openMemoryPanel() {
    const { listMemoryTopics, getMemoryTopicWithItems } = await import('../services/db');
    const topics = await listMemoryTopics();
    const out: Array<{ topic: any; items: any[] }> = [];
    for (const t of topics.slice(0, 30)) {
      const detail = await getMemoryTopicWithItems(t.id);
      if (detail) out.push(detail);
    }
    this.memoryTopics = out;
    this.showMemoryPanel = true;
  }

  /** V46: 删除记忆主题 */
  private async deleteMemoryTopic(id: string) {
    if (!confirm('删除该记忆主题?')) return;
    const { deleteMemoryTopic } = await import('../services/db');
    await deleteMemoryTopic(id);
    this.memoryTopics = this.memoryTopics.filter(t => t.topic.id !== id);
  }

  /** V46: 导出记忆为 Markdown */
  private async exportMemory() {
    const { exportMemoryMarkdown } = await import('../services/memory');
    const md = await exportMemoryMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leoliao-memory-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[memory] exported to', a.download);
  }

  /** V46: 渲染 memory panel */
  private renderMemoryPanel() {
    if (!this.showMemoryPanel) return null;
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.showMemoryPanel = false;
      }}>
        <div class="modal-box" style="max-width:600px">
          <h2>💭 长期记忆</h2>
          <p class="modal-sub">${this.memoryTopics.length} 个主题 · 自动从对话提取</p>
          <div style="max-height:400px;overflow-y:auto">
            ${this.memoryTopics.length === 0 ? html`
              <div class="path-picker-empty">还没有记忆主题。发几条对话后会自动提取(需要在设置中开启)。</div>
            ` : this.memoryTopics.map(({ topic, items }) => html`
              <details class="memory-topic">
                <summary>
                  <span style="font-weight:500">${topic.title}</span>
                  <span class="memory-topic-meta">${items.length} 条 · ${new Date(topic.lastUsed).toLocaleDateString('zh-CN')}</span>
                </summary>
                <div class="memory-topic-body">
                  ${topic.summary ? html`<p class="memory-topic-summary">${topic.summary}</p>` : nothing}
                  ${items.map((it: any) => html`
                    <div class="memory-item">
                      <span class="memory-item-kind ${it.kind}">${it.kind === 'fact' ? '📌' : it.kind === 'pref' ? '⭐' : '💬'}</span>
                      <span>${it.content}</span>
                    </div>
                  `)}
                  <button class="btn-delete-topic" @click=${() => this.deleteMemoryTopic(topic.id)}>🗑 删除主题</button>
                </div>
              </details>
            `)}
          </div>
          <div class="modal-actions">
            <button class="modal-btn" @click=${() => this.showMemoryPanel = false}>关闭</button>
            <button class="modal-btn primary" @click=${() => this.exportMemory()}>📥 导出 Markdown</button>
          </div>
        </div>
      </div>
    `;
  }

  /** V45: Agent ReAct 主循环 — 最多 5 步工具调用 */
  private async runAgentReAct(
    originalQuery: string,
    initialMessages: ChatMessage[],
    sessionId: string,
    initialKb: SearchResult[],
    initialWeb: any[]
  ) {
    const ctx: AgentContext = {
      searchPaths: this.searchPaths,
      webSettings: this.web,
      signal: this.currentAbort?.signal,
    };
    const messages: ChatMessage[] = [...initialMessages];
    // 把"原 query"作为最后一条 user
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: originalQuery });
    } else {
      // 已经是 user,保持
    }
    const steps: AgentStep[] = [];
    let fullAnswer = '';
    let finalKb = [...initialKb];
    let finalWeb = [...initialWeb];

    const MAX_STEPS = 5;
    for (let i = 0; i < MAX_STEPS; i++) {
      // 中途停止检查
      if (this.currentAbort?.signal.aborted) break;
      // 调 LLM(一次性,不流式,因为工具调用需要完整文本)
      let llmText = '';
      try {
        llmText = await chatOnce(messages, this.settings);
      } catch (e: any) {
        llmText = `[Agent 错误: ${e?.message || e}]`;
        steps.push({ step: i + 1, error: llmText, ts: Date.now() });
        break;
      }
      // 解析工具调用
      const parsed = parseToolCall(llmText);
      const ts = Date.now();
      if (!parsed || !parsed.tool) {
        // 没有工具调用 → 最终答案
        fullAnswer = parsed?.thought ? parsed.thought + '\n\n' + llmText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim() : llmText;
        // 去掉 <tool_call> 残留
        fullAnswer = fullAnswer.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
        steps.push({ step: i + 1, thought: parsed?.thought, ts });
        break;
      }
      // 有工具调用 → 执行
      const tc = parsed.tool;
      // 检查是否启用
      if (!this.enabledTools.includes(tc.name)) {
        steps.push({
          step: i + 1,
          thought: parsed.thought,
          tool: tc,
          error: `工具 ${tc.name} 未启用`,
          ts,
        });
        // 把错误作为 tool_result 让 LLM 知道
        messages.push({ role: 'assistant', content: llmText });
        messages.push({ role: 'user', content: wrapToolResult(tc.name, { error: `工具 ${tc.name} 未启用` }) });
        continue;
      }
      // 执行
      const stepStart = Date.now();
      const execResult = await executeToolCall(tc, ctx);
      const stepDuration = Date.now() - stepStart;
      const resultText = execResult.ok
        ? JSON.stringify(execResult.result, null, 2)
        : `ERROR: ${execResult.error}`;
      // resultText 用于调试日志,UI 用 execResult.result/result 字段
      void resultText;
      steps.push({
        step: i + 1,
        thought: parsed.thought,
        tool: tc,
        result: execResult.ok ? resultText : undefined,
        error: execResult.ok ? undefined : execResult.error,
        ts,
        durationMs: stepDuration,
      });
      // 把 kb_search 结果合并到 finalKb(给 UI 显示引用卡片)
      if (tc.name === 'kb_search' && execResult.ok && Array.isArray(execResult.result)) {
        for (const r of execResult.result) {
          finalKb.push({
            path: r.path,
            heading: r.heading || '',
            title: r.title || r.path,
            snippet: r.snippet || '',
            score: r.score || 0,
            mtime: Date.now(),
          } as any);
        }
      }
      if (tc.name === 'web_search' && execResult.ok && Array.isArray(execResult.result)) {
        for (const r of execResult.result) {
          finalWeb.push({ title: r.title, url: r.url, content: r.content });
        }
      }
      // 更新 UI 显示当前 step
      this.messages = this.messages.map((m, i) =>
        i === this.messages.length - 1 ? { ...m, agentSteps: [...steps] } : m
      );
      // 拼到 messages
      messages.push({ role: 'assistant', content: llmText });
      messages.push({ role: 'user', content: wrapToolResult(tc.name, execResult.ok ? execResult.result : { error: execResult.error }) });
    }
    // 如果 5 步后没拿到答案,llmText 可能是最后一次循环的内容
    if (!fullAnswer && messages.length > 0) {
      fullAnswer = `[Agent 跑了 ${steps.length} 步,没拿到最终答案]\n\n最后一条消息:\n` +
        messages[messages.length - 1].content.slice(0, 500);
    }
    // 更新 UI
    this.messages = this.messages.map((m, i) =>
      i === this.messages.length - 1
        ? { ...m, content: fullAnswer, agentSteps: steps, streaming: false, ragStatus: { kb: finalKb.length, web: finalWeb.length, useKB: this.useKB, useWeb: this.useWeb } }
        : m
    );
    // 持久化
    await this.persistAssistant(sessionId, fullAnswer, finalKb, finalWeb, steps);
  }

  private async onClearHistory() {
    if (!confirm('清空所有对话？')) return;
    await clearChatHistory();
    this.messages = [];
  }

  private renderSettings() {
    const s = this.settings;
    const provider = PROVIDERS[s.provider];
    return html`
      <div class="chat-settings">
        <div class="setting-row">
          <label>Provider</label>
          <select @change=${(e: Event) => this.switchProvider((e.target as HTMLSelectElement).value as ProviderId)}>
            ${PROVIDER_LIST.map(p => html`
              <option value=${p.id} ?selected=${s.provider === p.id}>${p.label}</option>
            `)}
          </select>
        </div>

        <div class="setting-row">
          <label>API URL</label>
          <input type="text" .value=${s.baseUrl} placeholder=${provider.defaultBaseUrl || 'https://your-api.com/v1'}
            @input=${(e: Event) => { this.settings = { ...s, baseUrl: (e.target as HTMLInputElement).value }; this.persistSettings(); }} />
        </div>

        <div class="setting-row">
          <label>模型</label>
          ${provider.models.length > 0 ? html`
            <select style="flex:1" @change=${(e: Event) => { this.settings = { ...s, model: (e.target as HTMLSelectElement).value }; this.persistSettings(); }}>
              ${provider.models.map(m => html`<option value=${m} ?selected=${s.model === m || (!provider.models.includes(s.model) && m === provider.models[0])}>${m}</option>`)}
            </select>
          ` : html`
            <input type="text" .value=${s.model} placeholder="模型名称"
              @input=${(e: Event) => { this.settings = { ...s, model: (e.target as HTMLInputElement).value }; this.persistSettings(); }} />
          `}
        </div>

        <div class="setting-row">
          <label>API Key</label>
          <input type="password" .value=${s.apiKey} placeholder="sk-..." autocomplete="off"
            @input=${(e: Event) => { this.settings = { ...s, apiKey: (e.target as HTMLInputElement).value }; this.persistSettings(); }} />
        </div>

        <div class="setting-row">
          <label title="温度：控制回答随机性。0=最确定,1=平衡,2=最有创造性">Temperature</label>
          <input type="range" min="0" max="2" step="0.1" .value=${String(s.temperature ?? 0.3)}
            @input=${(e: Event) => { this.settings = { ...s, temperature: parseFloat((e.target as HTMLInputElement).value) }; this.persistSettings(); }}
            style="flex:1" />
          <span class="temp-value" style="min-width:36px;text-align:right;font-family:ui-monospace,monospace">${(s.temperature ?? 0.3).toFixed(1)}</span>
        </div>
        <div class="setting-hint" style="font-size:11px;color:var(--dim);margin-left:90px;margin-top:-6px;margin-bottom:4px">
          控制 AI 回答随机性 · 0-0.3 知识问答/代码 · 0.4-0.7 日常对话 · 0.8-2.0 创意写作
        </div>

        <div class="setting-row">
          <label title="单次回答的最大 token 数。MiniMax-M3 1M context,推荐 65536">Max Tokens</label>
          <input type="range" min="1024" max="131072" step="1024" .value=${String(s.maxTokens ?? 65536)}
            @input=${(e: Event) => { this.settings = { ...s, maxTokens: parseInt((e.target as HTMLInputElement).value) }; this.persistSettings(); }}
            style="flex:1" />
          <span class="max-tokens-value" style="min-width:54px;text-align:right;font-family:ui-monospace,monospace">${s.maxTokens ?? 65536}</span>
        </div>

        <div class="setting-hint" style="font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);margin-left:90px;margin-bottom:8px;padding:6px 8px;background:var(--bg);border-radius:4px">
          [DEBUG] useKB=${this.useKB} useWeb=${this.useWeb} webUrl=${this.web?.url ? '已配置' : '空'} maxTokens=${s.maxTokens ?? 65536}
        </div>

        <div class="setting-actions">
          <button class="btn-test" @click=${() => this.onTestConnection()}>测试连接</button>
          ${this.testStatus ? html`
            <span class="test-result ${this.testStatus.ok ? 'ok' : 'fail'}">${this.testStatus.msg}</span>
          ` : nothing}
        </div>

        <div class="setting-row">
          <label class="checkbox-label">
            <input type="checkbox" ?checked=${this.useKB}
              @change=${(e: Event) => { this.useKB = (e.target as HTMLInputElement).checked; console.log('[chat] useKB →', this.useKB); }} />
            启用知识库检索（RAG）
          </label>
          <label class="checkbox-label" style="margin-left:16px">
            <input type="checkbox" ?checked=${this.useWeb}
              @change=${(e: Event) => { this.useWeb = (e.target as HTMLInputElement).checked; console.log('[chat] useWeb →', this.useWeb); }} />
            启用联网搜索
          </label>
        </div>
        ${this.useKB ? html`
          <div class="setting-row">
            <label>KB 检索范围</label>
            <button class="btn-path-pick" @click=${() => this.showPathPicker = true}>
              ${this.searchPaths.length === 0
                ? `📁 全部 (${this.allDirs.length} 个目录)`
                : `📁 ${this.searchPaths.length} 个目录`}
            </button>
          </div>
          ${this.searchPaths.length > 0 ? html`
            <div class="setting-hint" style="font-family:ui-monospace,monospace;font-size:11px;color:var(--accent);margin-left:90px;margin-bottom:4px">
              当前:${this.searchPaths.slice(0, 3).join(', ')}${this.searchPaths.length > 3 ? ` +${this.searchPaths.length - 3} 个` : ''}
              <button class="link-clear" @click=${() => this.searchPaths = []}>× 清除</button>
            </div>
          ` : nothing}
          <!-- V48: 检索模式 -->
          <div class="setting-row">
            <label>检索模式</label>
            <select class="modal-input" @change=${(e: Event) => { this.searchMode = (e.target as HTMLSelectElement).value as SearchMode; }}>
              <option value="hybrid" ?selected=${this.searchMode === 'hybrid'}>🔀 混合(BM25 + 向量)</option>
              <option value="bm25" ?selected=${this.searchMode === 'bm25'}>📝 纯 BM25</option>
              <option value="vector" ?selected=${this.searchMode === 'vector'}>🎯 纯向量</option>
            </select>
          </div>
          <!-- V49: 本地文件 KB 范围 -->
          <div class="setting-row">
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${this.includeLocal}
                @change=${(e: Event) => { this.includeLocal = (e.target as HTMLInputElement).checked; }} />
              📂 包含本地文件(已打开的 PDF 等)
            </label>
          </div>
        ` : nothing}
        </div>

        ${this.useWeb ? html`
          <div class="setting-row">
            <label>Web Provider</label>
            <select @change=${(e: Event) => {
              const id = (e.target as HTMLSelectElement).value as any;
              this.web = { ...this.web, provider: id, url: this.web.url || WEB_PROVIDER_LIST.find(p => p.id === id)!.defaultUrl };
              saveWebSettings(this.web);
            }}>
              ${WEB_PROVIDER_LIST.map(p => html`<option value=${p.id} ?selected=${this.web.provider === p.id}>${p.label}</option>`)}
            </select>
          </div>
          <div class="setting-row">
            <label>Web URL</label>
            <input type="text" .value=${this.web.url} placeholder="https://..."
              @input=${(e: Event) => { this.web = { ...this.web, url: (e.target as HTMLInputElement).value }; saveWebSettings(this.web); }} />
          </div>
          ${this.web.provider !== 'duckduckgo' && this.web.provider !== 'searxng' ? html`
            <div class="setting-row">
              <label>Web API Key</label>
              <input type="password" .value=${this.web.apiKey} placeholder="可选" autocomplete="off"
                @input=${(e: Event) => { this.web = { ...this.web, apiKey: (e.target as HTMLInputElement).value }; saveWebSettings(this.web); }} />
            </div>
          ` : nothing}
          <div class="setting-row">
            <label>最大结果数</label>
            <input type="number" min="1" max="10" .value=${String(this.web.maxResults)}
              @input=${(e: Event) => { const v = parseInt((e.target as HTMLInputElement).value); if (v >= 1) { this.web = { ...this.web, maxResults: v }; saveWebSettings(this.web); } }} />
          </div>
        ` : nothing}
      </div>

      ${this.useAgent ? html`
        <div class="setting-row">
          <label>Agent 工具</label>
          <div class="agent-tool-toggles">
            ${['kb_search', 'web_search', 'note_open', 'list_files', 'note_edit'].map(t => html`
              <label class="tool-toggle">
                <input type="checkbox"
                  ?checked=${this.enabledTools.includes(t)}
                  @change=${(e: Event) => {
                    const on = (e.target as HTMLInputElement).checked;
                    this.enabledTools = on
                      ? [...this.enabledTools, t]
                      : this.enabledTools.filter(x => x !== t);
                  }} />
                <span>${t}</span>
              </label>
            `)}
          </div>
        </div>
        <div class="setting-hint" style="font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);margin-left:90px;margin-bottom:8px">
          Agent 模式启用时,LLM 可调用工具(最多 5 步)。建议至少留 kb_search。
        </div>
      ` : nothing}

      <fieldset style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">
        <legend style="font-size:12px;color:var(--dim);padding:0 8px">💭 长期记忆 (V46)</legend>
        <div class="setting-row">
          <label class="checkbox-label">
            <input type="checkbox" ?checked=${this.memory.enabled}
              @change=${(e: Event) => { this.memory = { ...this.memory, enabled: (e.target as HTMLInputElement).checked }; saveMemorySettings(this.memory); }} />
            自动提取用户偏好/事实
          </label>
        </div>
        <div class="setting-row">
          <label class="checkbox-label">
            <input type="checkbox" ?checked=${this.memory.injectInPrompt}
              @change=${(e: Event) => { this.memory = { ...this.memory, injectInPrompt: (e.target as HTMLInputElement).checked }; saveMemorySettings(this.memory); }} />
            注入到 system prompt
          </label>
        </div>
        <div class="setting-row">
          <button class="modal-btn" @click=${() => this.openMemoryPanel()}>📚 查看记忆主题</button>
          <button class="modal-btn" @click=${() => this.exportMemory()}>📥 导出 Markdown</button>
        </div>
      </fieldset>
    `;
  }

  private renderMessage(m: UiMessage, idx: number) {
    const isUser = m.role === 'user';
    const kb = m.kbCitations || [];
    const web = m.webCitations || [];
    // RAG 状态标签 — 让用户一眼看到 KB/Web 检索是否真在工作
    const rag = m.ragStatus;
    return html`
      <div class="chat-msg ${isUser ? 'user' : 'assistant'}${m.error ? ' error' : ''}" data-idx=${idx}>
        <div class="chat-msg-meta">
          <span class="chat-msg-role">${isUser ? '你' : '助手'}</span>
          ${m.streaming ? html`<span class="chat-msg-streaming">●</span>` : nothing}
        </div>
        ${(kb.length > 0 || web.length > 0) ? html`
          <details class="chat-msg-citations" open>
            <summary>📚 参考来源 (${kb.length + web.length})</summary>
            ${kb.length > 0 ? html`
              <div class="citation-group">
                <div class="citation-group-label">本地知识库</div>
                ${kb.map((c, i) => html`
                  <div class="citation-card kb"
                    title="点击跳转到笔记"
                    @click=${() => this.dispatchEvent(new CustomEvent('open-citation', { detail: { path: c.path, snippet: c.snippet, score: c.score }, bubbles: true, composed: true }))}>
                    <div class="citation-card-head">
                      <span class="citation-card-tag">KB#${i + 1}</span>
                      <span class="citation-card-title">${c.title}</span>
                    </div>
                    <div class="citation-card-snippet">${c.snippet.slice(0, 140)}${c.snippet.length > 140 ? '…' : ''}</div>
                    <div class="citation-card-meta">
                      <span class="citation-card-path">${c.path}</span>
                      ${c.score != null ? html`<span class="citation-card-score">score: ${c.score.toFixed(2)}</span>` : nothing}
                    </div>
                  </div>
                `)}
              </div>
            ` : nothing}
            ${web.length > 0 ? html`
              <div class="citation-group">
                <div class="citation-group-label">联网搜索</div>
                ${web.map((c, i) => html`
                  <a class="citation-card web" href=${c.url} target="_blank" rel="noopener">
                    <div class="citation-card-head">
                      <span class="citation-card-tag">Web#${i + 1}</span>
                      <span class="citation-card-title">${c.title}</span>
                    </div>
                    <div class="citation-card-snippet">${c.content.slice(0, 140)}${c.content.length > 140 ? '…' : ''}</div>
                    <div class="citation-card-meta">
                      <span class="citation-card-url">${c.url}</span>
                    </div>
                  </a>
                `)}
              </div>
            ` : nothing}
          </details>
        ` : nothing}
        ${rag && !isUser ? html`
          <div class="chat-msg-rag">
            ${rag.useKB
              ? html`<span class="rag-tag ${rag.kb > 0 ? 'ok' : 'miss'}">${rag.kb > 0 ? '🟢' : '🟡'} RAG: ${rag.kb} KB hit${rag.kb === 1 ? '' : 's'}${rag.kb === 0 ? ' (知识库无匹配)' : ''}</span>`
              : html`<span class="rag-tag off">⚪ RAG off</span>`}
            ${rag.useWeb ? html`<span class="rag-tag ${rag.web > 0 ? 'ok' : 'miss'}">${rag.web > 0 ? '🟢' : '🟡'} Web: ${rag.web} hit${rag.web === 1 ? '' : 's'}</span>` : nothing}
          </div>
        ` : nothing}
        ${m.agentSteps && m.agentSteps.length > 0 ? html`
          <details class="agent-steps" open>
            <summary>🤖 Agent 步骤 (${m.agentSteps.length})</summary>
            ${m.agentSteps.map(s => html`
              <div class="agent-step">
                <div class="agent-step-head">
                  <span class="agent-step-num">#${s.step}</span>
                  ${s.tool ? html`<span class="agent-step-tool">🔧 ${s.tool.name}</span>` : ''}
                  ${s.durationMs != null ? html`<span class="agent-step-dur">${s.durationMs}ms</span>` : ''}
                </div>
                ${s.thought ? html`<div class="agent-step-thought">💭 ${s.thought}</div>` : ''}
                ${s.tool ? html`<div class="agent-step-args">${JSON.stringify(s.tool.args)}</div>` : ''}
                ${s.error ? html`<div class="agent-step-error">❌ ${s.error}</div>` : ''}
                ${s.result ? html`<details class="agent-step-result"><summary>结果</summary><pre>${s.result}</pre></details>` : ''}
              </div>
            `)}
          </details>
        ` : nothing}
        <div class="chat-msg-content">${m.content}</div>
        ${!isUser && !m.streaming ? html`
          <div class="chat-msg-actions">
            <button class="btn-copy ${m._copied === true ? 'copied' : ''}${m._copied === false ? 'failed' : ''}" title="复制回复" @click=${() => this.copyMessage(idx)}>
              ${m._copied === true ? '✅ 已复制' : m._copied === false ? '⚠️ 失败,长按选择' : '📋 复制'}
            </button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  /** V42-p2: 一键复制助手回复到剪贴板
 *  策略(按优先级):
 *  1. @capacitor/clipboard — Android 原生剪贴板,100% 可靠
 *  2. navigator.clipboard.writeText — 需 secure context
 *  3. textarea + execCommand('copy') — 旧 WebView 兼容,Android System WebView 多半失败
 */
  private async copyMessage(idx: number) {
    const msg = this.messages[idx];
    if (!msg) return;
    const text = msg.content;
    let ok = false;
    let method = '';
    // 1) Capacitor 原生(最稳)
    try {
      const { Clipboard } = await import('@capacitor/clipboard' as any);
      await Clipboard.write({ string: text });
      ok = true;
      method = 'capacitor';
    } catch (e1) {
      console.warn('[copy] Capacitor 失败,试 navigator.clipboard:', e1);
      // 2) Web API
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          ok = true;
          method = 'clipboard-api';
        }
      } catch (e2) {
        // 3) execCommand(兜底,基本在 Android System WebView 失败)
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.top = '0';
          ta.style.left = '0';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ok = document.execCommand('copy');
          method = ok ? 'execCommand' : 'all-failed';
          document.body.removeChild(ta);
        } catch (e3) {
          console.error('[copy] all methods failed:', e1, e2, e3);
        }
      }
    }
    console.log('[copyMessage]', { ok, method, len: text.length });
    // 视觉反馈
    this.messages = this.messages.map((m, i) =>
      i === idx ? { ...m, _copied: ok ? true : false } : m
    );
    setTimeout(() => {
      this.messages = this.messages.map((m, i) =>
        i === idx ? { ...m, _copied: undefined } : m
      );
    }, 1800);
  }

  /** V42: 左侧多会话侧边栏 */
  private renderSidebar() {
    const cur = this.sessions.find(s => s.id === this.currentSessionId);
    return html`
      <aside class="chat-sidebar">
        <div class="chat-sidebar-head">
          <button class="btn-new-session" title="新建会话" @click=${() => this.createNewSession()}>
            ＋ 新建会话
          </button>
        </div>
        <div class="chat-sidebar-list">
          ${this.sessions.length === 0 ? html`
            <div class="chat-sidebar-empty">还没有会话,点上面按钮新建</div>
          ` : this.sessions.map(s => html`
            <div class="chat-session-item ${s.id === this.currentSessionId ? 'active' : ''}"
              @click=${() => this.switchSession(s.id)}
              title=${new Date(s.updatedAt).toLocaleString('zh-CN')}>
              <div class="chat-session-title">
                ${s.messageCount > 0 ? '💬' : '📝'} ${s.title}
              </div>
              <div class="chat-session-meta">
                <span>${s.messageCount} 条</span>
                <span>${new Date(s.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          `)}
        </div>
        ${cur ? html`
          <div class="chat-sidebar-foot">
            <button class="btn-rename" title="重命名" @click=${() => this.renameCurrentSession()}>✏️ 改名</button>
            <button class="btn-delete-session" title="删除" @click=${() => this.deleteCurrentSession()}>🗑 删除</button>
          </div>
        ` : nothing}
      </aside>
    `;
  }

  render() {
    if (!this.settings) return nothing;
    const cur = this.sessions.find(s => s.id === this.currentSessionId);
    return html`
      ${this.open ? html`
        <div class="chat-overlay" @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.open = false;
        }}>
          <div class="chat-modal chat-modal-v42">
            ${this.showSidebar ? this.renderSidebar() : nothing}
            <div class="chat-main">
              <div class="chat-header">
                <button class="icon-btn" title="显示/隐藏会话列表" @click=${() => { this.showSidebar = !this.showSidebar; }}>
                  ${this.showSidebar ? '◀' : '▶'}
                </button>
                <h2>💬 ${cur?.title || 'AI 对话'}</h2>
                <div class="chat-header-actions">
                  <button class="icon-btn" title="设置" @click=${() => { this.showSettings = !this.showSettings; }}>⚙</button>
                  <button class="icon-btn" title="清空当前会话" @click=${() => this.onClearHistory()}>🗑</button>
                  <button class="icon-btn" @click=${() => { this.open = false; }}>✕</button>
                </div>
              </div>

              ${this.showSettings ? this.renderSettings() : nothing}

              <div class="chat-body">
                ${this.messages.length === 0 ? html`
                  <div class="chat-empty">
                    <p>👋 知识库助手就绪</p>
                    <p class="dim">${this.useKB ? '✅ RAG 已启用 · 回答会基于 vault 内的笔记' : '⚪ RAG 未启用 · 纯对话模式'}</p>
                    <p class="dim">📚 vault: ${this.vaultNoteCount} notes synced</p>
                    <p class="dim" style="font-family:ui-monospace,monospace;font-size:11px;opacity:0.6">[DEBUG] useKB=${this.useKB} useWeb=${this.useWeb} webUrl=${this.web?.url ? '已配置' : '空'}</p>
                    <p class="dim">设置 → 填 API Key → 提问</p>
                  </div>
                ` : this.messages.map((m, i) => this.renderMessage(m, i))}
              </div>

              <div class="chat-input">
                <textarea rows="2" placeholder="输入问题，按 Enter 发送，Shift+Enter 换行"
                  .value=${this.input}
                  @input=${(e: Event) => { this.input = (e.target as HTMLTextAreaElement).value; }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      this.send();
                    }
                  }}></textarea>
                ${this.sending ? html`
                  <button class="btn-stop" title="停止生成" @click=${() => this.stopGeneration()}>⏹ 停止</button>
                ` : html`
                  <button class="btn-send" ?disabled=${!this.input.trim()} @click=${() => this.send()}>发送</button>
                `}
              </div>
            </div>
          </div>
        </div>
      ` : html`
        <button class="chat-fab" title="AI 对话" @click=${() => { this.open = true; }}>💬</button>
      `}
      ${this.showPathPicker ? this.renderPathPicker() : nothing}
      ${this.showMemoryPanel ? this.renderMemoryPanel() : nothing}
    `;
  }

  /** V44: KB 检索范围选择器 */
  private renderPathPicker() {
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.showPathPicker = false;
      }}>
        <div class="modal-box">
          <h2>📁 KB 检索范围</h2>
          <p class="modal-sub">限定检索的目录(不选 = 全部)</p>
          <div class="path-picker-actions">
            <button class="modal-btn" @click=${() => this.searchPaths = []}>全部清除</button>
            <button class="modal-btn" @click=${() => this.searchPaths = [...this.allDirs]}>全选</button>
          </div>
          <div class="path-picker-list">
            ${this.allDirs.length === 0 ? html`
              <div class="path-picker-empty">还没有目录(同步 vault 后会出现)</div>
            ` : this.allDirs.map(d => html`
              <label class="path-picker-item">
                <input type="checkbox"
                  ?checked=${this.searchPaths.includes(d)}
                  @change=${(e: Event) => {
                    const on = (e.target as HTMLInputElement).checked;
                    this.searchPaths = on
                      ? [...this.searchPaths, d]
                      : this.searchPaths.filter(p => p !== d);
                  }} />
                <span>${d}/</span>
              </label>
            `)}
          </div>
          <div class="modal-actions">
            <button class="modal-btn" @click=${() => this.showPathPicker = false}>取消</button>
            <button class="modal-btn primary" @click=${() => this.showPathPicker = false}>完成</button>
          </div>
        </div>
      </div>
    `;
  }
}