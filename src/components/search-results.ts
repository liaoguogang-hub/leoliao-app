/**
 * v1.13.0 Phase R.2 — 全文/语义模式检索结果列表
 *
 * 跟 ll-file-tree(路径模式)并列,显示 SearchResult[] 风格的卡片列表
 *
 * 设计要点:
 * - 卡片布局:title + path + heading + snippet + score
 * - snippet 高亮 query token(粗体 + 黄色背景)
 * - 空态/加载态/有结果 三种状态
 * - 点击 → 调 onNoteOpen(path) → 父组件打开笔记
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SearchResult } from '../lib/search';

@customElement('ll-search-results')
export class LlSearchResults extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Array }) results: SearchResult[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ type: String }) query = '';
  @property({ type: String }) selectedPath = '';
  @property({ type: Function }) onNoteOpen?: (path: string, idx?: number) => void;

  /** 高亮 query token(粗体 + 黄底) */
  private highlightSnippet(snippet: string, query: string): unknown {
    if (!query) return snippet;
    // 把 query 按空格切,逐个 token 高亮(大小写不敏感)
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (tokens.length === 0) return snippet;

    // 构造正则(转义特殊字符)
    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = snippet.split(re);
    return parts.map((part, i) => {
      // 偶数索引 = 匹配之间的非匹配部分,奇数 = 匹配部分
      if (i % 2 === 1) {
        return html`<mark class="snippet-hl">${part}</mark>`;
      }
      return part;
    });
  }

  /** 渲染单条结果卡片 */
  private renderResult(r: SearchResult, idx: number) {
    const isActive = r.path === this.selectedPath;
    const score = r.score.toFixed(3);
    return html`
      <div
        class="result-card ${isActive ? 'active' : ''}"
        @click=${() => { if (this.onNoteOpen) this.onNoteOpen(r.path, r.idx); }}
      >
        <div class="result-head">
          <span class="result-idx">#${idx + 1}</span>
          <span class="result-title">${r.title}</span>
          <span class="result-score" title="Rerank/融合分数">${score}</span>
        </div>
        ${r.heading && r.heading !== r.title ? html`
          <div class="result-heading">📌 ${r.heading}</div>
        ` : nothing}
        <div class="result-snippet">${this.highlightSnippet(r.snippet, this.query)}</div>
        <div class="result-path">📂 ${r.path}</div>
      </div>
    `;
  }

  render() {
    // 1) 加载中
    if (this.loading) {
      return html`
        <div class="search-state">
          <div class="spinner"></div>
          <div class="search-state-text">检索中...</div>
        </div>
      `;
    }

    // 2) 无 query
    if (!this.query) {
      return html`
        <div class="search-state">
          <div class="search-state-icon">🔍</div>
          <div class="search-state-text">输入关键词开始检索</div>
        </div>
      `;
    }

    // 3) 有 query 但无结果
    if (this.results.length === 0) {
      return html`
        <div class="search-state">
          <div class="search-state-icon">📭</div>
          <div class="search-state-text">未找到匹配 "<b>${this.query}</b>" 的内容</div>
          <div class="search-state-hint">试试换关键词,或检查拼写</div>
        </div>
      `;
    }

    // 4) 有结果
    return html`
      <div class="search-results">
        <div class="results-meta">${this.results.length} 条结果 · 命中 "${this.query}"</div>
        ${this.results.map((r, i) => this.renderResult(r, i))}
      </div>
    `;
  }
}
