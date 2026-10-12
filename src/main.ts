import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Capacitor } from '@capacitor/core';
import './styles.css';
import './components/file-tree';
import './components/note-view';
import './components/settings-panel';
import './components/help-panel';
import './components/local-files-panel';
import './components/share-panel';
import './components/file-viewer';
import './components/history-panel';
import './components/chat-panel';
import './components/wiki-panel';
import './components/graph-view';
import './components/search-results';
import type { ManifestEntry, NoteFile, SyncStatus } from './types';
import type { SearchMode, SearchResult } from './lib/search';
import { sync as doSync, getNote } from './services/sync';
import { cacheStats, addHistory } from './services/db';
import { loadSettings, applySettings, type ThemeSettings } from './services/settings';
import { pickAndOpenFile, type OpenedFile } from './services/file-opener';
import { saveToLocal } from './services/export-service';
import { pickCachedWelcome, fetchRandomWelcomeQuick, syncWelcome } from './services/welcome';
import { loadLastRead, saveLastRead, clearLastRead } from './services/last-read';

@customElement('ll-app')
export class LlApp extends LitElement {
  protected createRenderRoot() { return this; }

  @state() private status: 'init' | 'syncing' | 'ready' | 'error' = 'init';
  @state() private syncStatus: SyncStatus | null = null;
  @state() private allEntries: ManifestEntry[] = [];
  @state() private searchTerm = '';
  @state() private selectedPath = '';
  // v1.13.0: 三 Tab 搜索 state
  /** 当前 Tab:path / fulltext / semantic */
  @state() private sidebarTab: 'path' | 'fulltext' | 'semantic' = 'path';
  /** 全文/语义模式的检索结果(SearchResult[])— 防抖后异步填充 */
  @state() private semanticResults: SearchResult[] = [];
  /** 检索中状态(true 显示 loading) */
  @state() private semanticLoading = false;
  /** Rerank 开关(v1.12.1)— 全文/语义模式共用 */
  @state() private useRerank = false;
  @state() private currentNote: NoteFile | null = null;
  @state() private stats = { manifestCount: 0, noteCount: 0, totalSize: 0 };
  @state() private errorMsg = '';
  @state() private noticeMsg = '';  // V36: 成功提示(绿色),区别于 errorMsg
  @state() private sidebarOpen = false;
  // V29: 三个 modal 状态
  @state() private showSettings = false;
  @state() private showShare = false;
  @state() private showHelp = false;
  // V39: 历史 modal
  @state() private showHistory = false;
  @state() private showLocalFiles = false;  // V51: 本地参考库面板
  @state() private localFile: OpenedFile | null = null;
  @state() private openingFile = false;
  @state() private openingNote = false;  // V37: 打开笔记时的加载态,避免用户以为没反应又点一次
  // V43: KB CRUD
  @state() private showNewNote = false;
  @state() private showRenameNote = false;
  @state() private showMoveNote = false;
  @state() private actionTarget: { path: string; isDir: boolean; name: string } | null = null;
  // V47: Wiki 主页
  @state() private showWiki = false;
  // v1.18.0: 知识图谱
  @state() private showGraph = false;
  // V29: 主题设置
  @state() private theme: ThemeSettings = loadSettings();
  // V38: 开机欢迎图
  @state() private welcomeImg: string | null = null;
  @state() private showWelcome = false;
  // V39: 阅读进度
  @state() private readProgress = 0;        // 0-100
  @state() private readProgressVisible = false;
  // v1.13.0: Tab/Rerank 持久化
  private persistSidebarUI() {
    try {
      localStorage.setItem('ll-sidebar-ui', JSON.stringify({
        sidebarTab: this.sidebarTab,
        useRerank: this.useRerank,
      }));
    } catch { /* 静默 */ }
  }

  // ===== v1.68: 阅读位置记忆 =====
  /** 待落盘的阅读位置(节流合并) */
  private lastReadPending: { path: string; ratio: number; px: number } | null = null;
  /** 节流定时器 */
  private lastReadTimer: number | null = null;
  /** 启动恢复只做一次 */
  private lastReadRestored = false;
  /** 启动恢复期间,用户一旦主动操作就放弃后续重试 */
  private lastReadCancelled = false;
  /** 正在恢复的路径:此路径不做"归零保存",避免覆盖待恢复的位置 */
  private restoringPath: string | null = null;

  /**
   * 节流保存阅读位置。
   * 滚动事件每秒可能触发几十次,直接写 localStorage 会造成卡顿,
   * 因此合并成"停止滚动 400ms 后落盘一次"。
   */
  private queueLastReadSave(path: string, ratio: number, px: number) {
    this.lastReadPending = { path, ratio, px };
    if (this.lastReadTimer !== null) return;
    this.lastReadTimer = window.setTimeout(() => {
      this.lastReadTimer = null;
      this.flushLastRead();
    }, 400);
  }

  /** 立即落盘(App 切后台/关闭时必须调用,否则节流中的数据会丢) */
  private flushLastRead() {
    const p = this.lastReadPending;
    if (!p) return;
    this.lastReadPending = null;
    saveLastRead({ path: p.path, ratio: p.ratio, px: p.px, at: Date.now() });
  }

  /** App 进入后台 / 页面隐藏时落盘(iOS/Android WebView 关进程前最后的机会) */
  private handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.flushLastRead();
  };

  private handlePageHide = () => { this.flushLastRead(); };

  /**
   * 启动时恢复上次阅读位置。
   * 只在清单加载完成后调用;路径已不在清单里(删除/重命名)则清除记录。
   */
  private async restoreLastRead() {
    if (this.lastReadRestored) return;
    const saved = loadLastRead();
    if (!saved) { this.lastReadRestored = true; return; }
    // 校验路径必须真实存在才能恢复。
    // 注意:必须用 allEntries + localNoteEntries 的合集 —— 本地笔记(📕/📘 开头的
    // PDF/EPUB note)不在 OSS manifest 里,只查 allEntries 会把它们误判为已删除。
    const known = new Set<string>([
      ...this.allEntries.map(e => e.path),
      ...this.localNoteEntries.map(e => e.path),
    ]);
    if (known.size === 0) return;   // 首次安装/缓存被清:不恢复,等同步完再试
    if (!known.has(saved.path)) {
      clearLastRead();
      this.lastReadRestored = true;
      return;
    }
    this.lastReadRestored = true;

    this.restoringPath = saved.path;
    await this.openNote(saved.path);
    this.restoringPath = null;

    const apply = (): boolean => {
      if (this.lastReadCancelled) return true;
      const main = this.querySelector('.main') as HTMLElement | null;
      if (!main) return false;
      const max = main.scrollHeight - main.clientHeight;
      if (max <= 0) return false;
      // 优先比例(跨字号/屏宽稳定);比例接近 0 时用像素兜底
      const target = saved.ratio > 0.001 ? saved.ratio * max : saved.px;
      const clamped = Math.min(max, Math.max(0, Math.round(target)));
      main.scrollTop = clamped;
      this.updateReadProgress(main);
      return true;
    };

    // 用户主动操作(触摸/滚轮)则停止后续重试,避免和用户抢滚动条
    const cancel = () => { this.lastReadCancelled = true; };
    const main = this.querySelector('.main') as HTMLElement | null;
    if (main) {
      main.addEventListener('touchstart', cancel, { passive: true, once: true });
      main.addEventListener('wheel', cancel, { passive: true, once: true });
    }

    // 内容/图片撑开会改变 scrollHeight,分几次重试直到稳定
    requestAnimationFrame(() => {
      apply();
      window.setTimeout(apply, 250);
      window.setTimeout(apply, 800);
      window.setTimeout(() => {
        if (main) {
          main.removeEventListener('touchstart', cancel);
          main.removeEventListener('wheel', cancel);
        }
      }, 1200);
    });
  }

  async connectedCallback() {
    super.connectedCallback();
    if (Capacitor.isNativePlatform()) {
      console.log('[知识库] Running in native Android shell');
    }
    // V29: 应用主题 + 绑 ESC 键
    applySettings(this.theme);
    document.addEventListener('keydown', this.handleKeydown);
    // v1.68: 切后台/关页面时立刻落盘阅读位置
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHide);
    // v1.13.0: 恢复侧栏 UI 偏好(Tab/Rerank)
    try {
      const ui = JSON.parse(localStorage.getItem('ll-sidebar-ui') || '{}');
      if (typeof ui.useRerank === 'boolean') this.useRerank = ui.useRerank;
      if (ui.sidebarTab === 'path' || ui.sidebarTab === 'fulltext' || ui.sidebarTab === 'semantic') {
        this.sidebarTab = ui.sidebarTab;
      }
    } catch { /* 默认值 */ }
    this.showWelcomeScreen();   // V38: 与同步并行,不阻塞
    // v1.59: 取消自动同步 — 仅从 IndexedDB 加载缓存,需同步时用户点手动按钮
    try {
      const { loadManifest } = await import('./services/db');
      const cached = await loadManifest();
      if (cached && cached.length > 0) {
        this.allEntries = cached;
        await this.loadLocalNotes();
        this.stats = await cacheStats();
        this.status = 'ready';
        // v1.68: 恢复上次阅读位置(打开同一篇笔记并滚回原处)
        this.restoreLastRead().catch((e) => console.warn('[last-read] 恢复失败:', e));
        console.log(`[知识库] 启动仅读缓存(${cached.length} 条),不自动同步`);
      } else {
        // 没缓存 → 提示用户手动同步(首次开仍是空状态)
        console.log('[知识库] 缓存为空,等待用户手动点同步');
        this.status = 'ready';
      }
    } catch (e) {
      console.warn('[知识库] 缓存加载失败:', e);
      this.status = 'ready';
    }
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
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handlePageHide);
    this.flushLastRead();   // v1.68: 卸载前落盘
    super.disconnectedCallback();
  }

  // V39: 阅读进度条 — 监听 .main 滚动,计算 0-100 进度
  protected firstUpdated() {
    const main = this.querySelector('.main') as HTMLElement | null;
    if (main) {
      main.addEventListener('scroll', () => this.updateReadProgress(main), { passive: true });
    }
  }

  private updateReadProgress(main: HTMLElement) {
    const max = main.scrollHeight - main.clientHeight;
    if (max <= 0) {
      // 内容比视区短:不显示进度条
      if (this.readProgressVisible) {
        this.readProgressVisible = false;
      }
      return;
    }
    const pct = Math.round((main.scrollTop / max) * 100);
    const visible = this.currentNote !== null || this.localFile !== null;
    if (pct !== this.readProgress || visible !== this.readProgressVisible) {
      this.readProgress = pct;
      this.readProgressVisible = visible;
    }
    // v1.68: 记住阅读位置(节流写盘)
    //   恢复流程中也要写:apply() 设好 scrollTop 后由这里的 scroll 事件落盘真实比例;
    //   若用户在恢复期间自己滚走,也应当记录用户的新位置。
    if (this.currentNote) {
      this.queueLastReadSave(this.currentNote.path, main.scrollTop / max, main.scrollTop);
    }
  }

  /** V39: 切换笔记/本地文件时重置进度到顶部,并重算可见性 */
  private resetReadProgress() {
    this.readProgress = 0;
    this.readProgressVisible = this.currentNote !== null || this.localFile !== null;
    requestAnimationFrame(() => {
      const main = this.querySelector('.main') as HTMLElement | null;
      if (main) {
        main.scrollTop = 0;
        this.updateReadProgress(main);
      }
    });
  }

  private async runSync() {
    this.status = 'syncing';
    this.errorMsg = '';
    try {
      const fresh = await doSync();
      this.allEntries = fresh;
      await this.loadLocalNotes();  // V51: 首次启动也加载本地 notes
      this.syncStatus = (await import('./services/sync')).getStatus();
      this.stats = await cacheStats();
      this.status = 'ready';
      // v1.68: 缓存为空时先点同步,同步完成后再恢复上次阅读位置
      this.restoreLastRead().catch((e) => console.warn('[last-read] 恢复失败:', e));
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
        this.resetReadProgress();
        // v1.68: 立刻记住"当前这篇"。openNote 后若用户没滚动,scroll 事件不会触发,
        //        不主动写就会残留上一篇的路径,导致下次打开跳错笔记。
        //        恢复流程中的那篇不写(保留待恢复的位置,等 apply() 写入真实比例)。
        if (this.restoringPath !== path) {
          if (this.lastReadTimer !== null) {
            window.clearTimeout(this.lastReadTimer);
            this.lastReadTimer = null;
          }
          this.lastReadPending = null;
          saveLastRead({ path, ratio: 0, px: 0, at: Date.now() });
        }
        // V39: 记一笔历史(失败也不阻塞)
        addHistory({
          id: path,
          type: 'note',
          name: path.split('/').pop() || path,
          path,
          size: note.content?.length ?? 0,
          openedAt: Date.now(),
        }).catch((e) => console.warn('[history] addNote:', e));
      } else {
        this.errorMsg = `未找到笔记: ${path}`;
      }
    } finally {
      this.openingNote = false;
    }
  }

  /** V43: 监听 file-tree 的节点操作事件 */
  private async onNodeAction(e: CustomEvent<{ action: string; path: string; isDir: boolean; name: string }>) {
    const { action, path, isDir, name } = e.detail;
    this.actionTarget = { path, isDir, name };
    if (action === 'delete') {
      if (!confirm(`删除 ${isDir ? '文件夹' : '笔记'} "${name}"?此操作不可撤销!`)) return;
      await this.handleDelete(path, isDir);
    } else if (action === 'rename') {
      this.showRenameNote = true;
    } else if (action === 'move') {
      this.showMoveNote = true;
    } else if (action === 'new-child') {
      // 新建子笔记:预填 actionTarget.path 作为父目录
      this.actionTarget = { path, isDir: true, name };
      this.showNewNote = true;
    }
  }

  /** V43: 删除笔记/文件夹 */
  private async handleDelete(path: string, isDir: boolean) {
    try {
      const { deleteNote, deleteManifestEntry, loadAllNotes } = await import('./services/db');
      if (isDir) {
        // 文件夹:删所有 path 前缀匹配的笔记 + manifest 条目
        const allNotes = await loadAllNotes();
        const toDelete = allNotes.filter(n => n.path.startsWith(path + '/'));
        for (const n of toDelete) {
          await deleteNote(n.path);
          await deleteManifestEntry(n.path);
        }
        this.noticeMsg = `已删除文件夹 "${path}"(${toDelete.length} 篇)`;
      } else {
        await deleteNote(path);
        await deleteManifestEntry(path);
        this.noticeMsg = `已删除 "${path}"`;
      }
      // 刷新
      this.allEntries = await (await import('./services/db')).loadManifest();
      await this.loadLocalNotes();  // V51: 同步本地 📕 / 📘 notes
      this.stats = await (await import('./services/db')).cacheStats();
      // 如果删的就是当前笔记,清空
      if (this.currentNote && this.currentNote.path === path) {
        this.currentNote = null;
        this.selectedPath = '';
      }
      // v1.68: 删掉的就是记住的那篇 → 清除阅读位置,下次启动不再尝试打开
      const lr = loadLastRead();
      if (lr && (lr.path === path || lr.path.startsWith(path + '/'))) {
        clearLastRead();
      }
      setTimeout(() => { this.noticeMsg = ''; }, 3000);
    } catch (e: any) {
      this.errorMsg = `删除失败: ${e?.message || e}`;
    }
  }

  /** V43: 重命名/移动 — 提交 */
  private async handleRenameSubmit(newPath: string) {
    if (!this.actionTarget) return;
    const oldPath = this.actionTarget.path;
    if (!newPath || newPath === oldPath) {
      this.showRenameNote = false;
      return;
    }
    try {
      const { renameNote } = await import('./services/db');
      await renameNote(oldPath, newPath);
      this.noticeMsg = `已重命名 → "${newPath}"`;
      this.allEntries = await (await import('./services/db')).loadManifest();
      await this.loadLocalNotes();
      // 如果重命名当前笔记,同步更新
      if (this.currentNote && this.currentNote.path === oldPath) {
        this.currentNote = await getNote(newPath);
        this.selectedPath = newPath;
      }
      // v1.68: 记住的路径跟着改名走,否则下次启动会因路径失效而丢失阅读位置
      const lr = loadLastRead();
      if (lr && lr.path === oldPath) {
        saveLastRead({ ...lr, path: newPath, at: Date.now() });
      }
      setTimeout(() => { this.noticeMsg = ''; }, 3000);
    } catch (e: any) {
      this.errorMsg = `重命名失败: ${e?.message || e}`;
    }
    this.showRenameNote = false;
  }

  /** V43: 移动到目录 — 提交 */
  private async handleMoveSubmit(targetDir: string) {
    if (!this.actionTarget) return;
    const oldPath = this.actionTarget.path;
    const filename = oldPath.split('/').pop() || '';
    const newPath = targetDir ? `${targetDir}/${filename}` : filename;
    return this.handleRenameSubmit(newPath);
  }

  /** V43: 创建新笔记 */
  private async handleCreateNote(path: string, template: string) {
    if (!path) return;
    try {
      const { saveNote, saveManifest } = await import('./services/db');
      const content = template;
      const enc = new TextEncoder().encode(content);
      let h = 5381;
      for (let i = 0; i < enc.length; i++) h = ((h << 5) + h + enc[i]) | 0;
      const hash = (h >>> 0).toString(36);
      await saveNote(path, content, Date.now(), hash);
      const manifest = await (await import('./services/db')).loadManifest();
      await saveManifest([...manifest, { path, size: enc.length, mtime: Date.now(), hash }]);
      this.noticeMsg = `已创建 "${path}"`;
      this.allEntries = await (await import('./services/db')).loadManifest();
      await this.loadLocalNotes();
      // 自动打开新建的笔记
      setTimeout(() => {
        this.openNote(path);
        this.noticeMsg = '';
      }, 500);
    } catch (e: any) {
      this.errorMsg = `创建失败: ${e?.message || e}`;
    }
    this.showNewNote = false;
    this.actionTarget = null;
  }

  /** V43: 监听 note-view 保存编辑 */
  private async onNoteSave(e: CustomEvent<{ path: string; content: string; hash: string; size: number; mtime: number }>) {
    const { path, content, hash, size, mtime } = e.detail;
    const nv = this.querySelector('ll-note-view') as any;
    try {
      const { saveNote, saveManifest } = await import('./services/db');
      await saveNote(path, content, mtime, hash);
      const manifest = await (await import('./services/db')).loadManifest();
      await saveManifest([...manifest, { path, size, mtime, hash }]);
      // 刷新当前笔记
      const updated = await getNote(path);
      if (updated) {
        this.currentNote = updated;
      }
      this.noticeMsg = `💾 已保存 "${path}"`;
      setTimeout(() => { this.noticeMsg = ''; }, 2000);
      // 通知 note-view 保存成功
      if (nv) nv.noteSaved(true);
    } catch (e: any) {
      this.errorMsg = `保存失败: ${e?.message || e}`;
      if (nv) nv.noteSaved(false);
    }
  }

  /** V43: 渲染新建/重命名/移动 modal(共用) */
  private renderActionModal() {
    if (!this.showNewNote && !this.showRenameNote && !this.showMoveNote) return null;
    const isNew = this.showNewNote;
    const isMove = this.showMoveNote;
    const isRename = this.showRenameNote;
    const t = this.actionTarget;
    // 默认值
    const initPath = isNew
      ? (t?.isDir ? `${t.path}/新笔记.md` : `新笔记.md`)
      : isMove
        ? ''  // 用户选目录
        : t?.path || '';  // 重命名
    const templates = isNew
      ? [
          { value: '# 新笔记\n\n', label: '空白' },
          { value: '# 标题\n\n## 概览\n\n内容...\n\n## 引用\n\n- [[]]\n', label: '简单模板' },
        ]
      : [];
    // 移动到:列出所有文件夹
    const dirs = isMove
      ? this.allEntries.length
        ? Array.from(new Set(this.allEntries.map(e => e.path.split('/').slice(0, -1).join('/')).filter(Boolean))).sort()
        : []
      : [];

    const title = isNew ? '➕ 新建笔记' : isRename ? '✏️ 重命名' : '📁 移动到';

    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) {
          this.showNewNote = false; this.showRenameNote = false; this.showMoveNote = false;
        }
      }}>
        <div class="modal-box">
          <h2>${title}</h2>
          ${t ? html`<p class="modal-sub">${isNew ? (t.isDir ? `📁 在 "${t.path}/" 下新建` : '📄 新笔记') : (isMove ? `移动 "${t.path}"` : `原: "${t.path}"`)}</p>` : null}
          <label class="modal-label">路径${isMove ? '(选择目录)' : ''}</label>
          ${isMove ? html`
            <select class="modal-input" @change=${(e: Event) => { (this as any)._moveTo = (e.target as HTMLSelectElement).value; }}>
              <option value="">(vault 根目录)</option>
              ${dirs.map(d => html`<option value=${d}>${d}/</option>`)}
            </select>
          ` : html`
            <input class="modal-input" id="v43-path-input" .value=${initPath} placeholder="例:01.公众号/新文章.md" />
          `}
          ${isNew ? html`
            <label class="modal-label">模板</label>
            <select class="modal-input" id="v43-tpl-select">
              ${templates.map(tpl => html`<option value=${tpl.value}>${tpl.label}</option>`)}
            </select>
            <p class="modal-hint">新建的笔记会自动打开。模板内容可后续编辑。</p>
          ` : null}
          <div class="modal-actions">
            <button class="modal-btn" @click=${() => {
              this.showNewNote = false; this.showRenameNote = false; this.showMoveNote = false;
              this.actionTarget = null;
            }}>取消</button>
            <button class="modal-btn primary" @click=${() => {
              if (isNew) {
                const path = (this.querySelector('#v43-path-input') as HTMLInputElement)?.value.trim();
                const tpl = (this.querySelector('#v43-tpl-select') as HTMLSelectElement)?.value || '';
                this.handleCreateNote(path, tpl);
              } else if (isRename) {
                const path = (this.querySelector('#v43-path-input') as HTMLInputElement)?.value.trim();
                this.handleRenameSubmit(path);
              } else if (isMove) {
                const target = (this as any)._moveTo || '';
                this.handleMoveSubmit(target);
              }
            }}>${isNew ? '创建' : isRename ? '重命名' : '移动'}</button>
          </div>
        </div>
      </div>
    `;
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
        this.resetReadProgress();
        // V39: 历史快照(<=512KB 才存 bytes,大的只存元信息)
        const { shouldSnapshotLocal } = await import('./services/db');
        const snapshot = shouldSnapshotLocal(file.size) ? file.bytes : undefined;
        const histId = `local:${file.name}:${file.size}`;
        addHistory({
          id: histId,
          type: 'local',
          name: file.name,
          ext: file.ext,
          size: file.size,
          openedAt: Date.now(),
          bytes: snapshot,
          mimeType: file.mimeType,
        }).catch((e) => console.warn('[history] addLocal:', e));

        // V52: 等 PDF/EPUB 后台索引完成 → 刷新文件树本地 notes 缓存,
        // 让搜索框能立刻搜到刚生成的 📕/📘 xxx.md(不用等 sync/重启)
        // v1.23.0 Fix-F: 索引完成 toast 提示 + 自动 reload 笔记列表
        if ((file as any).indexingDone) {
          this.noticeMsg = `📥 正在索引 ${file.name}...`;
          (file as any).indexingDone
            .then(() => {
              this.loadLocalNotes();
              // 提示用户索引完成,可被检索
              const isEbook = file.ext === 'pdf' || file.ext === 'epub';
              this.noticeMsg = `✅ ${file.name} 已索引完成${isEbook ? ' - 现在可在 chat 中检索' : ''}`;
              this.scheduleNoticeAutoHide();
            })
            .catch((err: any) => {
              console.warn('[openLocalFile] indexingDone:', err);
              this.noticeMsg = `⚠️ ${file.name} 索引失败(可在 logcat 看原因)`;
              this.scheduleNoticeAutoHide();
            });
        }
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
    this.readProgressVisible = false;
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

  private async handleSelectDirect(path: string, idx?: number) {
    this.errorMsg = '';
    try {
      await this.openNote(path);
      // v1.14.0: 如果传了 idx,触发 jump-to-chunk 事件让 note-view 跳转+高亮
      if (idx !== undefined) {
        this.dispatchJumpToChunk(path, idx);
      }
    } catch (e) {
      this.errorMsg = (e as Error).message;
    }
  }

  /** v1.14.0: 派发全局 jump-to-chunk 事件(注:note-view 用 document 监听) */
  private dispatchJumpToChunk(path: string, idx: number) {
    document.dispatchEvent(new CustomEvent('ll-jump-to-chunk', {
      detail: { path, idx },
    }));
  }

  private async handleSelect(e: Event) {
    try {
      const path = (e as CustomEvent<string>).detail;
      await this.openNote(path);
    } catch (err) {
      console.error('[main] handleSelect ERROR:', err);
    }
  }

  // V39: 从历史面板收到事件 — 打开笔记
  private async handleHistoryOpenNote(e: Event) {
    const path = (e as CustomEvent<string>).detail;
    await this.openNote(path);
  }

  // V39: 从历史面板收到事件 — 恢复本地文件快照
  private handleHistoryOpenLocal(e: Event) {
    const file = (e as CustomEvent<OpenedFile>).detail;
    this.localFile = file;
    this.currentNote = null;
    this.selectedPath = '';
    this.resetReadProgress();
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
    // v1.13.0: 全文/语义 Tab 时,触发防抖检索
    if (this.sidebarTab !== 'path') {
      this.scheduleSemanticSearch(q);
    }
  }

  // v1.13.0: 防抖定时器(全文/语义检索)
  private semanticDebounce: number | null = null;

  /** 200ms 防抖后跑全文/语义检索 */
  private scheduleSemanticSearch(q: string) {
    if (this.semanticDebounce !== null) {
      clearTimeout(this.semanticDebounce);
    }
    if (!q) {
      this.semanticResults = [];
      this.semanticLoading = false;
      return;
    }
    this.semanticLoading = true;
    this.semanticDebounce = window.setTimeout(async () => {
      try {
        const { search } = await import('./lib/search');
        const mode: SearchMode = this.sidebarTab === 'fulltext' ? 'bm25' : 'hybrid';
        const rerankOpts = this.useRerank ? { topN: 10, timeoutMs: 3000 } : undefined;
        this.semanticResults = await search(q, 30, 12000, [], mode, false, rerankOpts);
      } catch (e) {
        console.warn('[main] semantic search failed:', e);
        this.semanticResults = [];
      } finally {
        this.semanticLoading = false;
      }
    }, 200);
  }

  /** v1.13.0: 切换 Tab */
  private setSidebarTab(tab: 'path' | 'fulltext' | 'semantic') {
    this.sidebarTab = tab;
    if (tab !== 'path' && this.searchTerm) {
      this.scheduleSemanticSearch(this.searchTerm);
    } else if (tab === 'path') {
      this.semanticResults = [];
    }
  }

  private get displayEntries(): ManifestEntry[] {
    // V51: 合并 Dexie notes 里的 📕 / 📘 本地 PDF/EPUB notes (OSS manifest 不会自动包含本地直接写的)
    const localEntries = this.localNoteEntries;
    const merged = [...this.allEntries, ...localEntries];
    if (!this.searchTerm) return merged;
    return merged.filter(x => x.path.toLowerCase().includes(this.searchTerm));
  }

  /** 从 Dexie notes 表读所有 📕 / 📘 开头的本地 notes, 缓存到 __localNotesMap */
  private async loadLocalNotes(): Promise<void> {
    try {
      const all = await (await import('./services/db')).loadAllNotes();
      const map = new Map<string, { content: string; mtime: number; hash: string }>();
      for (const n of all) {
        if (!n.path.startsWith('📕') && !n.path.startsWith('📘')) continue;
        map.set(n.path, { content: n.content, mtime: n.mtime, hash: n.hash });
      }
      (this as any).__localNotesMap = map;
    } catch (e) {
      console.warn('[main] loadLocalNotes:', e);
    }
  }

  /** 从 Dexie notes 表读所有 📕 / 📘 开头的本地 notes, 转成 ManifestEntry 格式注入文件树搜索结果 */
  private get localNoteEntries(): ManifestEntry[] {
    const notesMap = (this as any).__localNotesMap as Map<string, { content: string; mtime: number; hash: string }> | undefined;
    if (!notesMap) return [];
    const entries: ManifestEntry[] = [];
    for (const [path, note] of notesMap) {
      if (!path.startsWith('📕') && !path.startsWith('📘')) continue;
      entries.push({
        path,
        name: path.split('/').pop() || path,
        mtime: note.mtime,
        hash: note.hash,
        // V51: 标记为本地 (synthetic — UI 可选显示 ⭐ 或类似标记)
        // 这里 type/size 不存在 ManifestEntry 类型里, 用 ext 字段 if present
        size: note.content.length,
      } as ManifestEntry);
    }
    return entries;
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
      if (this.showSettings || this.showShare || this.showHelp || this.showHistory || this.showLocalFiles) {
        this.showSettings = false;
        this.showShare = false;
        this.showHelp = false;
        this.showHistory = false;
        this.showLocalFiles = false;
      } else if (this.sidebarOpen) {
        this.sidebarOpen = false;
      }
      return;
    }
    // v1.13.0: Cmd/Ctrl + K 聚焦搜索框
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.sidebarOpen = true;
      requestAnimationFrame(() => {
        const el = this.querySelector('.search') as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select();
        }
      });
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
      <div class="layout ${this.sidebarOpen ? 'sidebar-open' : ''} ${this.showSettings || this.showShare || this.showHelp || this.showHistory ? 'modal-open' : ''}">

        ${this.sidebarOpen ? html`
          <div class="sidebar-overlay" @click=${() => this.sidebarOpen = false}></div>
        ` : null}

        <!-- V39: 阅读进度条(右侧固定) -->
        <div class="read-progress ${this.readProgressVisible ? 'visible' : ''}">
          <div class="fill" style="height: ${this.readProgress}%;"></div>
        </div>
        <!-- v1.57: % 标签独立 fixed 层,z-index 999 永不被色块盖住,高对比背景 -->
        ${this.readProgressVisible && this.readProgress > 0 ? html`
          <div class="read-pct-fixed" style="--pct: ${this.readProgress};">${this.readProgress}%</div>
        ` : ''}

        <button
          class="sidebar-toggle ${this.sidebarOpen ? 'open' : ''} ${(this.currentNote || this.localFile) ? 'dim' : ''}"
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
              placeholder=${this.sidebarTab === 'path' ? '🔍 搜索路径...'
                : this.sidebarTab === 'fulltext' ? '🔍 全文搜索 chunks...'
                : '🧠 语义搜索(自然语言问句)...'}
              .value=${this.searchTerm}
              @input=${this.onSearch}
              @search=${this.onSearch}
              @change=${this.onSearch}
              @keyup=${this.onSearch}
            />
            <!-- v1.13.0: 三 Tab 切换 -->
            <div class="search-tabs" role="tablist">
              <button class="search-tab ${this.sidebarTab === 'path' ? 'active' : ''}"
                role="tab" @click=${() => this.setSidebarTab('path')}
                title="按文件路径匹配(最快)">📂 路径</button>
              <button class="search-tab ${this.sidebarTab === 'fulltext' ? 'active' : ''}"
                role="tab" @click=${() => this.setSidebarTab('fulltext')}
                title="按 chunk 内容 BM25 匹配">📖 全文</button>
              <button class="search-tab ${this.sidebarTab === 'semantic' ? 'active' : ''}"
                role="tab" @click=${() => this.setSidebarTab('semantic')}
                title="BM25 + 向量 + RRF 混合">🧠 语义</button>
            </div>
            <!-- v1.13.0: Rerank 开关(全文/语义 Tab 时显示) -->
            ${this.sidebarTab !== 'path' ? html`
              <label class="rerank-toggle">
                <input type="checkbox" ?checked=${this.useRerank}
                  @change=${(e: Event) => { this.useRerank = (e.target as HTMLInputElement).checked; this.persistSidebarUI(); if (this.searchTerm) this.scheduleSemanticSearch(this.searchTerm); }} />
                🎯 Rerank
              </label>
            ` : null}
            ${this.syncStatus ? html`
              <div class="sync-info">
                <span class="dot ${this.syncStatus.source}"></span>
                ${this.syncStatus.synced}/${this.syncStatus.total} ·
                ${(this.stats.totalSize / 1024).toFixed(1)} KB
              </div>
            ` : null}
          </div>
          <!-- v1.13.0: 根据 tab 分发三种视图 -->
          ${this.sidebarTab === 'path' ? html`
            <ll-file-tree
              .entries=${entries}
              .selectedPath=${this.selectedPath}
              .searchTerm=${this.searchTerm}
              .onNoteOpen=${(p: string) => this.handleSelectDirect(p)}
              @node-action=${(e: CustomEvent) => this.onNodeAction(e)}
            ></ll-file-tree>
          ` : html`
            <ll-search-results
              .results=${this.semanticResults}
              .loading=${this.semanticLoading}
              .query=${this.searchTerm}
              .selectedPath=${this.selectedPath}
              .onNoteOpen=${(p: string, idx?: number) => this.handleSelectDirect(p, idx)}
            ></ll-search-results>
          `}
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
              <button class="toolbar-btn" title="打开本地文件(md/html/txt/图片/docx/pdf/epub)" @click=${() => this.openLocalFile()} ?disabled=${this.openingFile}>
                ${this.openingFile ? '⏳' : '📂'}
              </button>
              <!-- V43: 新建笔记 — v1.51: SVG 加号(emoji ➕ 是深色字形,深色模式看不清) -->
              <button class="toolbar-btn" title="新建笔记" @click=${() => { this.actionTarget = { path: '', isDir: false, name: '' }; this.showNewNote = true; this.showSettings = false; this.showShare = false; this.showHelp = false; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <!-- V47: Wiki 主页 -->
              <button class="toolbar-btn" title="Wiki 主页" @click=${() => { this.showWiki = true; this.showSettings = false; this.showShare = false; this.showHelp = false; }}>📖</button>
              <!-- v1.18.0: 关系列表 — v1.51: SVG 网状图(emoji 🕸 深色模式看不清) -->
              <button class="toolbar-btn" title="关系列表(原知识图谱)" @click=${() => { this.showGraph = true; this.showSettings = false; this.showShare = false; this.showHelp = false; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <circle cx="12" cy="5" r="2.4"/>
                  <circle cx="4.5" cy="18" r="2.4"/>
                  <circle cx="19.5" cy="18" r="2.4"/>
                  <path d="M10.8 6.6 5.8 16M13.2 6.6 18.2 16M6.2 18h11.6"/>
                </svg>
              </button>
              <!-- V39: 历史记录 -->
              <button class="toolbar-btn" title="历史打开过的笔记/文件" @click=${() => this.showHistory = true}>🕘</button>
              <button class="toolbar-btn" title="本地参考库 (PDF / EPUB)" @click=${() => this.showLocalFiles = true}>📚</button>
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
                <ll-note-view
                  .note=${this.currentNote}
                  @note-save=${(e: CustomEvent) => this.onNoteSave(e)}
                ></ll-note-view>
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

        ${this.showHistory ? html`
          <ll-history-panel
            @close=${() => this.showHistory = false}
            @open-note=${(e: CustomEvent<string>) => this.handleHistoryOpenNote(e)}
            @open-local=${(e: CustomEvent<OpenedFile>) => this.handleHistoryOpenLocal(e)}
          ></ll-history-panel>
        ` : null}

        ${this.showLocalFiles ? html`
          <ll-local-files-panel
            @close=${() => this.showLocalFiles = false}
          ></ll-local-files-panel>
        ` : null}

        ${this.showWiki ? html`
          <ll-wiki-panel
            @close=${() => this.showWiki = false}
            @open-note=${(e: CustomEvent<string>) => { this.showWiki = false; this.handleHistoryOpenNote(e); }}
          ></ll-wiki-panel>
        ` : null}

        ${this.showGraph ? html`
          <ll-graph-view
            .open=${this.showGraph}
            @close=${() => this.showGraph = false}
            @open-note=${(e: CustomEvent<string>) => { this.showGraph = false; this.handleHistoryOpenNote(e); }}
          ></ll-graph-view>
        ` : null}

        ${this.renderActionModal()}

        <!-- AI 对话面板 — FAB + 弹窗；引用点击触发打开对应笔记(v1.14.0: 带 idx 跳转+高亮) -->
        <ll-chat-panel
          .currentNotePath=${this.currentNote?.path || ''}
          @open-citation=${(e: CustomEvent<{ path: string; idx?: number }>) => this.handleSelectDirect(e.detail.path, e.detail.idx)}
        ></ll-chat-panel>

      </div>
    `;
  }
}
