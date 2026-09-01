/**
 * 对话面板 — LLM 聊天 UI
 *
 * 设计：
 * - 浮动按钮 (FAB) 在右下角，点开 modal
 * - modal 内：可折叠的设置面板 + 消息列表 + 输入区
 * - 设置：provider / URL / 模型 / API Key / 测试连接 / 是否启用 KB 检索
 * - 消息流式渲染（chatStream），助手消息底部显示引用 [1][2]...
 * - 对话历史持久化到 Dexie v4 chat 表
 * - 单会话（'default'），上限 200 条滚动删旧
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { PROVIDERS, PROVIDER_LIST, type ProviderId } from '../lib/llm-providers';
import { chatStream, testConnection, type ChatMessage, type LLMSettings } from '../lib/llm';
import { search as kbSearch, buildFullRAGPrompt, type SearchResult } from '../lib/search';
import { webSearch, WEB_PROVIDER_LIST, type WebSearchSettings } from '../lib/web-search';
import { loadLLMSettings, saveLLMSettings } from '../services/llm-settings';
import { loadWebSettings, saveWebSettings } from '../services/web-settings';
import { getChatHistory, appendChatMessage, clearChatHistory, db } from '../services/db';

interface WebResult { title: string; url: string; content: string }

interface UiMessage extends ChatMessage {
  id: number;
  kbCitations?: SearchResult[];
  webCitations?: WebResult[];
  streaming?: boolean;
  error?: string;
  /** RAG/Web 状态标签：发送时快照,UI 直接展示,方便用户判断 RAG 是否真的工作 */
  ragStatus?: { kb: number; web: number; useKB: boolean; useWeb: boolean };
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
  @state() private testStatus: { ok: boolean; msg: string } | null = null;
  @state() private vaultNoteCount = 0;     // vault 已同步笔记数 (Dexie notes.count)

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
    await this.loadHistory();
    // 加载 vault 笔记数，给 UI 显示"已同步 N 条"信息
    try {
      this.vaultNoteCount = await db().notes.count();
    } catch {}
  }

  private async loadHistory() {
    const rows = await getChatHistory();
    this.messages = rows
      .filter(r => r.role !== 'system')               // 不渲染历史里的 system
      .map<UiMessage>(r => ({
        id: r.id!,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        kbCitations: r.citations ? JSON.parse(r.citations) : undefined,  // 兼容老数据
      }));
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
    this.input = '';
    this.testStatus = null;

    // 1) 用户消息入库 + 上屏
    // 用 appendChatMessage 返回的真实 id，让下面 filter `m.id !== 0` 不会误把当前问题也排除
    // (老 bug：userMsg.id=0 时被 filter 掉 → messages 空数组 → "chat content is empty")
    const userMsgId = await appendChatMessage({ role: 'user', content: q });
    const userMsg: UiMessage = { id: userMsgId, role: 'user', content: q };
    this.messages = [...this.messages, userMsg];

    // 2) KB 检索 + 联网搜索（按开关）
    let ragSystem: string | undefined;
    let ragUser: string | undefined;
    let kbCitations: SearchResult[] = [];
    let webCitations: WebResult[] = [];
    if (this.useKB) {
      // 不传 k，用 search.ts 默认 9999（实际全召回，按 BM25 分数排，受 30K 字符安全阀限制）
      kbCitations = await kbSearch(q);
    }
    if (this.useWeb && this.web.url) {
      try {
        webCitations = await webSearch(q, this.web);
      } catch (e) {
        console.warn('web search failed', e);
      }
    }
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
    if (ragSystem) messages.push({ role: 'system', content: ragSystem });
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

    // 5) 流式请求
    let fullText = '';
    try {
      const stream = chatStream(messages, this.settings);
      for await (const delta of stream) {
        fullText += delta;
        const idx = this.messages.length - 1;
        const updated = [...this.messages];
        updated[idx] = { ...updated[idx], content: fullText };
        this.messages = updated;
      }
    } catch (e: any) {
      this.messages = this.messages.map((m, i) =>
        i === this.messages.length - 1 ? { ...m, content: fullText + `\n\n[错误: ${e?.message || e}]`, streaming: false, error: e?.message } : m
      );
      this.sending = false;
      return;
    }

    // 6) 流式完成 → 入库
    // 把 kb+web 引用都存到 db（兼容老字段 citations）
    const citationsBlob = JSON.stringify({ kb: kbCitations, web: webCitations });
    const assistantId = await appendChatMessage({
      role: 'assistant',
      content: fullText,
      citations: citationsBlob,
    });
    // 用真实 id 回填 assistantMsg，让下次 send() 的 filter `m.id !== 0` 不会误排除它
    // (老 bug：assistantMsg.id=0 → 下次多轮对话上下文断了,只剩 user 没 assistant)
    const finalAssistant = { ...assistantMsg, id: assistantId, content: fullText, streaming: false };
    this.messages = this.messages.map((m, i) =>
      i === this.messages.length - 1 ? finalAssistant : m
    );
    this.sending = false;
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

        <div class="setting-actions">
          <button class="btn-test" @click=${() => this.onTestConnection()}>测试连接</button>
          ${this.testStatus ? html`
            <span class="test-result ${this.testStatus.ok ? 'ok' : 'fail'}">${this.testStatus.msg}</span>
          ` : nothing}
        </div>

        <div class="setting-row">
          <label class="checkbox-label">
            <input type="checkbox" .checked=${this.useKB}
              @change=${(e: Event) => { this.useKB = (e.target as HTMLInputElement).checked; }} />
            启用知识库检索（RAG）
          </label>
          <label class="checkbox-label" style="margin-left:16px">
            <input type="checkbox" .checked=${this.useWeb}
              @change=${(e: Event) => { this.useWeb = (e.target as HTMLInputElement).checked; }} />
            启用联网搜索
          </label>
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
    `;
  }

  private renderMessage(m: UiMessage, idx: number) {
    const isUser = m.role === 'user';
    const kb = m.kbCitations || [];
    const web = m.webCitations || [];
    // 兼容老数据：citations 字段可能含数组
    const legacy = (m as any).citations;
    const legacyArr: any[] = Array.isArray(legacy) ? legacy : (legacy?.kb || []);
    // RAG 状态标签 — 让用户一眼看到 KB/Web 检索是否真在工作
    const rag = m.ragStatus;
    return html`
      <div class="chat-msg ${isUser ? 'user' : 'assistant'}${m.error ? ' error' : ''}" data-idx=${idx}>
        <div class="chat-msg-meta">
          <span class="chat-msg-role">${isUser ? '你' : '助手'}</span>
          ${m.streaming ? html`<span class="chat-msg-streaming">●</span>` : nothing}
        </div>
        <div class="chat-msg-content">${m.content}</div>
        ${(kb.length > 0 || web.length > 0 || legacyArr.length > 0) ? html`
          <div class="chat-msg-citations">
            ${kb.map((c, i) => html`
              <span class="citation kb" title=${c.path} @click=${() => this.dispatchEvent(new CustomEvent('open-citation', { detail: c.path, bubbles: true, composed: true }))}>[KB${i + 1}] ${c.title}</span>
            `)}
            ${web.map((c, i) => html`
              <a class="citation web" href=${c.url} target="_blank" rel="noopener">[Web${i + 1}] ${c.title}</a>
            `)}
          </div>
        ` : nothing}
        ${rag && !isUser ? html`
          <div class="chat-msg-rag">
            ${rag.useKB
              ? html`<span class="rag-tag ${rag.kb > 0 ? 'ok' : 'miss'}">${rag.kb > 0 ? '🟢' : '🟡'} RAG: ${rag.kb} KB hit${rag.kb === 1 ? '' : 's'}${rag.kb === 0 ? ' (知识库无匹配)' : ''}</span>`
              : html`<span class="rag-tag off">⚪ RAG off</span>`}
            ${rag.useWeb ? html`<span class="rag-tag ${rag.web > 0 ? 'ok' : 'miss'}">${rag.web > 0 ? '🟢' : '🟡'} Web: ${rag.web} hit${rag.web === 1 ? '' : 's'}</span>` : nothing}
          </div>
        ` : nothing}
      </div>
    `;
  }

  render() {
    if (!this.settings) return nothing;
    return html`
      ${this.open ? html`
        <div class="chat-overlay" @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.open = false;
        }}>
          <div class="chat-modal">
            <div class="chat-header">
              <h2>💬 AI 对话</h2>
              <div class="chat-header-actions">
                <button class="icon-btn" title="设置" @click=${() => { this.showSettings = !this.showSettings; }}>⚙</button>
                <button class="icon-btn" title="清空" @click=${() => this.onClearHistory()}>🗑</button>
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
              <button class="btn-send" ?disabled=${this.sending || !this.input.trim()} @click=${() => this.send()}>
                ${this.sending ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      ` : html`
        <button class="chat-fab" title="AI 对话" @click=${() => { this.open = true; }}>💬</button>
      `}
    `;
  }
}