/**
 * 本地文件渲染组件 — V33
 * 显示一个 OpenedFile(从 file-opener.ts 来的)
 * 包括文件元信息(名/大小/MIME) + 渲染好的 HTML
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { OpenedFile } from '../services/file-opener';

@customElement('ll-file-viewer')
export class LlFileViewer extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Object }) file: OpenedFile | null = null;

  render() {
    if (!this.file) return html`<div class="empty"></div>`;

    const f = this.file;
    const sizeKB = (f.size / 1024).toFixed(1);
    const icon = iconForExt(f.ext);

    return html`
      <div class="file-viewer">
        <div class="file-meta">
          <div class="file-icon">${icon}</div>
          <div class="file-info">
            <div class="file-name">${f.name}</div>
            <div class="file-detail">
              <span class="file-badge">${f.ext.toUpperCase()}</span>
              <span>📦 ${sizeKB} KB</span>
              <span>🎨 ${f.mimeType}</span>
              <span>📍 本地文件</span>
            </div>
            ${f.warning ? html`<div class="file-warning">⚠️ ${f.warning}</div>` : ''}
          </div>
        </div>
        <div class="file-body" .innerHTML=${f.html}></div>
      </div>
    `;
  }
}

function iconForExt(ext: string): string {
  const map: Record<string, string> = {
    md: '📝', markdown: '📝',
    html: '🌐', htm: '🌐',
    txt: '📄',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
    pdf: '📕',
    docx: '📘',
    ppt: '📊', pptx: '📊',
  };
  return map[ext] || '📎';
}