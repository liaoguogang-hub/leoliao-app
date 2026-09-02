/**
 * 文件树组件 — 按 vault 目录结构分组展示
 *
 * V10: 不再用 <details>(Android WebView 上 touch 行为不稳定),改 div + 手动 toggle
 * V43: 节点长按/右键 → 操作菜单(重命名/删除/移动/新建子笔记)
 */

import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ManifestEntry } from '../types';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  entry?: ManifestEntry;
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;          // 文件或目录的 path
  isDir: boolean;
  name: string;          // 显示用
}

@customElement('ll-file-tree')
export class LlFileTree extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Array }) entries: ManifestEntry[] = [];
  @property({ type: String }) selectedPath = '';
  @property({ type: String }) searchTerm = '';  // V36: 搜索词,用于自动展开命中路径
  @property({ type: Function }) onNoteOpen?: (path: string) => void;  // V13: 回调取代 CustomEvent
  @state() private expanded = new Set<string>();
  /** V43: 右键/长按菜单状态,null 表示关闭 */
  @state() private ctxMenu: ContextMenuState | null = null;

  // V36: 搜索词变化时,把命中路径的所有父目录加进 expanded
  willUpdate(changed: Map<string, unknown>) {
    if (!changed.has('searchTerm') && !changed.has('entries')) return;
    if (!this.searchTerm) return;
    const term = this.searchTerm.toLowerCase();
    const hits = this.entries.filter(e => e.path.toLowerCase().includes(term));
    if (!hits.length) return;
    const next = new Set(this.expanded);
    for (const e of hits) {
      // 把 e.path 的每个父目录都加进 expanded
      const parts = e.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        next.add(parts.slice(0, i).join('/'));
      }
      // 文件自身也加(虽然不是目录,但 renderNode 会忽略)
      next.add(e.path);
    }
    if (next.size !== this.expanded.size) this.expanded = next;
  }

  private buildTree(): TreeNode {
    const root: TreeNode = { name: 'vault', path: '', isDir: true, children: [] };
    for (const entry of this.entries) {
      const parts = entry.path.split('/');
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const path = parts.slice(0, i + 1).join('/');
        let child = cur.children?.find(c => c.name === part && c.isDir === !isLast);
        if (!child) {
          child = {
            name: part,
            path,
            isDir: !isLast,
            children: isLast ? undefined : [],
            entry: isLast ? entry : undefined,
          };
          cur.children!.push(child);
        }
        cur = child;
      }
    }
    const sortRec = (n: TreeNode) => {
      if (!n.children) return;
      n.children.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh');
      });
      n.children.forEach(sortRec);
    };
    sortRec(root);
    return root;
  }

  connectedCallback() {
    super.connectedCallback();
    // 默认展开所有目录
    if (this.expanded.size === 0 && this.entries.length > 0) {
      const root = this.buildTree();
      const expand = (n: TreeNode) => {
        if (n.isDir) {
          this.expanded.add(n.path);
          n.children?.forEach(expand);
        }
      };
      expand(root);
    }
    // V43: 点空白处关菜单
    this.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.ctx-menu') && !target.closest('.ctx-trigger')) {
        this.ctxMenu = null;
      }
    });
  }

  private toggleDir(path: string) {
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
    } else {
      this.expanded.add(path);
    }
    // 触发响应式更新
    this.expanded = new Set(this.expanded);
  }

  private onSelect(e: MouseEvent, entry: ManifestEntry) {
    e.preventDefault();
    e.stopPropagation();
    if (this.onNoteOpen) {
      this.onNoteOpen(entry.path);          // V13: 直调回调,不走 CustomEvent
    } else {
      this.dispatchEvent(new CustomEvent('note-open', {
        detail: entry.path,
        bubbles: true,
        composed: true,
      }));
    }
  }

  /** V43: 长按 / 右键触发节点操作菜单 */
  private onContextMenu(e: MouseEvent, node: TreeNode) {
    e.preventDefault();
    e.stopPropagation();
    this.ctxMenu = {
      x: Math.min(e.clientX, window.innerWidth - 160),
      y: Math.min(e.clientY, window.innerHeight - 180),
      path: node.path,
      isDir: node.isDir,
      name: node.name,
    };
  }

  /** V43: 长按 600ms 触发菜单(Web 端右键 / 移动端长按) */
  private onTouchStart(e: TouchEvent, node: TreeNode) {
    const touch = e.touches[0];
    if (!touch) return;
    const startX = touch.clientX;
    const startY = touch.clientY;
    const timer = setTimeout(() => {
      this.ctxMenu = {
        x: Math.min(startX, window.innerWidth - 160),
        y: Math.min(startY, window.innerHeight - 180),
        path: node.path,
        isDir: node.isDir,
        name: node.name,
      };
    }, 600);
    const cancel = () => {
      clearTimeout(timer);
      document.removeEventListener('touchend', cancel);
      document.removeEventListener('touchmove', move);
    };
    const move = (ev: TouchEvent) => {
      // 移动超过 10px 取消长按
      const t = ev.touches[0];
      if (t && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) {
        cancel();
      }
    };
    document.addEventListener('touchend', cancel, { once: true });
    document.addEventListener('touchmove', move);
  }

  /** V43: 派发菜单操作事件 */
  private emitAction(action: 'rename' | 'delete' | 'move' | 'new-child') {
    if (!this.ctxMenu) return;
    this.dispatchEvent(new CustomEvent('node-action', {
      detail: { action, ...this.ctxMenu },
      bubbles: true,
      composed: true,
    }));
    this.ctxMenu = null;
  }

  private renderNode(node: TreeNode, depth = 0): unknown {
    if (node.isDir) {
      const isOpen = this.expanded.has(node.path);
      return html`
        <div class="dir" style="--d:${depth}">
          <div
            class="dir-header ctx-trigger"
            style="--d:${depth}"
            @click=${() => this.toggleDir(node.path)}
            @contextmenu=${(e: MouseEvent) => this.onContextMenu(e, node)}
            @touchstart=${(e: TouchEvent) => this.onTouchStart(e, node)}
          >
            <span class="dir-icon">${isOpen ? '▼' : '▶'}</span>
            <span class="dir-name">${node.name}</span>
            <span class="dir-count">(${node.children?.length ?? 0})</span>
          </div>
          ${isOpen ? html`
            <div class="dir-children">
              ${node.children?.map(c => this.renderNode(c, depth + 1))}
            </div>
          ` : null}
        </div>
      `;
    }
    if (!node.entry) return null;
    const isActive = node.entry.path === this.selectedPath;
    const isMatch = this.searchTerm && node.entry.path.toLowerCase().includes(this.searchTerm);
    const sizeKB = (node.entry.size / 1024).toFixed(1);
    return html`
      <div
        class="file ${isActive ? 'active' : ''} ${isMatch ? 'match' : ''} ctx-trigger"
        style="--d:${depth}"
        @click=${(e: MouseEvent) => this.onSelect(e, node.entry!)}
        @contextmenu=${(e: MouseEvent) => this.onContextMenu(e, node)}
        @touchstart=${(e: TouchEvent) => this.onTouchStart(e, node)}
      >
        <span class="file-icon">📄</span>
        <span class="file-name">${node.name}</span>
        <span class="file-size">${sizeKB}K</span>
      </div>
    `;
  }

  /** V43: 节点操作菜单(右键/长按触发) */
  private renderCtxMenu() {
    if (!this.ctxMenu) return null;
    const m = this.ctxMenu;
    return html`
      <div class="ctx-menu" style="left:${m.x}px;top:${m.y}px">
        <div class="ctx-menu-head">${m.isDir ? '📁' : '📄'} ${m.name}</div>
        ${m.isDir ? html`
          <button class="ctx-menu-item" @click=${() => this.emitAction('new-child')}>➕ 新建子笔记</button>
          <button class="ctx-menu-item" @click=${() => this.emitAction('rename')}>✏️ 重命名文件夹</button>
        ` : html`
          <button class="ctx-menu-item" @click=${() => this.emitAction('rename')}>✏️ 重命名</button>
          <button class="ctx-menu-item" @click=${() => this.emitAction('move')}>📁 移动到…</button>
        `}
        <button class="ctx-menu-item danger" @click=${() => this.emitAction('delete')}>🗑 删除</button>
      </div>
    `;
  }

  render() {
    if (this.entries.length === 0) {
      return html`<div class="empty">暂无文件</div>`;
    }
    const tree = this.buildTree();
    return html`
      <nav class="tree">
        ${tree.children?.map(c => this.renderNode(c))}
      </nav>
      ${this.renderCtxMenu()}
    `;
  }
}