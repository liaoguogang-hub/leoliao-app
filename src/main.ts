import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Capacitor } from '@capacitor/core';
import './styles.css';
import './components/file-tree';
import './components/note-view';
import './components/settings-panel';
import './components/help-panel';
import './components/share-panel';
import './components/file-viewer';
import type { ManifestEntry, NoteFile, SyncStatus } from './types';
import { sync as doSync, getNote } from './services/sync';
import { cacheStats } from './services/db';
import { loadSettings, applySettings, type ThemeSettings } from './services/settings';
import { pickAndOpenFile, type OpenedFile } from './services/file-opener';
import { saveToLocal } from './services/export-service';
import { pickCachedWelcome, fetchRandomWelcomeQuick, syncWelcome } from './services/welcome';

@customElement('ll-app')
export class LlApp extends LitElement {
  protected createRenderRoot() { return this; }

  @state() private status: 'init' | 'syncing' | 'ready' | 'error' = 'init';
  @state() private syncStatus: SyncStatus | null = null;
  @state() private allEntries: ManifestEntry[] = [];
  @state() private searchTerm = '';
  @state() private selectedPath = '';
  @state() private currentNote: NoteFile | null = null;
  @state() private stats = { manifestCount: 0, noteCount: 0, totalSize: 0 };
  @state() private errorMsg = '';
  @state() private noticeMsg = '';  // V36: 成功提示(绿色),区别于 errorMsg
  @state() private sidebarOpen = false;
  // V29: 三个 modal 状态
  @state() private showSettings = false;
  @state() private showShare = false;
  @state() private showHelp = false;
  @state() private localFile: OpenedFile | null = null;
  @state() private openingFile = false;
  @state() private openingNote = false;  // V37: 打开笔记时的加载态,避免用户以为没反应又点一次
  // V29: 主题设置
  @state() private theme: ThemeSettings = loadSettings();
  // V38: 开机欢迎图
  @state() private welcomeImg: string | null = null;
  @state() private showWelcome = false;

  async connectedCallback() {
    super.connectedCallback();
    if (Capacitor.isNativePlatform()) {
      console.log('[知识库] Running in native Android shell');
    }
    // V29: 应用主题 + 绑 ESC 键
    applySettings(this.theme);
    document.addEventListener('keydown', this.handleKeydown);
    this.showWelcomeScreen();   // V38: 与同步并行,不阻塞
    await this.runSync();
  }

  /** V38: 开机欢迎页 — 缓存优先(离线秒显),首次无缓存则快速下一张;后台刷新缓存 */
  private async showWelcomeScreen() {
    try {
      let img = await pickCachedWelcome();
      if (img) {
        syncWelcome().catch(() => {});          // 有缓存:后台刷新,不阻塞
      } else {
        img = await fetchRandomWelcomeQuick();  // 首次:快速下一张
        syncWelcome().catch(() => {});          // 后台补齐其余
      }
      if (!img) return;
      this.welcomeImg = img;
      this.showWelcome = true;
      window.setTimeout(() => { this.showWelcome = false; }, 2600);
    } catch {
      /* 网络问题就不显示欢迎页,静默 */
    }
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.handleKeydown);
    super.disconnectedCallback();
  }

  private async runSync() {
    this.status = 'syncing';
    this.errorMsg = '';
    try {
      const fresh = await doSync();
      this.allEntries = fresh;
      this.syncStatus = (await import('./services/sync')).getStatus();
      this.stats = await cacheStats();
      this.status = 'ready';
    } catch (e) {
      this.status = 'error';
      this.errorMsg = String(e);
    }
  }

  private async openNote(path: string) {
    this.selectedPath = path;
    this.sidebarOpen = false;  // V29: 选完笔记自动收起侧栏
    this.localFile = null;     // V33: 切回 vault 时关掉本地文件
    this.openingNote = true;   // V37: 显示加载态
    try {
      const note = await getNote(path);
      if (note) {
        this.currentNote = note;
      } else {
        this.errorMsg = `未找到笔记: ${path}`;
      }
    } finally {
      this.openingNote = false;
    }
  }

  // V33: 打开本地文件
  private async openLocalFile() {
    if (this.openingFile) return;
    this.openingFile = true;
    this.errorMsg = '';
    try {
      const file = await pickAndOpenFile();
      if (file) {
        this.localFile = file;
        this.currentNote = null;  // 互斥:打开本地文件时清掉当前笔记
        this.selectedPath = '';
      }
    } catch (e: any) {
      this.errorMsg = `打开文件失败: ${e?.message || e}`;
      console.error('[openLocalFile]', e);
    } finally {
      this.openingFile = false;
    }
  }

  private closeLocalFile() {
    this.localFile = null;
  }

  /** V36.1: 保存当前笔记(Web 选位置;Android 写 Documents/knowledge-base/) */
  private async saveNote() {
    const note = this.currentNote;
    if (!note) {
      this.errorMsg = '没有打开的笔记';
      return;
    }
    try {
      const result = await saveToLocal(note);
      if (result === null) {
        // 用户取消 picker,不提示
        return;
      }
      this.noticeMsg = `✅ 已保存: ${result.fileName}\n📁 ${result.location}`;
      this.errorMsg = '';
      this.scheduleNoticeAutoHide();
    } catch (e: any) {
      this.errorMsg = `❌ ${e.message || '保存失败'}`;
    }
  }

  /** V36.2: 3 秒后自动清空 noticeMsg,绿色提示不一直挂着 */
  private noticeTimer: number | null = null;
  private scheduleNoticeAutoHide() {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
    }
    this.noticeTimer = window.setTimeout(() => {
      this.noticeMsg = '';
      this.noticeTimer = null;
    }, 3000);
  }

  /** V36.2: 手动关闭 notice */
  private dismissNotice() {
    this.noticeMsg = '';
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
  }

  private async handleSelectDirect(path: string) {
    this.errorMsg = '';
    try {
      await this.openNote(path);
    } catch (e) {
      this.errorMsg = (e as Error).message;
    }
  }

  private async handleSelect(e: Event) {
    try {
      const path = (e as CustomEvent<string>).detail;
      await this.openNote(path);
    } catch (err) {
      console.error('[main] handleSelect ERROR:', err);
    }
  }

  private async handleWikilink(e: Event) {
    const target = (e as CustomEvent<string>).detail;
    const matches = this.findNoteCandidates(target);
    if (matches.length === 1) {
      await this.openNote(matches[0].path);
      return;
    }
    this.searchTerm = target.trim().toLowerCase();
    this.sidebarOpen = true;
    requestAnimationFrame(() => {
      const inputEl = this.querySelector('.search') as HTMLInputElement | null;
      if (inputEl) inputEl.value = this.searchTerm;
    });
    if (matches.length === 0) {
      this.errorMsg = `🔍 未找到 "${target}"\n\n已为你打开左侧搜索,可以:\n  • 修改关键词再找\n  • 检查文件名是否写错\n  • 试试底部"重新同步"加载最新笔记`;
    } else {
      const top = matches.slice(0, 5).map(m => `  • ${m.path}`).join('\n');
      this.errorMsg = `🔍 "${target}" 匹配到 ${matches.length} 篇,见左侧搜索结果:\n${top}\n${matches.length > 5 ? `\n  …还有 ${matches.length - 5} 篇` : ''}`;
    }
  }

  /** V27: 模糊匹配 */
  private findNoteCandidates(target: string): ManifestEntry[] {
    const t = target.trim().toLowerCase();
    const tNoExt = t.replace(/\.md$/, '');
    const tNoSpace = tNoExt.replace(/\s+/g, '');
    type Scored = { entry: ManifestEntry; score: number };
    const scored: Scored[] = [];
    for (const e of this.allEntries) {
      const last = e.path.split('/').pop() || '';
      const lastNoExt = last.replace(/\.md$/, '');
      const lastLower = lastNoExt.toLowerCase();
      const lastNoSpace = lastNoExt.replace(/\s+/g, '');
      let score = 0;
      if (lastLower === tNoExt) score = 100;
      else if (lastNoSpace === tNoSpace) score = 95;
      else if (e.path.toLowerCase() === t + '.md' || e.path.toLowerCase() === t) score = 90;
      else if (lastLower.includes(tNoExt) || tNoExt.includes(lastLower)) score = 80;
      else if (lastNoSpace.includes(tNoSpace) || tNoSpace.includes(lastNoSpace)) score = 70;
      else continue;
      scored.push({ entry: e, score });
    }
    return scored.sort((a, b) => b.score - a.score).map(s => s.entry);
  }

  private onSearch(e: Event) {
    const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
    this.searchTerm = q;
  }

  private get displayEntries(): ManifestEntry[] {
    if (!this.searchTerm) return this.allEntries;
    return this.allEntries.filter(x => x.path.toLowerCase().includes(this.searchTerm));
  }

  // V29: 点 main 区域关侧栏 (后台点击即关)
  private handleMainClick(e: MouseEvent) {
    // 只在侧栏打开 + 点的是 main 自身(不是 note 内的链接/按钮)时关
    if (!this.sidebarOpen) return;
    const target = e.target as HTMLElement;
    // 如果点在工具栏按钮上,别关
    if (target.closest('.toolbar')) return;
    // V31-fix: wikilink 链接的 click 冒泡上来时不要关 — handleWikilink 刚同步设了 sidebarOpen=true,
    // 如果这里再设回 false 就会让用户看到"链接点了但侧栏没开"
    const link = target.closest('a');
    if (link && (link.getAttribute('href') || '').startsWith('#wiki:')) return;
    this.sidebarOpen = false;
  }

  // V29: ESC 键关 modal/侧栏
  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (this.showSettings || this.showShare || this.showHelp) {
        this.showSettings = false;
        this.showShare = false;
        this.showHelp = false;
      } else if (this.sidebarOpen) {
        this.sidebarOpen = false;
      }
    }
  };

  render() {
    const entries = this.displayEntries;
    return html`
      ${this.showWelcome && this.welcomeImg ? html`
        <div class="welcome-overlay" @click=${() => this.showWelcome = false}>
          <img src=${this.welcomeImg} alt="欢迎" />
        </div>
      ` : null}
      <div class="layout ${this.sidebarOpen ? 'sidebar-open' : ''} ${this.showSettings || this.showShare || this.showHelp ? 'modal-open' : ''}">

        ${this.sidebarOpen ? html`
          <div class="sidebar-overlay" @click=${() => this.sidebarOpen = false}></div>
        ` : null}

        <button
          class="sidebar-toggle ${(this.currentNote || this.localFile) ? 'dim' : ''}"
          @click=${() => this.sidebarOpen = !this.sidebarOpen}
          aria-label="切换文件树"
        >
          ${this.sidebarOpen ? '✕' : '☰'}
        </button>

        <aside class="sidebar" @note-open=${this.handleSelect}>
          <div class="sidebar-header">
            <h2>📚 知识库</h2>
            <input
              type="search"
              class="search"
              placeholder="🔍 搜索路径..."
              .value=${this.searchTerm}
              @input=${this.onSearch}
              @search=${this.onSearch}
              @change=${this.onSearch}
              @keyup=${this.onSearch}
            />
            ${this.syncStatus ? html`
              <div class="sync-info">
                <span class="dot ${this.syncStatus.source}"></span>
                ${this.syncStatus.synced}/${this.syncStatus.total} ·
                ${(this.stats.totalSize / 1024).toFixed(1)} KB
              </div>
            ` : null}
          </div>
          <ll-file-tree
            .entries=${entries}
            .selectedPath=${this.selectedPath}
            .searchTerm=${this.searchTerm}
            .onNoteOpen=${(p: string) => this.handleSelectDirect(p)}
          ></ll-file-tree>
          <div class="sidebar-footer">
            <button @click=${() => this.runSync()}>
              ${this.status === 'syncing' ? '⏳ 同步中' : '🔄 重新同步'}
            </button>
          </div>
        </aside>

        <main class="main" @click=${this.handleMainClick} @wikilink=${this.handleWikilink}>

          <!-- V29: 顶部工具栏 -->
          <div class="toolbar">
            ${this.localFile ? html`
              <span class="toolbar-title">📂 ${this.localFile.name}</span>
              <button class="toolbar-btn" title="关闭本地文件" @click=${() => this.closeLocalFile()}>🔙</button>
            ` : this.currentNote ? html`
              <span class="toolbar-title">${this.currentNote.path.split('/').pop()?.replace(/\.md$/, '')}</span>
            ` : html`<span class="toolbar-title toolbar-title-empty">知识库</span>`}
            <div class="toolbar-actions">
              <!-- V33: 打开本地文件按钮 -->
              <button class="toolbar-btn" title="打开本地文件(md/html/txt/图片/docx)" @click=${() => this.openLocalFile()} ?disabled=${this.openingFile}>
                ${this.openingFile ? '⏳' : '📂'}
              </button>
              <button class="toolbar-btn" title="保存到本地" @click=${() => this.saveNote()}>💾</button>
              <button class="toolbar-btn" title="设置" @click=${() => { this.showSettings = true; this.showShare = false; this.showHelp = false; }}>⚙️</button>
              <button class="toolbar-btn" title="分享" @click=${() => { this.showShare = true; this.showSettings = false; this.showHelp = false; }}>↗️</button>
              <button class="toolbar-btn" title="帮助" @click=${() => { this.showHelp = true; this.showSettings = false; this.showShare = false; }}>❓</button>
            </div>
          </div>

          <div class="main-content">
            ${this.status === 'init' ? html`<div class="loading">初始化...</div>` : ''}
            ${this.status === 'syncing' ? html`<div class="loading">⏳ 同步 vault...</div>` : ''}
            ${this.status === 'error' ? html`
              <div class="error-panel">
                <div class="error-title">❌ 同步失败</div>
                <div class="error-msg">${this.errorMsg}</div>
                <button class="retry-btn" @click=${() => this.runSync()}>🔄 重试</button>
              </div>
            ` : ''}
            ${this.syncStatus && this.syncStatus.errors.length > 0 ? html`
              <div class="warn-panel">
                <div class="warn-title">⚠️ 部分文件同步失败 (${this.syncStatus.errors.length})</div>
                <div class="warn-msg">${this.syncStatus.errors.slice(0, 5).join('\n')}</div>
              </div>
            ` : ''}
            ${this.status === 'ready' ? html`
              ${entries.length === 0 ? html`
                <div class="empty-state">
                  <p>📂 文件树为空</p>
                  <p style="font-size:13px;color:var(--dim)">
                    syncStatus: ${this.syncStatus?.source ?? '?'} ·
                    ${this.syncStatus?.synced ?? 0}/${this.syncStatus?.total ?? 0} 个文件
                  </p>
                </div>
              ` : ''}
              ${this.errorMsg ? html`
                <div class="error-panel">
                  <div class="error-title">❌ 加载失败</div>
                  <div class="error-msg">${this.errorMsg}</div>
                </div>
              ` : ''}
              ${this.noticeMsg ? html`
                <div class="notice-panel">
                  <div class="notice-title">
                    <span>✅ 操作成功</span>
                    <button class="notice-close" @click=${() => this.dismissNotice()} aria-label="关闭">✕</button>
                  </div>
                  <div class="notice-msg">${this.noticeMsg}</div>
                </div>
              ` : ''}
              ${this.openingNote ? html`
                <div class="loading">⏳ 加载笔记...</div>
              ` : this.currentNote ? html`
                <ll-note-view .note=${this.currentNote}></ll-note-view>
              ` : this.localFile ? html`
                <ll-file-viewer .file=${this.localFile}></ll-file-viewer>
              ` : html`
                <div class="empty-state">
                  <p>👈 从左侧选一篇笔记</p>
                  <p style="font-size:13px;color:var(--dim)">或点 <b>☰</b> 打开文件树</p>
                  <p style="font-size:12px;color:var(--dim);margin-top:8px">📂 顶部按钮可打开本地 md/html/txt/图片/docx 文件</p>
                </div>
              `}
            ` : ''}
          </div>
        </main>

        ${this.showSettings ? html`
          <ll-settings-panel
            .settings=${this.theme}
            @close=${() => this.showSettings = false}
            @settings-changed=${(e: CustomEvent) => { this.theme = e.detail; }}
          ></ll-settings-panel>
        ` : null}

        ${this.showShare ? html`
          <ll-share-panel
            .note=${this.currentNote}
            .settings=${this.theme}
            @close=${() => this.showShare = false}
          ></ll-share-panel>
        ` : null}

        ${this.showHelp ? html`
          <ll-help-panel
            @close=${() => this.showHelp = false}
          ></ll-help-panel>
        ` : null}

      </div>
    `;
  }
}
