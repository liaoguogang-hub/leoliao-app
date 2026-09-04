/**
 * Wiki 主页 — V47
 * v1.16.0 Phase W.1: 加"自动 Wiki 生成"模式 — 文件夹 → 概览 + 关键概念 + MOC + 时间线
 *
 * 展示 vault 全貌:
 * - 顶部统计(笔记数 / KB / chunks / wikilinks / 反向链接 / tags / 文件夹)
 * - 最近更新(20 篇)
 * - Tag 索引(按使用次数排序)
 * - 孤立笔记(没有 wikilink 进出)
 * - 反向链接查询(输入 path → 显示所有引用)
 * - 自动 Wiki 生成(v1.16.0):文件夹选择 → 一键生成 → 可保存为 .md
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  vaultStats, recentNotes, tagIndex, orphanNotes, backlinks,
  type VaultStats, type TagIndex, type BackLink,
} from '../services/wiki';
import {
  generateAutoWiki, renderAutoWikiAsMarkdown,
  type AutoWiki,
} from '../services/wiki-auto';

@customElement('ll-wiki-panel')
export class LlWikiPanel extends LitElement {
  protected createRenderRoot() { return this; }

  @state() private stats: VaultStats | null = null;
  @state() private recent: Array<{ path: string; title: string; mtime: number; size: number }> = [];
  @state() private tags: TagIndex[] = [];
  @state() private orphans: string[] = [];
  @state() private loading = true;
  @state() private backlinkQuery = '';
  @state() private backlinks: BackLink[] = [];
  @state() private backlinkSearching = false;
  // v1.16.0: 自动 Wiki 生成
  @state() private wikiTab: 'overview' | 'autogen' = 'overview';
  @state() private wikiPrefix = '';
  @state() private autoWiki: AutoWiki | null = null;
  @state() private autoWikiGenerating = false;

  async connectedCallback() {
    super.connectedCallback();
    await this.refresh();
  }

  private async refresh() {
    this.loading = true;
    // v1.48.0: 分开 await,单个失败/慢不阻塞其他数据(避免 Promise.all 全挂)
    try {
      const t0 = performance.now();
      try { this.stats = await vaultStats(); } catch (e) { console.warn('[wiki] vaultStats failed', e); }
      console.log(`[wiki] vaultStats done ${Math.round(performance.now() - t0)}ms`);
    } catch (e) { console.error('[wiki] stats failed', e); }
    try {
      const t1 = performance.now();
      try { this.recent = await recentNotes(20); } catch (e) { console.warn('[wiki] recent failed', e); }
      console.log(`[wiki] recent done ${Math.round(performance.now() - t1)}ms`);
    } catch (e) { console.error('[wiki] recent failed', e); }
    try {
      const t2 = performance.now();
      try { this.tags = await tagIndex(); } catch (e) { console.warn('[wiki] tags failed', e); }
      console.log(`[wiki] tags done ${Math.round(performance.now() - t2)}ms`);
    } catch (e) { console.error('[wiki] tags failed', e); }
    try {
      const t3 = performance.now();
      try { this.orphans = await orphanNotes(); } catch (e) { console.warn('[wiki] orphans failed', e); }
      console.log(`[wiki] orphans done ${Math.round(performance.now() - t3)}ms`);
    } catch (e) { console.error('[wiki] orphans failed', e); }
    this.loading = false;
  }

  private async searchBacklinks() {
    const q = this.backlinkQuery.trim();
    if (!q) {
      this.backlinks = [];
      return;
    }
    this.backlinkSearching = true;
    try {
      // 自动补 .md
      const target = q.endsWith('.md') ? q : q + '.md';
      this.backlinks = await backlinks(target);
    } finally {
      this.backlinkSearching = false;
    }
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  // v1.16.0: 自动 Wiki 生成
  private async runAutoGen() {
    this.autoWikiGenerating = true;
    try {
      this.autoWiki = await generateAutoWiki({ prefix: this.wikiPrefix });
    } catch (e) {
      console.warn('[wiki-panel] auto-gen failed:', e);
      this.autoWiki = null;
    } finally {
      this.autoWikiGenerating = false;
    }
  }

  // v1.16.0: 保存为 .md 文件 — v1.49: 失败给用户可见提示(不再静默吞)
  private async saveAutoWiki() {
    if (!this.autoWiki) {
      window.alert('请先生成 Wiki');
      return;
    }
    const md = renderAutoWikiAsMarkdown(this.autoWiki);
    if (!md || md.length < 10) {
      window.alert('生成的 Wiki 内容为空,无法保存');
      return;
    }
    try {
      const { saveToLocal } = await import('../services/export-service');
      // 构造一个伪 NoteFile 给 export-service(核心只需 content/path)
      const stub = {
        path: `${this.autoWiki.scope === '(whole vault)' ? 'vault' : this.autoWiki.scope.replace(/[\/\\]/g, '_')}-wiki`,
        title: `Wiki - ${this.autoWiki.scope}`,
        content: md,
        html: '',
        frontmatter: {},
        tags: [],
        links: [],
        mtime: Date.now(),
      } as any;
      const result = await saveToLocal(stub);
      if (result === null) {
        // 用户取消 picker,不提示
        return;
      }
      window.alert(`✅ 已保存: ${result.fileName}\n📁 ${result.location}`);
    } catch (e: any) {
      console.warn('[wiki-panel] save failed:', e);
      window.alert(`❌ 保存失败: ${e?.message || e}`);
    }
  }

  // v1.16.0: 渲染自动 Wiki 视图
  private renderAutoGen() {
    return html`
      <div class="autogen-section">
        <div class="autogen-input">
          <label>范围(文件夹前缀,空 = 整个 vault):</label>
          <input type="text" class="modal-input"
            .value=${this.wikiPrefix}
            placeholder="例:01.公众号 / 02.读书笔记"
            @input=${(e: Event) => { this.wikiPrefix = (e.target as HTMLInputElement).value; }} />
          <button class="btn-primary" @click=${() => this.runAutoGen()}
            ?disabled=${this.autoWikiGenerating}>
            ${this.autoWikiGenerating ? '⏳ 生成中...' : '✨ 生成 Wiki'}
          </button>
        </div>
        ${this.autoWiki ? this.renderAutoWikiResult(this.autoWiki) : html`
          <div class="autogen-empty">
            <p>👆 输入文件夹前缀(留空=整个 vault),点击"生成 Wiki"</p>
            <p class="dim">系统会汇总该范围的笔记,生成:</p>
            <ul class="dim">
              <li>📌 100 字概览</li>
              <li>🔑 Top10 关键概念</li>
              <li>🗂 MOC 索引(按 tag 聚合)</li>
              <li>📅 时间线(最近编辑)</li>
            </ul>
          </div>
        `}
      </div>
    `;
  }

  // v1.16.0: 渲染生成结果
  private renderAutoWikiResult(wiki: AutoWiki) {
    return html`
      <div class="autogen-result">
        <div class="autogen-meta">
          <span class="badge">📁 ${wiki.scope}</span>
          <span class="badge">📄 ${wiki.noteCount} 篇</span>
          <span class="badge">💾 ${(wiki.totalSize / 1024).toFixed(1)} KB</span>
          <span class="badge">⏱ ${wiki.durationMs}ms</span>
          <span class="badge">${wiki.source === 'llm' ? '🤖 LLM' : '📊 统计'}</span>
          <button class="btn-save" @click=${() => this.saveAutoWiki()}>💾 保存为 .md</button>
        </div>
        <div class="autogen-overview">${wiki.overview}</div>
        ${wiki.concepts.length > 0 ? html`
          <h4>🔑 关键概念</h4>
          <div class="autogen-concepts">
            ${wiki.concepts.map(c => html`
              <span class="concept-chip" title="${c.relatedPaths.length} 篇相关"
                style="opacity: ${0.5 + c.weight * 0.5}">
                ${c.term}
              </span>
            `)}
          </div>
        ` : nothing}
        ${wiki.mocs.length > 0 ? html`
          <h4>🗂 MOC 索引</h4>
          <div class="autogen-mocs">
            ${wiki.mocs.map(m => html`
              <details class="moc-group">
                <summary>#${m.tag} <span class="moc-count">(${m.count})</span></summary>
                <div class="moc-paths">
                  ${m.paths.slice(0, 30).map(p => html`
                    <a class="moc-path" @click=${() => this.openNote(p)}>${p}</a>
                  `)}
                  ${m.paths.length > 30 ? html`<span class="dim">... +${m.paths.length - 30} 篇</span>` : nothing}
                </div>
              </details>
            `)}
          </div>
        ` : nothing}
        ${wiki.timeline.length > 0 ? html`
          <h4>📅 时间线</h4>
          <div class="autogen-timeline">
            ${wiki.timeline.map(t => html`
              <div class="timeline-row" @click=${() => this.openNote(t.path)}>
                <span class="timeline-date">${new Date(t.mtime).toLocaleDateString('zh-CN')}</span>
                <span class="timeline-title">${t.title}</span>
              </div>
            `)}
          </div>
        ` : nothing}
      </div>
    `;
  }

  private openNote(path: string) {
    this.dispatchEvent(new CustomEvent('open-note', { detail: path, bubbles: true, composed: true }));
  }

  private fmtSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  render() {
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="modal-box" style="max-width:min(820px, 94vw); max-height:88vh; overflow:hidden">
          <h2>📖 Wiki 主页</h2>
          <p class="modal-sub">vault 全貌 · 双向链接 · Tag 索引 · 自动生成</p>

          <!-- v1.16.0: Tab 切换 -->
          <div class="wiki-tabs">
            <button class="wiki-tab ${this.wikiTab === 'overview' ? 'active' : ''}"
              @click=${() => this.wikiTab = 'overview'}>📊 总览</button>
            <button class="wiki-tab ${this.wikiTab === 'autogen' ? 'active' : ''}"
              @click=${() => this.wikiTab = 'autogen'}>✨ 自动 Wiki</button>
          </div>

          ${this.wikiTab === 'autogen' ? this.renderAutoGen() : (this.loading || !this.stats ? html`
            <p style="text-align:center;padding:30px">⏳ 加载中...</p>
          ` : html`
            <div class="wiki-overview-content">
            <!-- 统计卡片 -->
            <div class="wiki-stats">
              <div class="stat-card">
                <div class="stat-num">${this.stats.totalNotes}</div>
                <div class="stat-label">笔记</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">${this.stats.totalChunks.toLocaleString()}</div>
                <div class="stat-label">chunks</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">${this.stats.totalLinks}</div>
                <div class="stat-label">wikilinks</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">${this.stats.totalBackLinks}</div>
                <div class="stat-label">反向链接</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">${this.stats.totalTags}</div>
                <div class="stat-label">tags</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">${this.stats.folderCount}</div>
                <div class="stat-label">文件夹</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">${this.fmtSize(this.stats.totalSize)}</div>
                <div class="stat-label">总大小</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">${this.fmtSize(this.stats.avgNoteSize)}</div>
                <div class="stat-label">平均笔记</div>
              </div>
            </div>

            <div class="wiki-body">
              <!-- Tag 索引 -->
              <section class="wiki-section">
                <h3>🏷️ Tag 索引 (${this.tags.length})</h3>
                ${this.tags.length === 0 ? html`
                  <p class="muted">暂无 tag。给笔记 frontmatter 加 tags: [xxx, yyy] 试试。</p>
                ` : html`
                  <div class="wiki-tags">
                    ${this.tags.slice(0, 50).map(t => html`
                      <details class="wiki-tag">
                        <summary><b>#${t.tag}</b> <span class="muted">(${t.count})</span></summary>
                        <div class="wiki-tag-paths">
                          ${t.paths.map(p => html`
                            <a class="path-link" @click=${() => this.openNote(p)}>${p}</a>
                          `)}
                        </div>
                      </details>
                    `)}
                  </div>
                `}
              </section>

              <!-- 最近更新 -->
              <section class="wiki-section">
                <h3>🕐 最近更新 (${this.recent.length})</h3>
                <div class="wiki-recent">
                  ${this.recent.map(r => html`
                    <div class="wiki-recent-item" @click=${() => this.openNote(r.path)}>
                      <div class="wiki-recent-title">${r.title}</div>
                      <div class="wiki-recent-meta">
                        <span>${new Date(r.mtime).toLocaleDateString('zh-CN')}</span>
                        <span>${this.fmtSize(r.size)}</span>
                      </div>
                      <div class="wiki-recent-path">${r.path}</div>
                    </div>
                  `)}
                </div>
              </section>

              <!-- 反向链接查询 -->
              <section class="wiki-section">
                <h3>🔗 反向链接查询</h3>
                <div class="wiki-search-row">
                  <input
                    class="modal-input"
                    placeholder="输入笔记名(可省略 .md),例如 0-索引-内容矩阵"
                    .value=${this.backlinkQuery}
                    @input=${(e: Event) => { this.backlinkQuery = (e.target as HTMLInputElement).value; }}
                    @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.searchBacklinks(); }}
                  />
                  <button class="modal-btn primary" @click=${() => this.searchBacklinks()} ?disabled=${this.backlinkSearching}>
                    ${this.backlinkSearching ? '查...' : '查询'}
                  </button>
                </div>
                ${this.backlinks.length > 0 ? html`
                  <div class="wiki-backlinks">
                    <p class="muted">找到 ${this.backlinks.length} 个反向链接</p>
                    ${this.backlinks.map(b => html`
                      <div class="wiki-backlink" @click=${() => this.openNote(b.path)}>
                        <div class="wiki-backlink-title">${b.title}</div>
                        <div class="wiki-backlink-context">${b.context}</div>
                        <div class="wiki-backlink-path">${b.path}</div>
                      </div>
                    `)}
                  </div>
                ` : this.backlinkQuery && !this.backlinkSearching ? html`
                  <p class="muted">没有反向链接(未被引用)</p>
                ` : nothing}
              </section>

              <!-- 孤立笔记 -->
              ${this.orphans.length > 0 ? html`
                <section class="wiki-section">
                  <h3>🕳️ 孤立笔记 (${this.orphans.length})</h3>
                  <p class="muted">没有 wikilink 出,也没被引用 — 可能是新写的待整理</p>
                  <div class="wiki-orphans">
                    ${this.orphans.slice(0, 30).map(p => html`
                      <a class="path-link" @click=${() => this.openNote(p)}>${p}</a>
                    `)}
                    ${this.orphans.length > 30 ? html`<span class="muted"> + ${this.orphans.length - 30} 个</span>` : nothing}
                  </div>
                </section>
              ` : nothing}
            </div>
            </div>
          `)}

          <div class="modal-actions">
            <button class="modal-btn" @click=${() => this.refresh()}>🔄 刷新</button>
            <button class="modal-btn primary" @click=${() => this.close()}>关闭</button>
          </div>
        </div>
      </div>
    `;
  }
}