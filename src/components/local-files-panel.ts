/**
 * V51: 本地参考库面板
 *
 * 列出所有已索引的本地 PDF / EPUB 文件(从 Dexie 📕 / 📘 前缀 chunks 聚合)
 * 不需要 vault 文件树,不污染 sync,纯只读
 *
 * - 每个条目:文件名 + 类型(PDF / EPUB)+ chunks 数 + 总字数 + 最近索引时间
 * - 点击展开:显示 chunk 摘要(前 3 个 chunk 的 heading + 预览)
 * - V52.7: 展开后底部加 🗑 删除按钮 — 删 IndexedDB 里的 chunks + vectors + notes + manifest
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
  /** v1.25.0: 重索引状态(显示在 UI) */
  @state() private reindexing = false;
  @state() private reindexProgress = '';

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
      // v1.43.0: 过滤掉 `.md` 结尾的残留副本(它们是 note 误存成 chunk,真内容在同名无 .md 的条目里)
      // 若同名无 .md 的条目存在,则这个 .md 条目是重复;若只有 .md 一个,保留(兜底)
      const baseCount = new Map<string, number>();
      for (const f of map.values()) {
        const base = f.path.replace(/\.md$/, '');
        baseCount.set(base, (baseCount.get(base) || 0) + 1);
      }
      for (const [path] of map) {
        if (path.endsWith('.md') && (baseCount.get(path.replace(/\.md$/, '')) || 0) > 1) {
          map.delete(path);
        }
      }
      this.files = [...map.values()].sort((a, b) => b.lastIndexed - a.lastIndexed);
      // v1.38.0: 诊断 — 打印全部本地文件 path + chunks,排查重复/遗漏
      console.log('[local-files-panel] 本地文件清单:');
      for (const f of this.files) {
        console.log(`[local-files-panel]   • ${f.path} | ${f.chunkCount} chunks | ${f.totalChars} 字 | 索引 ${new Date(f.lastIndexed).toLocaleString('zh-CN')}`);
      }
    } catch (e) {
      console.error('[local-files-panel] load:', e);
      this.files = [];
    }
    this.loading = false;
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  /** V52.7: 弹 native confirm 让用户确认删除(防止误删) */
  private async confirmDelete(e: Event, f: LocalFileSummary) {
    e.stopPropagation();
    const ok = window.confirm(
      `确认删除"${f.path.replace(/^[📕📘] /, '')}"的索引?\n\n` +
      `将从知识库删除:\n` +
      `  • ${f.chunkCount} 个 chunks\n` +
      `  • ${f.totalChars.toLocaleString()} 字内容\n` +
      `  • 对应 vault md (📕/📘 xxx.md)\n\n` +
      `原始 PDF/EPUB 文件不会被删除。`,
    );
    if (!ok) return;
    await this.doDelete(f);
  }

  /** V52.7: 执行删除 — Dexie 清 4 张表,reload 列表 */
  private async doDelete(f: LocalFileSummary) {
    try {
      const { deleteChunksForNote, deleteChunkVectorsForNote, deleteNote, deleteManifestEntry } = await import('../services/db');
      // chunks / vectors 的 path 是 "📕 xxx.pdf"(无 .md),notes / manifest 是 "📕 xxx.pdf.md"
      await deleteChunksForNote(f.path);
      await deleteChunkVectorsForNote(f.path);
      await deleteNote(`${f.path}.md`);
      await deleteManifestEntry(`${f.path}.md`);
      console.log('[local-files-panel] 删除索引:', f.path);
      // 触发 sync 删 OSS md: 把空 manifest entries 推回去 (这里暂时只清本地,
      // OSS 上的 md 等下次 gen_oss_manifest 扫描时不在本地就不会列进去)
      await this.load();
    } catch (err) {
      console.error('[local-files-panel] 删除失败:', err);
      window.alert('删除失败: ' + (err as Error).message);
    }
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

  // v1.25.0: 重索引全部本地文件 — 解决"KB 索引不完整"问题
  // 从 history 表(type='local')里拿所有,删旧 chunks + 重跑索引
  private async reindexAll() {
    if (this.reindexing) return;
    if (this.files.length === 0) {
      alert('没有可重索引的本地文件');
      return;
    }
    if (!confirm(`确定重索引 ${this.files.length} 个本地文件?\n这会删除旧 chunks/vectors 并重新切分(使用已提取的全文,无需重新解析 PDF/EPUB)。`)) return;
    this.reindexing = true;
    this.reindexProgress = '0 / ' + this.files.length;
    try {
      const db = await import('../services/db');
      const { chunkDocument, chunkHash } = await import('../services/chunker');
      const { embedText } = await import('../services/embedder');

      // 从 notes 表拿所有 📕📘 开头的全文 note(这就是之前 PDF/EPUB 提取的全文)
      const allNotes = await db.loadAllNotes();
      // 遍历 this.files(path 形如 "📕 x.pdf" / "📘 x.epub")
      const targets = this.files;   // { path, type, ... }
      let done = 0;
      for (const f of targets) {
        this.reindexProgress = `${done} / ${targets.length} - 重建 ${f.path}`;
        this.requestUpdate();
        try {
          const notePath = f.path + '.md';   // file-opener 存的 note 路径
          // 1) 找对应全文 note(先按 notePath,找不到则模糊找 basename)
          let note: { path: string; content: string; mtime: number } | undefined =
            allNotes.find(n => n.path === notePath);
          if (!note) {
            const base = (f.path.split('/').pop() || '').toLowerCase();
            note = allNotes.find(n => (n.path.split('/').pop() || '').toLowerCase() === base + '.md');
          }
          if (!note || !note.content || note.content.length < 50) {
            // v1.35.0: 兜底 — note 缺失(可能保存失败)时,从现有 chunks 重建全文
            const existing = await db.loadChunksForNote(f.path);
            if (existing.length > 0) {
              const rebuilt = existing.sort((a, b) => a.idx - b.idx)
                .map(c => c.content || '').join('\n\n');
              if (rebuilt.length >= 50) {
                console.warn(`[reindexAll] note 缺失,从 ${existing.length} 个 chunks 重建全文(${rebuilt.length}字):`, f.path);
                // 重建全文 → 再切(下面统一走切分)
                note = { path: f.path, content: rebuilt, mtime: Date.now() };
              }
            }
          }
          if (!note || !note.content || note.content.length < 50) {
            // 诊断 — 列出所有 📕📘 note 候选,方便定位真实 path
            const cands = allNotes.filter(n => n.path.startsWith('📕') || n.path.startsWith('📘'))
              .map(n => `${n.path}(${n.content?.length || 0}字)`);
            console.warn('[reindexAll] 找不到全文 note 也无 chunks:', f.path, '| 候选:', JSON.stringify(cands.slice(0, 20)));
            done++;
            continue;
          }
          // 2) 删旧 chunks + vectors
          await db.deleteChunksForNote(f.path);
          await db.deleteChunkVectorsForNote(f.path);
          // 3) 用 paragraph-only 重新切分
          const content = note.content;
          const chunks = chunkDocument(f.path, content, { mode: 'paragraph-only', forceChunkSize: 500 });
          if (chunks.length === 0) {
            console.warn('[reindexAll] 切分结果为空:', f.path);
            done++;
            continue;
          }
          // 4) 写 chunks
          const now = Date.now();
          await db.saveChunks(f.path, chunks.map(c => ({
            idx: c.idx,
            heading: c.heading || 'EPUB/PDF',
            content: c.content,
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            hash: chunkHash(c.content),
            mtime: now,
          })));
          // 5) 写向量
          const vecRows = chunks.map(c => ({
            idx: c.idx,
            vec: embedText(c.content),
            dim: 256,
            hash: chunkHash(c.content),
            mtime: now,
          }));
          await db.saveChunkVectors(f.path, vecRows);
          console.log(`[reindexAll] OK ${f.path}: ${chunks.length} chunks (从全文 note 重切, 无需 bytes)`);
        } catch (e) {
          console.error('[reindexAll] failed for', f.path, e);
        }
        done++;
        this.reindexProgress = `${done} / ${targets.length}`;
        this.requestUpdate();
      }
      // 完成后 reload
      await this.load();
      alert(`✅ 重索引完成: ${targets.length} 个文件(从已提取全文重切)`);
    } finally {
      this.reindexing = false;
      this.reindexProgress = '';
      this.requestUpdate();
    }
  }

  // v1.39.0: 清理重复索引 — 同一文件被用多个 path 索引(如 📘 生命3.0 vs 📘 生命3.0.epub.md)
  // 保留 chunks 最多的那份,删掉其余变体及其 note/vectors
  private async dedupe() {
    if (this.reindexing) return;
    const fileById = new Map<string, LocalFileSummary[]>();
    const normKey = (p: string) => {
      // 去掉 📕📘 前缀 + 把 .md/.pdf/.epub 子串全部去掉(任意位置) + 去空格/序号差异
      let s = p.replace(/^[📕📘]\s*/, '').toLowerCase();
      s = s.replace(/\.(md|pdf|epub)/g, '');   // v1.40: 去掉所有扩展名子串,不再只去结尾
      s = s.replace(/\((\d+)\)/g, '').replace(/\s+/g, '');
      return s;
    };
    for (const f of this.files) {
      const key = normKey(f.path);
      if (!fileById.has(key)) fileById.set(key, []);
      fileById.get(key)!.push(f);
    }
    // 找出有重复的文件组
    const dupGroups = [...fileById.entries()].filter(([, arr]) => arr.length > 1);
    // v1.40: 诊断 — 打印所有分组,确认归一化是否生效
    console.log('[dedupe] 归一化分组:');
    for (const [key, arr] of fileById) {
      console.log(`[dedupe]   key="${key}" → ${arr.map(f => `${f.path}(${f.chunkCount})`).join(', ')}`);
    }
    if (dupGroups.length === 0) {
      alert('✅ 没有重复索引');
      return;
    }
    const totalDup = dupGroups.reduce((s, [, arr]) => s + arr.length, 0);
    if (!confirm(`发现 ${dupGroups.length} 个文件被重复索引(共 ${totalDup} 个条目)。\n将保留每本书 chunks 最多的那份,删掉其余重复。\n确定清理吗?`)) return;

    this.reindexing = true;
    this.reindexProgress = '清理重复中...';
    try {
      const db = await import('../services/db');
      let removed = 0;
      for (const [, arr] of dupGroups) {
        // 按 chunkCount 降序,保留第一份,其余删
        arr.sort((a, b) => b.chunkCount - a.chunkCount);
        const keep = arr[0];
        for (const dup of arr.slice(1)) {
          console.log(`[dedupe] 删除重复: ${dup.path}(${dup.chunkCount}chunks) — 保留 ${keep.path}(${keep.chunkCount}chunks)`);
          await db.deleteChunksForNote(dup.path);
          await db.deleteChunkVectorsForNote(dup.path);
          await db.deleteNote(dup.path + '.md');
          await db.deleteManifestEntry(dup.path + '.md');
          removed++;
        }
      }
      await this.load();
      alert(`✅ 清理完成,删除了 ${removed} 个重复条目`);
    } catch (e) {
      console.error('[dedupe] failed:', e);
      alert('清理失败: ' + (e as Error).message);
    } finally {
      this.reindexing = false;
      this.reindexProgress = '';
      this.requestUpdate();
    }
  }

  render() {
    return html`
      <div class="modal-backdrop" @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}>
        <div class="modal-panel" style="max-width:720px;max-height:80vh;overflow:auto;touch-action:pan-y;">
          <div class="modal-header">
            <h2>📚 本地参考库</h2>
            <button class="panel-close" title="关闭" aria-label="关闭" @click=${() => this.close()}>✕</button>
          </div>
          <div class="modal-body">
            <p style="font-size:13px;color:var(--dim);margin-top:0">
              ${this.loading ? '加载中...' :
                this.files.length === 0 ? '还没索引任何本地文件。点工具栏 📂 打开 PDF 或 EPUB 后会自动索引 + 自动存一份 md 进 vault。' :
                `已索引 ${this.files.length} 个本地文件 (PDF / EPUB),检索时勾"📂 包含本地文件"即可召回。`}
            </p>
            ${this.files.length > 0 ? html`
              <div style="margin-bottom:12px;padding:10px;background:rgba(255,220,0,0.08);border:1px solid rgba(255,200,0,0.3);border-radius:6px;font-size:12px">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <div>
                    <b>⚠️ 索引不完整 / 有重复?</b>
                    <div style="color:var(--dim);font-size:11px;margin-top:2px">
                      同一本书若出现多次(如 xx.md / xx.epub.md)会拆散检索。先「清理重复」再「重索引」。
                    </div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button
                      ?disabled=${this.reindexing}
                      style="background:#d05050;color:white;border:none;border-radius:6px;padding:8px 12px;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap"
                      @click=${() => this.dedupe()}
                    >🧹 清理重复</button>
                    <button
                      ?disabled=${this.reindexing}
                      style="background:#ff9800;color:white;border:none;border-radius:6px;padding:8px 14px;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap"
                      @click=${() => this.reindexAll()}
                    >
                      ${this.reindexing ? `⏳ ${this.reindexProgress}` : '🔄 重索引全部'}
                    </button>
                  </div>
                </div>
                </div>
              </div>
            ` : ''}
            ${this.files.map(f => html`
              <div class="local-file-card" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;background:var(--card-bg);touch-action:pan-x;">
                <div style="cursor:pointer;touch-action:pan-x" @click=${() => this.toggle(f.path)}>
                  <!-- V52.3: 顶部行 — 文件名占主导,可横向滑动 -->
                  <div style="display:flex;align-items:center;gap:8px;touch-action:pan-x">
                    <span style="font-size:18px;flex-shrink:0">${this.expanded.has(f.path) ? '▼' : '▶'}</span>
                    <span style="font-weight:600;flex-shrink:0">${this.typeBadge(f.type)}</span>
                    <span class="local-file-name">${f.path.replace(/^[📕📘] /, '').replace(/\.(pdf|epub)$/, '')}</span>
                  </div>
                  <!-- V52.3: 底部行 — chunks/字数,小字暗色 -->
                  <div style="font-size:11px;color:var(--dim);margin-top:4px;margin-left:24px">
                    ${f.chunkCount} chunks · ${f.totalChars.toLocaleString()} 字
                  </div>
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
                    <!-- V52.7: 删除索引按钮 — 清 IndexedDB 的 chunks + vectors + notes + manifest -->
                    <div style="margin-top:10px">
                      <button
                        data-path=${f.path}
                        style="background:rgba(220,80,80,0.12);color:#d05050;border:1px solid rgba(220,80,80,0.3);border-radius:6px;padding:6px 12px;font-size:12px;font-family:inherit;cursor:pointer"
                        @click=${(e: Event) => this.confirmDelete(e, f)}
                      >🗑 删除索引</button>
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