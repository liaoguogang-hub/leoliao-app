/**
 * 笔记视图 — 渲染单个 MD 笔记
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { NoteFile } from '../types';

@customElement('ll-note-view')
export class LlNoteView extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Object }) note: NoteFile | null = null;

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

    return html`
      <article class="note">
        <header class="note-header">
          <h1 class="note-title">${this.titleFromPath(this.note.path)}</h1>
          <div class="note-meta">
            <span class="path">📂 ${this.note.path}</span>
            <span class="size">${(this.note.content.length / 1024).toFixed(1)} KB</span>
          </div>
        </header>

        ${this.renderFrontmatter(fm)}

        ${tags.length > 0 ? html`
          <div class="tags">
            ${tags.map(t => html`<span class="tag">#${t}</span>`)}
          </div>
        ` : null}

        <div class="note-body" @click=${(e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.tagName === 'A' && target.getAttribute('href')) {
            this.onLinkClick(e, target.getAttribute('href')!);
          }
        }}>
          ${unsafeHTML(this.note.html)}
        </div>

        ${this.note.links.length > 0 ? html`
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