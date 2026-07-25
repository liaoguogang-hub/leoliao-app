/**
 * 分享面板 — 分享当前打开的笔记
 * V29: 优先用 Capacitor Share,降级 navigator.share,再降级展示+复制
 * V31: 新增导出 HTML / PDF
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import type { NoteFile } from '../types';
import type { ThemeSettings } from '../services/settings';
import { exportHTML, exportPDF } from '../services/export-service';

@customElement('ll-share-panel')
export class LlSharePanel extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Object }) note: NoteFile | null = null;
  @property({ type: Object }) settings: ThemeSettings | null = null;

  private shareText(): string {
    if (!this.note) return '';
    const title = this.note.path.split('/').pop()?.replace(/\.md$/, '') || '笔记';
    const MAX_CHARS = 5000;
    const content = this.note.content.length > MAX_CHARS
      ? this.note.content.slice(0, MAX_CHARS) + `\n\n[...原笔记共 ${this.note.content.length} 字, 此处截断显示前 ${MAX_CHARS} 字, 完整版请到 知识库 APP 查看]`
      : this.note.content;
    return `📝 ${title}\n📂 ${this.note.path}\n\n${content}\n\n— 来自 知识库 APP`;
  }

  private async shareViaCapacitor() {
    if (!this.note) return;
    try {
      await Share.share({
        title: this.note.path.split('/').pop()?.replace(/\.md$/, '') || '笔记',
        text: this.shareText(),
        dialogTitle: '分享笔记',
      });
    } catch (e) {
      console.warn('Capacitor Share 失败,降级:', e);
      await this.shareViaWebAPI();
    }
  }

  private async shareViaWebAPI() {
    if (!this.note || !(navigator as any).share) {
      this.copyToClipboard();
      return;
    }
    try {
      await (navigator as any).share({
        title: this.note.path.split('/').pop()?.replace(/\.md$/, '') || '笔记',
        text: this.shareText(),
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.copyToClipboard();
      }
    }
  }

  private async copyToClipboard() {
    if (!this.note) return;
    const text = this.shareText();
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); alert('已复制到剪贴板'); }
      catch { alert('复制失败,请手动复制: ' + text); }
      document.body.removeChild(ta);
    }
  }

  private async doShare() {
    if (Capacitor.isNativePlatform()) {
      await this.shareViaCapacitor();
    } else {
      await this.shareViaWebAPI();
    }
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  // V31: 导出 HTML
  private async doExportHTML() {
    if (!this.note) return;
    const settings: ThemeSettings = this.settings || await import('../services/settings').then(m => m.loadSettings());
    await exportHTML(this.note, settings);
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  // V32: 导出 PDF (适配 async + Capacitor.isNativePlatform)
  private async doExportPDF() {
    if (!this.note) return;
    const settings: ThemeSettings = this.settings || await import('../services/settings').then(m => m.loadSettings());
    await exportPDF(this.note, settings, () => {
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    });
  }

  render() {
    if (!this.note) {
      return html`
        <div class="modal-overlay" @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
        }}>
          <div class="modal">
            <div class="modal-header">
              <h2>↗️ 分享</h2>
              <button class="modal-close" @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>✕</button>
            </div>
            <div class="modal-body">
              <p style="text-align:center;padding:40px;color:var(--dim)">⚠️ 当前没打开笔记</p>
            </div>
          </div>
        </div>
      `;
    }
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
      }}>
        <div class="modal">
          <div class="modal-header">
            <h2>↗️ 分享 / 导出</h2>
            <button class="modal-close" @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>✕</button>
          </div>
          <div class="modal-body">
            <div class="share-meta">
              <div class="share-title">${this.note.path.split('/').pop()?.replace(/\.md$/, '')}</div>
              <div class="share-path">📂 ${this.note.path}</div>
              <div class="share-size">📏 ${(this.note.content.length / 1024).toFixed(1)} KB</div>
            </div>
            <div class="share-preview">${this.shareText()}</div>
            <div class="share-actions">
              <button class="primary" @click=${() => this.doShare()}>📤 分享原文到微信/飞书等</button>
              <button @click=${() => this.doExportHTML()}>📄 导出 HTML 文件</button>
              <button @click=${() => this.doExportPDF()}>📕 导出 / 打印 PDF</button>
              <button @click=${() => this.copyToClipboard()}>📋 仅复制到剪贴板</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
