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
import { search as kbSearch, buildRAGPrompt, type SearchResult } from '../lib/search';
import { loadLLMSettings, saveLLMSettings } from '../services/llm-settings';
import { getChatHistory, appendChatMessage, clearChatHistory } from '../services/db';

interface UiMessage extends ChatMessage {
  id: number;
  citations?: SearchResult[];
  streaming?: boolean;
  error?: string;
}

@customElement('ll-chat-panel')
export class LlChatPanel extends LitElement {
  protected createRenderRoot() { return this; }

  @state() private open = false;
  @state() private settings!: LLMSettings;
  @state() private showSettings = false;
  @state() private messages: UiMessage[] = [];
  @state() private input = '';
  @state() private sending = false;
  @state() private useKB = true;             // 是否启用 KB 检索（RAG 模式）
  @state() private testStatus: { ok: boolean; msg: string } | null = null;

  async connectedCallback() {
    super.connectedCallback();
    this.settings = loadLLMSettings();
    await this.loadHistory();
  }

  private async loadHistory() {
    const rows = await getChatHistory();
    this.messages = rows
      .filter(r => r.role !== 'system')               // 不渲染历史里的 system
      .map<UiMessage>(r => ({
        id: r.id!,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        citations: r.citations ? JSON.parse(r.citations) : undefined,
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
    this.settings = {
      ...this.settings,
      provider: id,
      baseUrl: this.settings.baseUrl || preset.defaultBaseUrl,
      model: this.settings.model || preset.defaultModel,
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
    const userMsg: UiMessage = { id: 0, role: 'user', content: q };
    this.messages = [...this.messages, userMsg];
    await appendChatMessage({ role: 'user', content: q });

    // 2) KB 检索 + RAG prompt（如果启用）
    let ragSystem: string | undefined;
    let ragUser: string | undefined;
    let citations: SearchResult[] = [];
    if (this.useKB) {
      citations = await kbSearch(q, 5);
      const rag = buildRAGPrompt(q, citations);
      ragSystem = rag.system;
      ragUser = rag.user;          // KB 检索结果拼到 user 消息里
    }

    // 3) 助手消息占位（id 先给 0，stream 完成后回填真实 id）
    const assistantMsg: UiMessage = {
      id: 0,
      role: 'assistant',
      content: '',
      streaming: true,
      citations,
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
    // RAG 模式：最后一条 user 用 KB 增强版（ragUser）
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
        // 直接更新最后一个助手消息的 content
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
    const finalAssistant = { ...assistantMsg, content: fullText, streaming: false };
    this.messages = this.messages.map((m, i) =>
      i === this.messages.length - 1 ? finalAssistant : m
    );
    await appendChatMessage({
      role: 'assistant',
      content: fullText,
      citations: JSON.stringify(citations),
    });
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
            <select @change=${(e: Event) => { this.settings = { ...s, model: (e.target as HTMLSelectElement).value }; this.persistSettings(); }}>
              ${provider.models.map(m => html`<option value=${m} ?selected=${s.model === m}>${m}</option>`)}
            </select>
            <input type="text" class="model-custom" .value=${provider.models.includes(s.model) ? '' : s.model}
              placeholder="或自定义模型名"
              @input=${(e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) { this.settings = { ...s, model: v }; this.persistSettings(); } }} />
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
        </div>
      </div>
    `;
  }

  private renderMessage(m: UiMessage, idx: number) {
    const isUser = m.role === 'user';
    return html`
      <div class="chat-msg ${isUser ? 'user' : 'assistant'}${m.error ? ' error' : ''}" data-idx=${idx}>
        <div class="chat-msg-meta">
          <span class="chat-msg-role">${isUser ? '你' : '助手'}</span>
          ${m.streaming ? html`<span class="chat-msg-streaming">●</span>` : nothing}
        </div>
        <div class="chat-msg-content">${m.content}</div>
        ${m.citations && m.citations.length > 0 ? html`
          <div class="chat-msg-citations">
            ${m.citations.map((c, i) => html`
              <span class="citation" @click=${() => this.dispatchEvent(new CustomEvent('open-citation', { detail: c.path, bubbles: true, composed: true }))}>[${i + 1}] ${c.title}</span>
            `)}
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
                  <p class="dim">${this.useKB ? '已启用 RAG 检索，回答会基于 vault 内的笔记' : '未启用 RAG，纯对话模式'}</p>
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