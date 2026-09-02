/**
 * V51: 本地参考库面板
 *
 * 列出所有已索引的本地 PDF / EPUB 文件(从 Dexie 📕 / 📘 前缀 chunks 聚合)
 * 不需要 vault 文件树,不污染 sync,纯只读
 *
 * - 每个条目:文件名 + 类型(PDF / EPUB)+ chunks 数 + 总字数 + 最近索引时间
 * - 点击展开:显示 chunk 摘要(前 3 个 chunk 的 heading + 预览)
 */

import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface LocalFileSummary {
  path: string;            // 📕 xxx.pdf 或 📘 xxx.epub
  type: 'pdf' | 'epub';
  chunkCount: number;
  totalChars: number;
  lastIndexed: number;      // Date.now()
  sampleHeadings: string[]; // 前 3 个 chunk 的 heading
}

@customElement('ll-local-files-panel')
export class LlLocalFilesPanel extends LitElement {
  protected createRenderRoot() { return this; }

  @state() private files: LocalFileSummary[] = [];
  @state() private loading = true;
  @state() private expanded = new Set<string>();

  async connectedCallback() {
    super.connectedCallback();
    await this.load();
  }

  private async load() {
    this.loading = true;
    try {
      // Dexie 直查 (绕开任何封装)
      const db = await new Promise<any>((res, rej) => {
        const open = indexedDB.open('leoliao');
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const tx = db.transaction(['chunks'], 'readonly');
      const store = tx.objectStore('chunks');
      const all = await new Promise<any[]>((res) => {
        const out: any[] = [];
        const req = store.openCursor();
        req.onsuccess = (e: any) => {
          const cur = e.target.result;
          if (cur) { out.push(cur.value); cur.continue(); }
          else res(out);
        };
      });
      // 按 path 聚合
      const map = new Map<string, LocalFileSummary>();
      for (const c of all) {
        const p = c.path as string;
        if (!p.startsWith('📕') && !p.startsWith('📘')) continue;
        let s = map.get(p);
        if (!s) {
          s = {
            path: p,
            type: p.startsWith('📕') ? 'pdf' : 'epub',
            chunkCount: 0,
            totalChars: 0,
            lastIndexed: 0,
            sampleHeadings: [],
          };
          map.set(p, s);
        }
        s.chunkCount++;
        s.totalChars += (c.content?.length || 0);
        if (c.mtime && c.mtime > s.lastIndexed) s.lastIndexed = c.mtime;
        if (s.sampleHeadings.length < 3 && c.heading) {
          if (!s.sampleHeadings.includes(c.heading)) s.sampleHeadings.push(c.heading);
        }
      }
      this.files = [...map.values()].sort((a, b) => b.lastIndexed - a.lastIndexed);
    } catch (e) {
      console.error('[local-files-panel] load:', e);
      this.files = [];
    }
    this.loading = false;
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private toggle(path: string) {
    const next = new Set(this.expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.expanded = next;
  }

  private fmtTime(ts: number): string {
    if (!ts) return '-';
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private typeBadge(t: 'pdf' | 'epub'): string {
    return t === 'pdf' ? '📕 PDF' : '📘 EPUB';
  }

  render() {
    return html`
      <div class="modal-backdrop" @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}>
        <div class="modal-panel" style="max-width:720px;max-height:80vh;overflow:auto;">
          <div class="modal-header">
            <h2>📚 本地参考库</h2>
            <button class="close-btn" @click=${() => this.close()}>✕</button>
          </div>
          <div class="modal-body">
            <p style="font-size:13px;color:var(--dim);margin-top:0">
              ${this.loading ? '加载中...' :
                this.files.length === 0 ? '还没索引任何本地文件。点工具栏 📂 打开 PDF 或 EPUB 后会自动索引 + 自动存一份 md 进 vault。' :
                `已索引 ${this.files.length} 个本地文件 (PDF / EPUB),检索时勾"📂 包含本地文件"即可召回。`}
            </p>
            ${this.files.map(f => html`
              <div class="local-file-card" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;background:var(--card-bg);">
                <div style="display:flex;align-items:center;gap:8px;cursor:pointer" @click=${() => this.toggle(f.path)}>
                  <span style="font-size:18px">${this.expanded.has(f.path) ? '▼' : '▶'}</span>
                  <span style="font-weight:600">${this.typeBadge(f.type)}</span>
                  <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.path.replace(/^[📕📘] /, '').replace(/\.(pdf|epub)$/, '')}</span>
                  <span style="font-size:11px;color:var(--dim)">${f.chunkCount} chunks · ${f.totalChars.toLocaleString()} 字</span>
                </div>
                <div style="font-size:11px;color:var(--dim);margin-top:4px;margin-left:24px">
                  最近索引:${this.fmtTime(f.lastIndexed)}
                </div>
                ${this.expanded.has(f.path) ? html`
                  <div style="margin-top:8px;margin-left:24px;font-size:12px;color:var(--dim)">
                    <div style="font-weight:500;color:var(--text);margin-bottom:4px">章节预览:</div>
                    ${f.sampleHeadings.length === 0 ? html`<div>(暂无)</div>` :
                      f.sampleHeadings.map(h => html`<div style="padding:2px 0">• ${h}</div>`)}
                    <div style="margin-top:8px;color:var(--dim);font-size:11px">
                      💡 vault 中对应 md:<code style="font-size:11px">${f.path}.md</code>
                    </div>
                  </div>
                ` : ''}
              </div>
            `)}
          </div>
        </div>
      </div>
    `;
  }
}