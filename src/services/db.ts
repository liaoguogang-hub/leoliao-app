/**
 * IndexedDB 封装 — Dexie
 * 缓存 vault 文件清单 + 文件内容
 */

import Dexie, { type Table } from 'dexie';
import type { ManifestEntry } from '../types';

export interface CachedNote {
  path: string;       // 主键
  content: string;
  mtime: number;
  hash: string;
  cachedAt: number;
}

/** 开机欢迎图缓存(dataUrl = data:image/jpeg;base64,...) */
export interface CachedWelcome {
  name: string;       // 主键,如 welcome-01.jpg
  dataUrl: string;
  hash: string;
}

/** V39: 打开历史(笔记 + 本地文件) */
export interface HistoryEntry {
  id: string;          // 主键:笔记用 path,本地文件用 sha1(name+size+mtime) 生成的伪 id
  type: 'note' | 'local';
  name: string;        // 显示用
  path?: string;       // 笔记的 vault 路径
  ext?: string;        // 本地文件扩展名
  size: number;        // 字节
  openedAt: number;    // 最近打开时间戳
  /** 备份:本地文件本身的快照(最大 512KB 写库,大了只存元信息) */
  bytes?: Uint8Array;
  mimeType?: string;
}

class LeoLiaoDB extends Dexie {
  manifest!: Table<ManifestEntry, string>;
  notes!: Table<CachedNote, string>;
  welcome!: Table<CachedWelcome, string>;
  history!: Table<HistoryEntry, string>;
  chat!: Table<ChatMessageRow, number>;
  /** V42: 多会话 */
  chatSessions!: Table<ChatSessionRow, string>;

  constructor() {
    super('leoliao');
    this.version(1).stores({
      manifest: 'path, mtime, hash',
      notes: 'path, mtime, cachedAt',
    });
    // V38: 开机欢迎图缓存
    this.version(2).stores({
      manifest: 'path, mtime, hash',
      notes: 'path, mtime, cachedAt',
      welcome: 'name, hash',
    });
    // V39: 历史表
    this.version(3).stores({
      manifest: 'path, mtime, hash',
      notes: 'path, mtime, cachedAt',
      welcome: 'name, hash',
      history: 'id, type, openedAt',
    });
    // V40: 对话历史
    this.version(4).stores({
      manifest: 'path, mtime, hash',
      notes: 'path, mtime, cachedAt',
      welcome: 'name, hash',
      history: 'id, type, openedAt',
      chat: '++id, ts, sessionId',
    });
    // V42: 多会话 — chatSessions 表(主键 id = uuid;updatedAt 索引排序)
    this.version(5).stores({
      manifest: 'path, mtime, hash',
      notes: 'path, mtime, cachedAt',
      welcome: 'name, hash',
      history: 'id, type, openedAt',
      chat: '++id, ts, sessionId',
      chatSessions: 'id, updatedAt',
    });
  }
}

/** V40: 对话消息 */
export interface ChatMessageRow {
  id?: number;            // 自增主键（++id）
  sessionId: string;      // V42: 多会话 — 关联 chatSessions.id
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 助手消息的检索引用（JSON 序列化的 SearchResult[]） */
  citations?: string;
  ts: number;
}

/** V42: 多会话元数据 */
export interface ChatSessionRow {
  id: string;             // 主键(uuid)
  title: string;          // 显示用(首问前 12 字 / 用户重命名)
  createdAt: number;      // 创建时间
  updatedAt: number;      // 最后活动时间(发问/续聊都更新)
  /** V42: 消息数冗余(0 = 空会话,1+ = 有内容) */
  messageCount: number;
}

let _db: LeoLiaoDB | null = null;

export function db(): LeoLiaoDB {
  if (!_db) _db = new LeoLiaoDB();
  return _db;
}

/* === Manifest === */

export async function saveManifest(entries: ManifestEntry[]): Promise<void> {
  await db().manifest.bulkPut(entries);
}

export async function loadManifest(): Promise<ManifestEntry[]> {
  return await db().manifest.toArray();
}

export async function getManifestEntry(path: string): Promise<ManifestEntry | undefined> {
  return await db().manifest.get(path);
}

/* === Notes === */

export async function saveNote(path: string, content: string, mtime: number, hash: string): Promise<void> {
  await db().notes.put({
    path,
    content,
    mtime,
    hash,
    cachedAt: Date.now(),
  });
}

export async function loadNote(path: string): Promise<CachedNote | undefined> {
  return await db().notes.get(path);
}

export async function loadAllNotes(): Promise<CachedNote[]> {
  return await db().notes.toArray();
}

export async function deleteNote(path: string): Promise<void> {
  await db().notes.delete(path);
}

export async function clearAllNotes(): Promise<void> {
  await db().notes.clear();
}

/* === Welcome 开机欢迎图 === */

export async function loadAllWelcome(): Promise<CachedWelcome[]> {
  return await db().welcome.toArray();
}

export async function saveWelcome(name: string, dataUrl: string, hash: string): Promise<void> {
  await db().welcome.put({ name, dataUrl, hash });
}

export async function deleteWelcome(name: string): Promise<void> {
  await db().welcome.delete(name);
}

/* === Stats === */

export async function cacheStats(): Promise<{ manifestCount: number; noteCount: number; totalSize: number }> {
  const [m, n] = await Promise.all([
    db().manifest.count(),
    db().notes.toArray(),
  ]);
  return {
    manifestCount: m,
    noteCount: n.length,
    totalSize: n.reduce((s, x) => s + x.content.length, 0),
  };
}

/* === V39: 历史记录 === */

const HISTORY_MAX = 30;          // 最多保留 30 条
const HISTORY_LOCAL_SNAPSHOT_MAX = 512 * 1024; // 本地文件 > 512KB 不存快照,只存元信息

/** 添加一条历史(同 id 走 update,openedAt 推到最新)。
 *  保留最近 HISTORY_MAX 条,旧条目自动剔除。 */
export async function addHistory(entry: HistoryEntry): Promise<void> {
  await db().history.put(entry);
  // 裁剪:按 openedAt 倒序,删多余
  const all = await db().history.orderBy('openedAt').reverse().toArray();
  if (all.length > HISTORY_MAX) {
    const toDelete = all.slice(HISTORY_MAX).map((e) => e.id);
    await db().history.bulkDelete(toDelete);
  }
}

/** 取最近 N 条历史(默认全部) */
export async function getRecentHistory(limit = HISTORY_MAX): Promise<HistoryEntry[]> {
  return await db().history.orderBy('openedAt').reverse().limit(limit).toArray();
}

export async function deleteHistory(id: string): Promise<void> {
  await db().history.delete(id);
}

export async function clearHistory(): Promise<void> {
  await db().history.clear();
}

/** 判断本地文件快照要不要入库(太大不入库,节省空间) */
export function shouldSnapshotLocal(size: number): boolean {
  return size <= HISTORY_LOCAL_SNAPSHOT_MAX;
}

/* === V40: 对话历史 === */

const CHAT_SESSION_DEFAULT = 'default';          // V42: 向后兼容老 sessionId
const CHAT_MAX_PER_SESSION = 200;          // 每个会话最多保留 200 条（超出滚动删旧）

/** 生成简单 session id(uuid v4-like,够用即可) */
export function newSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export async function appendChatMessage(
  msg: Omit<ChatMessageRow, 'id' | 'sessionId' | 'ts'> & { sessionId?: string }
): Promise<number> {
  const sessionId = msg.sessionId || CHAT_SESSION_DEFAULT;
  const row: ChatMessageRow = {
    sessionId,
    ts: Date.now(),
    role: msg.role,
    content: msg.content,
    citations: msg.citations,
  };
  const id = await db().chat.add(row) as number;
  // 裁剪:按 ts 全表滚动(V42:多会话下,每个 session 自己 200 条独立)
  // 取该 session 的所有消息,超出 200 删旧的
  const sessionMsgs = await db().chat
    .where('sessionId').equals(sessionId)
    .sortBy('ts');
  if (sessionMsgs.length > CHAT_MAX_PER_SESSION) {
    const toDelete = sessionMsgs
      .slice(0, sessionMsgs.length - CHAT_MAX_PER_SESSION)
      .map((r) => r.id!);
    await db().chat.bulkDelete(toDelete);
  }
  // V42: touch session 的 updatedAt + messageCount
  await touchSession(sessionId);
  return id;
}

export async function getChatHistory(sessionId: string = CHAT_SESSION_DEFAULT): Promise<ChatMessageRow[]> {
  return await db().chat.where('sessionId').equals(sessionId).sortBy('ts');
}

export async function clearChatHistory(sessionId: string = CHAT_SESSION_DEFAULT): Promise<void> {
  await db().chat.where('sessionId').equals(sessionId).delete();
  await touchSession(sessionId);
}

/* === V42: 多会话 chatSessions CRUD === */

/** 创建新会话(默认 title='新对话') */
export async function createSession(title?: string): Promise<ChatSessionRow> {
  const id = newSessionId();
  const now = Date.now();
  const row: ChatSessionRow = {
    id,
    title: title || '新对话',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  await db().chatSessions.put(row);
  return row;
}

/** 列出会话(按 updatedAt 倒序,最新的在前) */
export async function listSessions(): Promise<ChatSessionRow[]> {
  return await db().chatSessions.orderBy('updatedAt').reverse().toArray();
}

/** 取单个会话 */
export async function getSession(id: string): Promise<ChatSessionRow | undefined> {
  return await db().chatSessions.get(id);
}

/** 重命名会话 */
export async function renameSession(id: string, title: string): Promise<void> {
  const row = await db().chatSessions.get(id);
  if (!row) return;
  await db().chatSessions.put({ ...row, title: title.trim() || row.title });
}

/** 删除会话(级联删消息) */
export async function deleteSession(id: string): Promise<void> {
  await db().chat.where('sessionId').equals(id).delete();
  await db().chatSessions.delete(id);
}

/** 触摸会话 updatedAt + 同步 messageCount(发问后自动调) */
export async function touchSession(id: string): Promise<void> {
  const row = await db().chatSessions.get(id);
  if (!row) return;
  const messageCount = await db().chat.where('sessionId').equals(id).count();
  await db().chatSessions.put({ ...row, updatedAt: Date.now(), messageCount });
}

/** 确保至少有一个 session(老用户升级上来的兜底)*/
export async function ensureDefaultSession(): Promise<string> {
  const sessions = await listSessions();
  if (sessions.length > 0) return sessions[0].id;
  // 老数据迁移:'default' session 有消息但没 chatSessions 行 → 创建一行
  const legacyCount = await db().chat.where('sessionId').equals(CHAT_SESSION_DEFAULT).count();
  const row = await createSession(legacyCount > 0 ? '历史对话' : '新对话');
  return row.id;
}