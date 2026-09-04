/**
 * v1.18.0 Phase G.1 — 知识图谱视图
 *
 * 纯 SVG 渲染笔记 ↔ wikilink 关系图(不引入 vis-network 等大依赖)
 *
 * 数据源:遍历 notes 提取 [[wikilinks]] → 边;manifest → 节点
 * 节点大小 = 反链数(影响力)
 * 边粗细 = 引用次数
 * 颜色按目录分组
 *
 * 交互:点节点 → openNote(path)
 * 性能:力导向布局用简化的圆形排列(节点数 <=200)
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';

interface GraphNode {
  id: string;
  label: string;
  title: string;
  group: string;
  value: number;
  /** SVG 坐标(力导向后算出) */
  x: number;
  y: number;
}

interface GraphEdge {
  from: string;
  to: string;
  value: number;
}

const WIKILINK_RE = /\[\[([^\]\|]+?)(?:\|[^\]]*)?\]\]/g;

function extractWikilinksAsPaths(content: string): string[] {
  const paths: string[] = [];
  let m;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    const target = m[1].trim();
    if (!target || target.startsWith('!')) continue;
    paths.push(target.toLowerCase().endsWith('.md') ? target : `${target}.md`);
  }
  return paths;
}

function resolveWikilinkTarget(target: string, allSet: Set<string>, basenameIndex: Map<string, string>): string | null {
  const t = target.toLowerCase().replace(/\.md$/, '') + '.md';
  if (allSet.has(t)) return t;
  // 精确匹配
  const exact = basenameIndex.get(t);
  if (exact) return exact;
  const base = t.split('/').pop() || t;
  // basename 匹配(找以 /base 结尾的)
  return basenameIndex.get(base) || null;
}

const GROUP_COLORS = [
  '#3a8ee6', '#e6853a', '#7cb342', '#d8336b', '#9b59b6',
  '#e6b83a', '#3acfb6', '#e63a3a', '#6c3ae6', '#3a8ee6',
];

@customElement('ll-graph-view')
export class LlGraphView extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Boolean }) open = false;
  @property({ type: Number }) maxNodes = 200;
  @state() private loading = true;
  @state() private nodes: GraphNode[] = [];
  @state() private edges: GraphEdge[] = [];
  @state() private groupColorMap = new Map<string, string>();
  // v1.30.0: 自动建链状态
  @state() private autoRunning = false;
  @state() private autoProgress = '';
  @state() private autoMessage = '';
  // v1.48.0: 列表筛选/分组
  /** 只显示被引用 ≥ 该值的笔记(枢纽);0 = 全部 */
  @state() private minIn = 0;
  /** 排序/分组方式:'by-rank'(按被引数) | 'by-dir'(按目录分组) */
  @state() private viewMode: 'by-rank' | 'by-dir' = 'by-rank';

  async updated(changed: Map<string, unknown>) {
    // v1.43.0: 只要 open=true 且还没建过图,就构建(不依赖 changed.has('open'),更稳)
    if (this.open && !this.loading && this.nodes.length === 0) {
      this.buildGraph();
    }
    if (changed.has('open') && this.open && this.loading) {
      this.buildGraph();
    }
    // v1.45.0: nodes/edges 变化后重画 Canvas
    if ((changed.has('nodes') || changed.has('edges') || changed.has('open')) && this.open && !this.loading) {
      requestAnimationFrame(() => this.renderCanvas());
    }
  }

  /** v1.45.0: Canvas 2D 绘制图谱(比 SVG 轻量,webview 不卡) */
  private renderCanvas() {
    const canvas = this.querySelector('#graph-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 900, H = 600;
    ctx.clearRect(0, 0, W, H);

    // 绘制边(先画边,再画节点,让节点在上层)
    for (const e of this.edges) {
      const from = this.nodes.find(n => n.id === e.from);
      const to = this.nodes.find(n => n.id === e.to);
      if (!from || !to) continue;
      ctx.strokeStyle = 'rgba(150,150,150,0.5)';
      ctx.lineWidth = 0.5 + e.value * 0.4;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // 绘制节点
    for (const n of this.nodes) {
      const r = 4 + Math.min(n.value * 2, 12);
      const color = this.groupColorMap.get(n.group) || '#3a8ee6';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 标签
      ctx.fillStyle = '#333';
      ctx.font = '10px sans-serif';
      const label = n.label.length > 18 ? n.label.slice(0, 16) + '…' : n.label;
      ctx.fillText(label, n.x + r + 3, n.y + 3);
    }
  }

  private async buildGraph() {
    this.loading = true;
    try {
      const t0 = performance.now();
      const { loadAllNotes } = await import('../services/db');
      const notes = await loadAllNotes();
      console.log(`[graph-view] buildGraph start: ${notes.length} 笔记`);
      const allPaths = notes.map(n => n.path.toLowerCase());
      // v1.42.0: 一次构建查找表,避免嵌套 find(O(N²))导致卡死
      const pathToKey = new Map<string, string>();
      const allSet = new Set<string>(allPaths);
      const basenameIndex = new Map<string, string>();
      for (const n of notes) {
        const lp = n.path.toLowerCase();
        pathToKey.set(lp, n.path);
        const base = lp.split('/').pop() || lp;
        if (!basenameIndex.has(base)) basenameIndex.set(base, n.path);
      }

      const backlinkCount = new Map<string, number>();
      const edgeMap = new Map<string, number>();

      for (const n of notes) {
        const links = extractWikilinksAsPaths(n.content);
        for (const target of links) {
          const resolved = resolveWikilinkTarget(target, allSet, basenameIndex);
          if (resolved && resolved !== n.path.toLowerCase()) {
            const fromKey = n.path;
            const toKey = pathToKey.get(resolved) || resolved;
            const key = `${fromKey}→${toKey}`;
            edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
            backlinkCount.set(toKey, (backlinkCount.get(toKey) || 0) + 1);
          }
        }
      }

      const edges: GraphEdge[] = [];
      for (const [key, count] of edgeMap) {
        const [from, to] = key.split('→');
        edges.push({ from, to, value: Math.min(count, 5) });
      }

      // v1.32.0: 限制 SVG 渲染 — 边数 >800 的话只渲染权重 Top-N(防止 webview 渲染崩溃)
      const MAX_RENDER_EDGES = 800;
      let totalEdgeCount = edges.length;
      let renderEdges = edges;
      if (edges.length > MAX_RENDER_EDGES) {
        renderEdges = [...edges].sort((a, b) => b.value - a.value).slice(0, MAX_RENDER_EDGES);
        console.log(`[graph-view] edges ${edges.length} → 渲染 ${MAX_RENDER_EDGES}(按权重截断)`);
      }

      const nodeSet = new Set<string>();
      for (const e of edges) { nodeSet.add(e.from); nodeSet.add(e.to); }
      if (nodeSet.size < this.maxNodes) {
        const remaining = notes
          .map(n => n.path)
          .filter(p => !nodeSet.has(p))
          .sort((a, b) => (backlinkCount.get(b) || 0) - (backlinkCount.get(a) || 0))
          .slice(0, this.maxNodes - nodeSet.size);
        for (const p of remaining) nodeSet.add(p);
      }

      // 先截断节点(只布局渲染的节点,避免过多节点挤在一起) — v1.46.0
      const MAX_RENDER_NODES = 220;
      let renderNodePaths: string[] = [...nodeSet];
      if (renderNodePaths.length > MAX_RENDER_NODES) {
        renderNodePaths = [...renderNodePaths]
          .sort((a, b) => (backlinkCount.get(b) || 0) - (backlinkCount.get(a) || 0))
          .slice(0, MAX_RENDER_NODES);
        const nodeIds = new Set(renderNodePaths);
        const keptEdges = renderEdges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
        renderEdges = keptEdges;
        console.log(`[graph-view] nodes ${nodeSet.size} → 渲染 ${MAX_RENDER_NODES}, 边 ${edges.length} → ${keptEdges.length}`);
      }

      // group → color(v1.46: 按渲染节点重新分组)
      const groupMap = new Map<string, string>();
      let gIdx = 0;
      for (const path of renderNodePaths) {
        const topDir = path.split('/')[0] || 'root';
        if (!groupMap.has(topDir)) {
          groupMap.set(topDir, GROUP_COLORS[gIdx % GROUP_COLORS.length]);
          gIdx++;
        }
      }
      this.groupColorMap = groupMap;

      // v1.46.0: 力导向布局(简化 Fruchterman-Reingold)— 边相连节点拉近,不相连推远
      const W = 900, H = 600;
      const nodeById = new Map<string, GraphNode>();
      for (const path of renderNodePaths) {
        const topDir = path.split('/')[0] || 'root';
        nodeById.set(path, {
          id: path,
          label: path.split('/').pop()?.replace(/\.md$/, '') || path,
          title: path,
          group: topDir,
          value: backlinkCount.get(path) || 1,
          x: W / 2 + (Math.random() - 0.5) * W * 0.6,
          y: H / 2 + (Math.random() - 0.5) * H * 0.6,
        });
      }
      const nodeList = [...nodeById.values()];
      const edgeNodePairs = renderEdges.map(e => [e.from, e.to].filter(id => nodeById.has(id)));
      const ITER = 80;
      const REPULSION = 12000;
      const SPRING_K = 0.02;
      const ATTRACTION_REST = 90;
      const N = nodeList.length;
      for (let iter = 0; iter < ITER; iter++) {
        const disp = new Map<string, { dx: number; dy: number }>();
        for (const id of nodeById.keys()) disp.set(id, { dx: 0, dy: 0 });
        // 斥力(O(N²),N=220 可接受)
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const a = nodeList[i], b = nodeList[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let dist = Math.hypot(dx, dy) || 1;
            const force = REPULSION / (dist * dist);
            const fx = (dx / dist) * force, fy = (dy / dist) * force;
            const da = disp.get(a.id)!, db = disp.get(b.id)!;
            da.dx += fx; da.dy += fy; db.dx -= fx; db.dy -= fy;
          }
        }
        // 弹簧(边连接的节点相互吸引)
        for (const [u, v] of edgeNodePairs) {
          const a = nodeById.get(u)!, b = nodeById.get(v)!;
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist = Math.hypot(dx, dy) || 1;
          const force = SPRING_K * (dist - ATTRACTION_REST);
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          const da = disp.get(u)!, db = disp.get(v)!;
          da.dx -= fx; da.dy -= fy; db.dx += fx; db.dy += fy;
        }
        // 应用位移(带冷却)
        const temp = Math.max(1, 60 * (1 - iter / ITER));
        for (const n of nodeList) {
          const d = disp.get(n.id)!;
          let len = Math.hypot(d.dx, d.dy) || 1;
          const cap = Math.min(len, temp) / len;
          n.x += d.dx * cap;
          n.y += d.dy * cap;
          // 边界钳制
          n.x = Math.max(20, Math.min(W - 20, n.x));
          n.y = Math.max(20, Math.min(H - 20, n.y));
        }
      }

      const finalNodes = nodeList;

      this.nodes = finalNodes;
      this.edges = renderEdges;  // 渲染截断后的边
      console.log(`[graph-view] build done in ${Math.round(performance.now() - t0)}ms: ${finalNodes.length} 节点, ${renderEdges.length}/${totalEdgeCount} 边, ${this.groupColorMap.size} 组`);
    } catch (e) {
      console.warn('[graph-view] build failed:', e);
      this.nodes = [];
      this.edges = [];
    } finally {
      this.loading = false;
    }
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  // v1.30.0: 自动注入 wikilink
  private async runAutoWikilinks(dryRun: boolean) {
    if (this.autoRunning) return;
    this.autoRunning = true;
    this.autoMessage = '';
    this.autoProgress = '扫描中...';
    try {
      const { autoInjectWikilinks } = await import('../services/auto-wikilinks');
      const result = await autoInjectWikilinks({ dryRun });
      if (dryRun) {
        if (result.candidates.length === 0) {
          this.autoMessage = `🔍 没找到可注入的链接(vault 里 ${result.skipped} 处已有 [[xxx]])`;
        } else {
          const byPath = new Map<string, number>();
          for (const c of result.candidates) {
            byPath.set(c.sourcePath, (byPath.get(c.sourcePath) || 0) + 1);
          }
          this.autoMessage = `🔍 预览:将注入 ${result.candidates.length} 条链接到 ${byPath.size} 篇笔记(${result.skipped} 处已有)`;
        }
      } else {
        if (result.added === 0) {
          this.autoMessage = `⚠️ 没注入任何链接(vault 里没匹配到)`;
        } else {
          this.autoMessage = `✨ 成功注入 ${result.added} 条 wikilink!重建图谱中...`;
          // 重新建图谱
          this.nodes = [];
          this.edges = [];
          this.loading = true;
          this.requestUpdate();
          await this.buildGraph();
        }
      }
    } catch (e) {
      console.error('[graph-view] auto-wikilinks failed:', e);
      this.autoMessage = `❌ 出错:${(e as Error).message || e}`;
    } finally {
      // v1.32.0: 强制确保 loading=false — 防止 buildGraph 出错时卡住
      this.loading = false;
      this.requestUpdate();
    }
  }

  // v1.32.0: 回滚注入的 wikilink
  private async revertAutoWikilinks() {
    if (this.autoRunning || this.loading) return;
    if (!confirm('回滚会删除所有自动注入的 [[xxx]] 链接(不会影响手动写的)。确定吗?')) return;
    this.autoRunning = true;
    this.autoMessage = '回滚中...';
    try {
      const { revertAutoInjectedWikilinks } = await import('../services/auto-wikilinks');
      const result = await revertAutoInjectedWikilinks();
      this.autoMessage = `↩️ 已回滚 ${result.removed} 条 wikilink(影响 ${result.affectedNotes} 篇),重建图谱中...`;
      this.loading = true;
      this.nodes = [];
      this.edges = [];
      this.requestUpdate();
      await this.buildGraph();
    } catch (e) {
      console.error('[graph-view] revert failed:', e);
      this.autoMessage = `❌ 回滚失败:${(e as Error).message || e}`;
    } finally {
      this.autoRunning = false;
      this.loading = false;
      this.requestUpdate();
    }
  }

  /** v1.45.0: canvas 点击命中检测 */
  render() {
    if (!this.open) return nothing;
    const body = this.renderBody();
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="modal-box graph-modal" style="max-width:95vw; max-height:90vh; width: 1000px; height: 700px;">
          <h2>🕸 知识图谱</h2>
          <p class="modal-sub">节点大小 = 反链数 · 边 = wikilink 引用 · 点击节点打开笔记 · 颜色按目录分组</p>
          ${body}
        </div>
      </div>
    `;
  }

  /** v1.33.0: 渲染主体(按 loading/nodes 状态分发)— 拆方法避免深层模板嵌套 */
  private renderBody(): unknown {
    if (this.loading) {
      return html`
        <div class="graph-loading">
          <div class="spinner"></div>
          <div>构建图谱中...</div>
        </div>
      `;
    }
    const toolbar = html`
      <div class="graph-toolbar">
        <button class="graph-btn" @click=${() => this.runAutoWikilinks(true)} ?disabled=${this.autoRunning}>
          ${this.autoRunning ? `⏳ ${this.autoProgress}` : '🔍 预览链接'}
        </button>
        <button class="graph-btn primary" @click=${() => this.runAutoWikilinks(false)} ?disabled=${this.autoRunning}>
          ✨ 自动建立链接
        </button>
        <button class="graph-btn" @click=${() => this.buildGraph()} ?disabled=${this.loading}>
          🔄 重建图谱
        </button>
        <button class="graph-btn danger" @click=${() => this.revertAutoWikilinks()} ?disabled=${this.autoRunning || this.loading}>
          ↩️ 回滚注入
        </button>
        ${this.autoMessage ? html`<span class="auto-msg">${this.autoMessage}</span>` : ''}
      </div>
    `;

    // 空态
    if (this.nodes.length === 0) {
      if (this.autoRunning) {
        return html`${toolbar}
          <div class="graph-empty">
            <div class="spinner"></div>
            <div>扫描中...</div>
          </div>
        `;
      }
      return html`${toolbar}
        <div class="graph-empty">
          <p>📭 没有 wikilink 关系</p>
          <p class="dim">点击"✨ 自动建立链接"扫描笔记标题,在正文里自动插入 [[xxx]] 标记。</p>
        </div>
      `;
    }

    // v1.47.0: 关系列表视图(不画图) — 按反链数排序,每篇卡片显示入链/出链
    // 构建 path → {label, inLinks, outLinks} 
    const pathToLabel = new Map<string, string>();
    for (const n of this.nodes) pathToLabel.set(n.id, n.label);
    const inMap = new Map<string, string[]>();    // path -> 引用它的笔记
    const outMap = new Map<string, string[]>();   // path -> 它引用的笔记
    for (const e of this.edges) {
      if (!outMap.has(e.from)) outMap.set(e.from, []);
      outMap.get(e.from)!.push(e.to);
      if (!inMap.has(e.to)) inMap.set(e.to, []);
      inMap.get(e.to)!.push(e.from);
    }
    const linkToLabel = (p: string) => pathToLabel.get(p) || p.split('/').pop() || p;

    // 排序:被引用最多(枢纽)优先
    const sortedNodes = [...this.nodes].sort((a, b) => (b.value || 0) - (a.value || 0));

    // 筛选:minIn 只显示被引≥N 的(枢纽)
    let filtered = sortedNodes;
    if (this.minIn > 0) filtered = sortedNodes.filter(n => (inMap.get(n.id) || []).length >= this.minIn);

    const card = (n: { id: string; label: string; value: number }) => {
      const inLinks = inMap.get(n.id) || [];
      const outLinks = outMap.get(n.id) || [];
      const isHub = inLinks.length >= 3;
      return html`
        <details class="rel-card ${isHub ? 'hub' : ''}" ?open=${false}>
          <summary class="rel-card-head">
            <span class="rel-title">${n.label}</span>
            <span class="rel-counts">
              <span class="rel-in">⬅ ${inLinks.length}</span>
              <span class="rel-out">➡ ${outLinks.length}</span>
            </span>
          </summary>
          <div class="rel-body">
            <div class="rel-dir">
              <div class="rel-dir-label">🔗 引用了 (${outLinks.length})</div>
              <div class="rel-links">
                ${outLinks.length === 0 ? '<span class="rel-none">无</span>' :
                  outLinks.slice(0, 12).map(l => html`<a class="rel-link" @click=${(e: Event) => { e.stopPropagation(); this.openRel(l); }}>${linkToLabel(l)}</a>`)}
                ${outLinks.length > 12 ? html`<span class="rel-more">+${outLinks.length - 12} 更多</span>` : ''}
              </div>
            </div>
            <div class="rel-dir">
              <div class="rel-dir-label">⬅ 被引用 (${inLinks.length})</div>
              <div class="rel-links">
                ${inLinks.length === 0 ? '<span class="rel-none">无</span>' :
                  inLinks.slice(0, 12).map(l => html`<a class="rel-link" @click=${(e: Event) => { e.stopPropagation(); this.openRel(l); }}>${linkToLabel(l)}</a>`)}
                ${inLinks.length > 12 ? html`<span class="rel-more">+${inLinks.length - 12} 更多</span>` : ''}
              </div>
            </div>
          </div>
        </details>
      `;
    };

    // 分组渲染主体
    let listBody: unknown;
    if (this.viewMode === 'by-dir') {
      // 按目录分组:目录(路径第一段) → 笔记
      const byDir = new Map<string, typeof filtered>();
      for (const n of filtered) {
        const dir = n.id.includes('/') ? n.id.split('/')[0] : '(root)';
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir)!.push(n);
      }
      const dirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b, 'zh'));
      listBody = dirs.map(dir => {
        const items = (byDir.get(dir) || []).sort((a, b) => (b.value || 0) - (a.value || 0));
        return html`
          <details class="dir-group" ?open=${false}>
            <summary class="dir-group-head">📁 ${dir} <span class="rel-none">(${items.length})</span></summary>
            <div class="dir-group-body">${items.map(card)}</div>
          </details>
        `;
      });
    } else {
      listBody = filtered.map(card);
    }

    return html`${toolbar}
      <div class="graph-list">
        <div class="graph-list-head">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
            <span>📋 关系列表 · ${filtered.length}/${sortedNodes.length} 篇</span>
            <div style="display:flex;gap:6px;align-items:center">
              <select class="graph-sel" @change=${(e: Event) => { this.viewMode = (e.target as HTMLSelectElement).value as any; }}>
                <option value="by-rank" ?selected=${this.viewMode === 'by-rank'}>🔽 按被引数</option>
                <option value="by-dir" ?selected=${this.viewMode === 'by-dir'}>📁 按目录</option>
              </select>
              <select class="graph-sel" @change=${(e: Event) => { this.minIn = parseInt((e.target as HTMLSelectElement).value, 10); }}>
                <option value="0" ?selected=${this.minIn === 0}>全部</option>
                <option value="1" ?selected=${this.minIn === 1}>被引≥1</option>
                <option value="3" ?selected=${this.minIn === 3}>被引≥3(枢纽)</option>
                <option value="5" ?selected=${this.minIn === 5}>被引≥5(核心)</option>
              </select>
            </div>
          </div>
        </div>
        ${listBody}
      </div>
    `;
  }

  /** v1.47.0: 打开某篇关系链接对应的笔记 */
  private openRel(path: string) {
    this.dispatchEvent(new CustomEvent('open-note', { detail: path, bubbles: true, composed: true }));
  }
}

