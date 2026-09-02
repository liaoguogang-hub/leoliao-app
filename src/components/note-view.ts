/**
 * 笔记视图 — 渲染单个 MD 笔记
 *
 * V43: 加 edit 模式(view/edit 切换 + textarea + markdown 预览 + 保存回 Dexie)
 */

import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import MarkdownIt from 'markdown-it';
import type { NoteFile } from '../types';

const localMd = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

@customElement('ll-note-view')
export class LlNoteView extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Object }) note: NoteFile | null = null;
  /** V43: edit 模式显示 textarea,否则渲染 markdown */
  @state() private editing = false;
  /** V43: edit 时的草稿 */
  @state() private draft = '';
  /** V43: 保存状态 undefined=未改, false=保存中 */
  @state() private saveStatus: boolean | undefined = undefined;

  private onLinkClick(e: MouseEvent, href: string) {
    if (href.startsWith('#wiki:')) {
      e.preventDefault();
      const target = decodeURIComponent(href.slice(6));
      this.dispatchEvent(new CustomEvent('wikilink', {
        detail: target,
        bubbles: true,
        composed: true,
      }));
    }
  }

  /** V43: 进入编辑模式 */
  private enterEdit() {
    if (!this.note) return;
    this.draft = this.note.content;
    this.editing = true;
    this.saveStatus = undefined;
    this.updateComplete.then(() => {
      const ta = this.querySelector('.note-editor-textarea') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      }
    });
  }

  /** V43: 取消编辑 */
  private cancelEdit() {
    if (this.saveStatus === false) return;
    if (this.draft !== (this.note?.content ?? '') && !confirm('放弃当前修改?')) return;
    this.editing = false;
    this.draft = '';
    this.saveStatus = undefined;
  }

  /** V43: 保存编辑 → 派发 note-save 事件给 main.ts */
  private saveEdit() {
    if (!this.note) return;
    const path = this.note.path;
    const content = this.draft;
    if (content === this.note.content) {
      this.editing = false;
      return;
    }
    this.saveStatus = false;
    const enc = new TextEncoder().encode(content);
    // 简易 hash(同步 JS 用 djb2)
    let h = 5381;
    for (let i = 0; i < enc.length; i++) h = ((h << 5) + h + enc[i]) | 0;
    const hash = (h >>> 0).toString(36);
    this.dispatchEvent(new CustomEvent('note-save', {
      detail: { path, content, hash, size: enc.length, mtime: Date.now() },
      bubbles: true,
      composed: true,
    }));
  }

  /** V43: 通知 note-saved 结果(由 main.ts 调用) */
  noteSaved(ok: boolean) {
    this.saveStatus = ok;
    if (ok) {
      this.editing = false;
      this.draft = '';
    }
  }

  private renderFrontmatter(fm: Record<string, unknown>) {
    const keys = Object.keys(fm).filter(k => k !== 'tags');
    if (keys.length === 0) return null;
    return html`
      <div class="frontmatter">
        ${keys.map(k => html`
          <div class="fm-row">
            <span class="fm-key">${k}</span>
            <span class="fm-val">${String(fm[k])}</span>
          </div>
        `)}
      </div>
    `;
  }

  private titleFromPath(path: string): string {
    const last = path.split('/').pop() || path;
    return last.replace(/\.md$/, '');
  }

  /** V43: toolbar 按钮 — 在光标位置插入 markdown */
  private insertAtCursor(snippet: string, wrap = false) {
    const ta = this.querySelector('.note-editor-textarea') as HTMLTextAreaElement | null;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = this.draft.slice(0, start);
    const sel = this.draft.slice(start, end);
    const after = this.draft.slice(end);
    let insert = snippet;
    let cursorOffset = snippet.length;
    if (wrap) {
      insert = snippet + sel + snippet;
      cursorOffset = snippet.length + sel.length;
    }
    this.draft = before + insert + after;
    this.saveStatus = undefined;
    this.updateComplete.then(() => {
      if (ta) {
        const pos = start + cursorOffset;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  }

  render() {
    if (!this.note) {
      return html`
        <div class="empty-state">
          <p>👈 从左侧选一篇笔记开始</p>
        </div>
      `;
    }

    const fm = this.note.frontmatter;
    const tags = this.note.tags;
    const isDirty = this.editing && this.draft !== this.note.content;

    return html`
      <article class="note ${this.editing ? 'editing' : ''}">
        <header class="note-header">
          <h1 class="note-title">${this.titleFromPath(this.note.path)}</h1>
          <div class="note-meta">
            <span class="path">📂 ${this.note.path}</span>
            <span class="size">${(this.note.content.length / 1024).toFixed(1)} KB</span>
          </div>
          <div class="note-actions">
            ${this.editing ? html`
              <button class="note-btn cancel" @click=${() => this.cancelEdit()}>取消</button>
              <button class="note-btn save primary"
                ?disabled=${this.saveStatus === false}
                @click=${() => this.saveEdit()}>
                ${this.saveStatus === false ? '保存中…' : isDirty ? '💾 保存' : '已保存'}
              </button>
            ` : html`
              <button class="note-btn edit" @click=${() => this.enterEdit()}>✏️ 编辑</button>
            `}
          </div>
        </header>

        ${this.renderFrontmatter(fm)}

        ${tags.length > 0 && !this.editing ? html`
          <div class="tags">
            ${tags.map(t => html`<span class="tag">#${t}</span>`)}
          </div>
        ` : null}

        ${this.editing ? html`
          <div class="note-toolbar">
            <button class="tb-btn" title="一级标题" @click=${() => this.insertAtCursor('\n# ')}>H1</button>
            <button class="tb-btn" title="二级标题" @click=${() => this.insertAtCursor('\n## ')}>H2</button>
            <button class="tb-btn" title="粗体" @click=${() => this.insertAtCursor('**', true)}><b>B</b></button>
            <button class="tb-btn" title="斜体" @click=${() => this.insertAtCursor('*', true)}><i>I</i></button>
            <button class="tb-btn" title="链接" @click=${() => this.insertAtCursor('[text](url)')}>🔗</button>
            <button class="tb-btn" title="列表" @click=${() => this.insertAtCursor('\n- ')}>•</button>
            <button class="tb-btn" title="代码块" @click=${() => this.insertAtCursor('\n```\n\n```\n')}>\`</button>
            <button class="tb-btn" title="引用" @click=${() => this.insertAtCursor('\n> ')}>&gt;</button>
            <span class="tb-meta">${this.draft.length} 字${isDirty ? ' • 未保存' : ' • 已保存'}</span>
          </div>
          <textarea
            class="note-editor-textarea"
            .value=${this.draft}
            @input=${(e: Event) => { this.draft = (e.target as HTMLTextAreaElement).value; this.saveStatus = undefined; }}
            spellcheck="false"
            autocomplete="off"></textarea>
          <div class="note-preview">
            <div class="note-preview-label">预览</div>
            ${unsafeHTML(localMd.render(this.draft))}
          </div>
        ` : html`
          <div class="note-body" @click=${(e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'A' && target.getAttribute('href')) {
              this.onLinkClick(e, target.getAttribute('href')!);
            }
          }}>
            ${unsafeHTML(this.note.html)}
          </div>
        `}

        ${this.note.links.length > 0 && !this.editing ? html`
          <footer class="note-footer">
            <div class="links-title">引用了 ${this.note.links.length} 篇：</div>
            <div class="links">
              ${this.note.links.map(l => html`
                <span class="link-ref" @click=${() => this.dispatchEvent(new CustomEvent('wikilink', { detail: l, bubbles: true, composed: true }))}>
                  ${l}
                </span>
              `)}
            </div>
          </footer>
        ` : null}
      </article>
    `;
  }
}