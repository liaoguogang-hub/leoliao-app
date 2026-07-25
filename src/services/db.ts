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

class LeoLiaoDB extends Dexie {
  manifest!: Table<ManifestEntry, string>;
  notes!: Table<CachedNote, string>;
  welcome!: Table<CachedWelcome, string>;

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
  }
}

let _db: LeoLiaoDB | null = null;

function db(): LeoLiaoDB {
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