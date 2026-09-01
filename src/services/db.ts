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
  }
}

/** V40: 对话消息 */
export interface ChatMessageRow {
  id?: number;            // 自增主键（++id）
  sessionId: string;      // 当前只有 'default' 一个会话
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 助手消息的检索引用（JSON 序列化的 SearchResult[]） */
  citations?: string;
  ts: number;
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

const CHAT_SESSION_DEFAULT = 'default';
const CHAT_MAX_PER_SESSION = 200;          // 每个会话最多保留 200 条（超出滚动删旧）

export async function appendChatMessage(
  msg: Omit<ChatMessageRow, 'id' | 'sessionId' | 'ts'>
): Promise<number> {
  const row: ChatMessageRow = {
    sessionId: CHAT_SESSION_DEFAULT,
    ts: Date.now(),
    ...msg,
  };
  const id = await db().chat.add(row) as number;
  // 裁剪
  const all = await db().chat.orderBy('ts').toArray();
  if (all.length > CHAT_MAX_PER_SESSION) {
    const toDelete = all.slice(0, all.length - CHAT_MAX_PER_SESSION).map((r) => r.id!);
    await db().chat.bulkDelete(toDelete);
  }
  return id;
}

export async function getChatHistory(sessionId: string = CHAT_SESSION_DEFAULT): Promise<ChatMessageRow[]> {
  return await db().chat.where('sessionId').equals(sessionId).sortBy('ts');
}

export async function clearChatHistory(sessionId: string = CHAT_SESSION_DEFAULT): Promise<void> {
  await db().chat.where('sessionId').equals(sessionId).delete();
}