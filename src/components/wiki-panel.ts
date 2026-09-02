/**
 * Wiki 主页 — V47
 *
 * 展示 vault 全貌:
 * - 顶部统计(笔记数 / KB / chunks / wikilinks / 反向链接 / tags / 文件夹)
 * - 最近更新(20 篇)
 * - Tag 索引(按使用次数排序)
 * - 孤立笔记(没有 wikilink 进出)
 * - 反向链接查询(输入 path → 显示所有引用)
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  vaultStats, recentNotes, tagIndex, orphanNotes, backlinks,
  type VaultStats, type TagIndex, type BackLink,
} from '../services/wiki';

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

  async connectedCallback() {
    super.connectedCallback();
    await this.refresh();
  }

  private async refresh() {
    this.loading = true;
    try {
      const [s, r, t, o] = await Promise.all([
        vaultStats(),
        recentNotes(20),
        tagIndex(),
        orphanNotes(),
      ]);
      this.stats = s;
      this.recent = r;
      this.tags = t;
      this.orphans = o;
    } catch (e) {
      console.error('[wiki] refresh failed', e);
    } finally {
      this.loading = false;
    }
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
        <div class="modal-box" style="max-width:820px; max-height:88vh">
          <h2>📖 Wiki 主页</h2>
          <p class="modal-sub">vault 全貌 · 双向链接 · Tag 索引</p>

          ${this.loading || !this.stats ? html`
            <p style="text-align:center;padding:30px">⏳ 加载中...</p>
          ` : html`
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
          `}

          <div class="modal-actions">
            <button class="modal-btn" @click=${() => this.refresh()}>🔄 刷新</button>
            <button class="modal-btn primary" @click=${() => this.close()}>关闭</button>
          </div>
        </div>
      </div>
    `;
  }
}