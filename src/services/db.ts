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
  /** V44: 文档 chunks(主键 [path+idx]) */
  chunks!: Table<ChunkRow, [string, number]>;
  /** V46: 长期记忆 — 主题(items 是 sub-items) */
  memoryTopics!: Table<MemoryTopicRow, string>;
  memoryItems!: Table<MemoryItemRow, number>;

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
    // V44: chunks 表(主键复合 [path, idx],path 索引用于按路径删)
    this.version(6).stores({
      manifest: 'path, mtime, hash',
      notes: 'path, mtime, cachedAt',
      welcome: 'name, hash',
      history: 'id, type, openedAt',
      chat: '++id, ts, sessionId',
      chatSessions: 'id, updatedAt',
      chunks: '[path+idx], path',
    });
    // V46: memory — memoryTopics + memoryItems
    this.version(7).stores({
      manifest: 'path, mtime, hash',
      notes: 'path, mtime, cachedAt',
      welcome: 'name, hash',
      history: 'id, type, openedAt',
      chat: '++id, ts, sessionId',
      chatSessions: 'id, updatedAt',
      chunks: '[path+idx], path',
      memoryTopics: 'id, createdAt, lastUsed',
      memoryItems: '++id, topicId, ts',
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

/** V44: chunk(主键 [path, idx]) */
export interface ChunkRow {
  path: string;             // 所属笔记路径
  idx: number;              // chunk 在该笔记内的索引
  heading: string;          // 所属二级标题(无则用笔记文件名)
  content: string;          // chunk 原文
  startOffset: number;      // 在原文档里的字符位置
  endOffset: number;
  hash: string;             // chunkHash(content)
  mtime: number;            // 笔记 mtime(级联用)
}

/** V46: 记忆主题(主键 id = uuid) */
export interface MemoryTopicRow {
  id: string;               // 主键(uuid)
  title: string;            // 主题标题(从对话摘要)
  summary: string;          // 一段简短描述(用户偏好/事实)
  createdAt: number;        // 首次发现时间
  lastUsed: number;         // 最近引用时间(用于排序/淘汰)
  /** 关联的会话 id(谁产生的) */
  sessionId?: string;
  /** 状态:active / archived / deleted */
  status: 'active' | 'archived';
}

/** V46: 记忆条目 — 主题下的具体事实/片段 */
export interface MemoryItemRow {
  id?: number;              // ++id
  topicId: string;          // 关联 memoryTopics.id
  /** 条目类型:fact(事实)/quote(引用)/pref(用户偏好) */
  kind: 'fact' | 'quote' | 'pref';
  content: string;          // 条目内容
  source?: string;          // 来源路径(笔记或会话 id)
  ts: number;               // 时间戳
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

/* === V44: chunks CRUD === */

/** 批量写入某笔记的所有 chunks(覆盖式) */
export async function saveChunks(path: string, chunks: Array<Omit<ChunkRow, 'path'>>): Promise<void> {
  // 1) 删旧
  await db().chunks.where('path').equals(path).delete();
  // 2) 加新
  const rows: ChunkRow[] = chunks.map(c => ({ ...c, path }));
  if (rows.length > 0) await db().chunks.bulkPut(rows);
}

/** 取某笔记的所有 chunks(按 idx 排序) */
export async function loadChunksForNote(path: string): Promise<ChunkRow[]> {
  const rows = await db().chunks.where('path').equals(path).toArray();
  return rows.sort((a, b) => a.idx - b.idx);
}

/** 取所有 chunks(全量检索用) */
export async function loadAllChunks(): Promise<ChunkRow[]> {
  return await db().chunks.toArray();
}

/** 删某 path 下的所有 chunks(notes 改名/删除时级联) */
export async function deleteChunksForNote(path: string): Promise<void> {
  await db().chunks.where('path').equals(path).delete();
}

/* === V46: Memory CRUD === */

/** 列所有 active 主题(按 lastUsed 倒序) */
export async function listMemoryTopics(): Promise<MemoryTopicRow[]> {
  const rows = await db().memoryTopics.toArray();
  return rows
    .filter(t => t.status === 'active')
    .sort((a, b) => b.lastUsed - a.lastUsed);
}

/** 取某主题 + 它所有 items */
export async function getMemoryTopicWithItems(id: string): Promise<{ topic: MemoryTopicRow; items: MemoryItemRow[] } | null> {
  const topic = await db().memoryTopics.get(id);
  if (!topic) return null;
  const items = await db().memoryItems.where('topicId').equals(id).toArray();
  items.sort((a, b) => a.ts - b.ts);
  return { topic, items };
}

/** 创建主题 + 批量添加 items */
export async function createMemoryTopic(
  title: string,
  summary: string,
  items: Array<Omit<MemoryItemRow, 'id' | 'topicId' | 'ts'>>,
  sessionId?: string
): Promise<MemoryTopicRow> {
  const id = newSessionId();    // 复用 V42 的 uuid 函数
  const now = Date.now();
  const topic: MemoryTopicRow = {
    id, title: title.trim().slice(0, 80), summary: summary.trim().slice(0, 500),
    createdAt: now, lastUsed: now, sessionId, status: 'active',
  };
  await db().memoryTopics.put(topic);
  if (items.length > 0) {
    const rows: MemoryItemRow[] = items.map(it => ({
      topicId: id, kind: it.kind || 'fact', content: it.content,
      source: it.source, ts: now,
    }));
    await db().memoryItems.bulkAdd(rows);
  }
  return topic;
}

/** 删除主题(级联 items) */
export async function deleteMemoryTopic(id: string): Promise<void> {
  await db().memoryItems.where('topicId').equals(id).delete();
  await db().memoryTopics.delete(id);
}

/** 触摸主题 lastUsed(被新对话引用时) */
export async function touchMemoryTopic(id: string): Promise<void> {
  const t = await db().memoryTopics.get(id);
  if (t) await db().memoryTopics.put({ ...t, lastUsed: Date.now() });
}

/** 列出所有 items 用于导出 */
export async function exportAllMemory(): Promise<{ topics: MemoryTopicRow[]; items: MemoryItemRow[] }> {
  const topics = await db().memoryTopics.toArray();
  const items = await db().memoryItems.toArray();
  return { topics, items };
}

/** V43: 重命名/移动笔记(改 path + 同时更新 manifest)
 *  返回新 path(失败抛错)
 */
export async function renameNote(oldPath: string, newPath: string): Promise<string> {
  if (oldPath === newPath) return oldPath;
  if (!newPath || newPath === oldPath) throw new Error('新路径不能为空或与原路径相同');
  // 1. 读旧笔记
  const old = await db().notes.get(oldPath);
  if (!old) throw new Error(`笔记不存在: ${oldPath}`);
  // 2. 检查新路径是否冲突
  const exists = await db().notes.get(newPath);
  if (exists) throw new Error(`目标路径已存在: ${newPath}`);
  // 3. 删旧,加新
  const newSize = new TextEncoder().encode(old.content).length;
  await db().notes.put({
    path: newPath,
    content: old.content,
    mtime: Date.now(),
    hash: old.hash,
    cachedAt: Date.now(),
  });
  await db().notes.delete(oldPath);
  // 4. 更新 manifest entry(主键 = path)
  const oldEntry = await db().manifest.get(oldPath);
  if (oldEntry) {
    await db().manifest.put({ ...oldEntry, path: newPath, mtime: Date.now(), size: newSize });
    await db().manifest.delete(oldPath);
  }
  return newPath;
}

/** V43: 删 manifest 条目(与 deleteNote 配合用,保证两边一致) */
export async function deleteManifestEntry(path: string): Promise<void> {
  await db().manifest.delete(path);
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