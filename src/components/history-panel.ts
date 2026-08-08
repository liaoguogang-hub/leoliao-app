/**
 * 历史面板 — V39
 * 弹窗显示最近打开过的笔记 + 本地文件
 *
 * - 笔记:点击重新打开
 * - 本地文件:点快照恢复(<= 512KB);超过的只显示元信息,不能恢复
 * - 每条右侧 ✕ 单独删除,顶部 🗑 一键清空
 */

import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  getRecentHistory, deleteHistory, clearHistory,
  type HistoryEntry,
} from '../services/db';
import { renderBytesToHtml } from '../services/file-opener';

@customElement('ll-history-panel')
export class LlHistoryPanel extends LitElement {
  protected createRenderRoot() { return this; }

  @state() private entries: HistoryEntry[] = [];
  @state() private loading = true;

  async connectedCallback() {
    super.connectedCallback();
    await this.load();
  }

  private async load() {
    this.loading = true;
    try {
      this.entries = await getRecentHistory();
    } catch (e) {
      console.error('[history-panel] load:', e);
      this.entries = [];
    }
    this.loading = false;
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private async openEntry(e: HistoryEntry) {
    if (e.type === 'note' && e.path) {
      this.dispatchEvent(new CustomEvent('open-note', {
        detail: e.path, bubbles: true, composed: true,
      }));
      this.close();
      return;
    }
    if (e.type === 'local' && e.bytes && e.bytes.byteLength > 0) {
      // 用历史快照重建 view
      const f = await renderBytesToHtml(e);
      if (f) {
        this.dispatchEvent(new CustomEvent('open-local', {
          detail: f, bubbles: true, composed: true,
        }));
        this.close();
        return;
      }
    }
    // 本地文件没快照 / 旧数据/ 解析失败:什么都不做
    alert('这个本地文件没有保存快照(可能 > 512KB 或旧版本记录),无法快速打开。请重新从 📂 选择。');
  }

  private async removeOne(e: Event, id: string) {
    e.stopPropagation();
    try {
      await deleteHistory(id);
      this.entries = this.entries.filter((x) => x.id !== id);
    } catch (err) {
      console.error('[history-panel] delete:', err);
    }
  }

  private async clearAll() {
    if (!confirm('确定清空所有历史记录?')) return;
    try {
      await clearHistory();
      this.entries = [];
    } catch (err) {
      console.error('[history-panel] clear:', err);
    }
  }

  private relTime(ts: number): string {
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '刚刚';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    const date = new Date(ts);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private iconFor(type: string, ext?: string): string {
    if (type === 'note') return '📝';
    const map: Record<string, string> = {
      md: '📝', markdown: '📝',
      html: '🌐', htm: '🌐',
      txt: '📄',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
      pdf: '📕',
      docx: '📘',
    };
    return map[(ext || '').toLowerCase()] || '📎';
  }

  private renderEntry(e: HistoryEntry) {
    const canReopen = e.type === 'note' || (e.bytes && e.bytes.byteLength > 0);
    const sizeStr = e.size > 0 ? `${(e.size / 1024).toFixed(1)} KB` : '';
    const subParts: string[] = [];
    if (e.type === 'note' && e.path) subParts.push(e.path);
    if (e.type === 'local' && e.ext) subParts.push(e.ext.toUpperCase());
    if (sizeStr) subParts.push(sizeStr);
    if (!e.bytes && e.type === 'local') subParts.push('⚠️ 无快照');
    subParts.push(this.relTime(e.openedAt));

    return html`
      <div class="hist-row ${canReopen ? 'clickable' : 'disabled'}"
           @click=${() => canReopen && this.openEntry(e)}>
        <div class="hist-icon">${this.iconFor(e.type, e.ext)}</div>
        <div class="hist-info">
          <div class="hist-name">${e.name}</div>
          <div class="hist-meta">${subParts.join(' · ')}</div>
        </div>
        <button class="hist-remove" @click=${(ev: Event) => this.removeOne(ev, e.id)} title="删除">✕</button>
      </div>
    `;
  }

  render() {
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.close();
      }}>
        <div class="modal">
          <div class="modal-header">
            <h2>🕘 历史</h2>
            <button class="modal-close" @click=${() => this.close()}>✕</button>
          </div>
          ${this.entries.length > 0 ? html`
            <div class="hist-toolbar">
              <span class="hist-count">${this.entries.length} 条</span>
              <button class="hist-clear-all" @click=${() => this.clearAll()}>🗑 清空</button>
            </div>
          ` : ''}
          <div class="modal-body">
            ${this.loading ? html`<div class="empty-state">加载中...</div>` : ''}
            ${!this.loading && this.entries.length === 0 ? html`
              <div class="empty-state">
                <p>📂 还没有历史记录</p>
                <p style="font-size:12px;color:var(--dim);">打开过的笔记和本地文件会显示在这里</p>
              </div>
            ` : ''}
            ${this.entries.map((e) => this.renderEntry(e))}
          </div>
        </div>
      </div>
    `;
  }
}
