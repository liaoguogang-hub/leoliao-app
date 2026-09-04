/**
 * Sync 服务 — 拉取 OSS / NAS / Mock 的 manifest + 文件
 *
 * 阶段：
 * 1. 现在: 用 mock 数据（OSS bucket 还没就绪）
 * 2. 之后: 切换到 OSS 真实拉取（只要改 SOURCE.baseUrl）
 *
 * 用 CapacitorHttp 替代 fetch：
 * - WebView 默认拦跨域 fetch（CORS）
 * - CapacitorHttp 走原生 HTTP,绕过 WebView 限制
 * - Web 端自动 fallback 到 fetch
 */

import { CapacitorHttp } from '@capacitor/core';
import type { ManifestEntry, NoteFile, SyncStatus, SyncSource } from '../types';
import { MOCK_MANIFEST, MOCK_FILES } from '../data/mock-data';
import * as DB from './db';
import { parseNote } from './renderer';
import { chunkDocument, chunkHash } from './chunker';
import { buildVectorIndex } from '../lib/search';

interface SyncSourceConfig {
  type: SyncSource;
  baseUrl: string;        // e.g. https://liaoguogang.oss-cn-shanghai.aliyuncs.com
  manifestPath: string;   // e.g. /Obsidian/manifest.json
  notesPrefix: string;    // 笔记文件所在目录前缀,如 /Obsidian(文件 URL = baseUrl + notesPrefix + / + path)
}

/** 编码 URL 路径,每段分别 encode,保留 / 分隔符 */
function encPath(relPath: string): string {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

/** 只保留 .md 文件:确保「所有 md 且仅 md」被同步,其他类型一律过滤掉 */
function onlyMarkdown(manifest: ManifestEntry[]): ManifestEntry[] {
  return (manifest || []).filter(
    (e) => e && typeof e.path === 'string' && e.path.toLowerCase().endsWith('.md')
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 带自动重试的 GET(返回 CapacitorHttp 的原始 data)。
 * 修复"首次点开笔记加载失败,需要二次加载":Android 上 CapacitorHttp 首次向某主机
 * 请求常因冷连接/TLS 握手/瞬时抖动失败,这里自动退避重试。
 * 注意:不要设 responseType:'text' —— CapacitorHttp 会按 Content-Type 自动解析,
 * JSON 响应会返回对象/数组(强转字符串会损坏),由调用方按类型处理。
 */
async function httpGet(url: string, retries = 3): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await CapacitorHttp.get({ url, connectTimeout: 15000, readTimeout: 20000 });
      if (res.status === 200) return res.data;
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) break; // 4xx(404 等)重试无意义
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries - 1) await sleep(300 * (attempt + 1)); // 300ms / 600ms 退避
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? '请求失败'));
}

/** 取文本内容(md 文件):CapacitorHttp 对 text/* 返回字符串 */
async function httpGetText(url: string, retries = 3): Promise<string> {
  const data = await httpGet(url, retries);
  return typeof data === 'string' ? data : String(data);
}

/** 取 JSON(manifest):data 可能已是对象/数组,也可能是字符串 */
async function httpGetJson(url: string, retries = 3): Promise<any> {
  const data = await httpGet(url, retries);
  if (typeof data === 'string') return JSON.parse(data);
  return data;
}

const SOURCE: SyncSourceConfig = {
  type: 'oss',
  baseUrl: 'https://liaoguogang.oss-cn-shanghai.aliyuncs.com',
  manifestPath: '/Obsidian/manifest.json',
  notesPrefix: '/Obsidian',
};

let _status: SyncStatus = {
  source: 'mock',
  total: 0,
  synced: 0,
  errors: [],
  lastSync: 0,
};

export function getStatus(): SyncStatus {
  return _status;
}

/* === Mock 模式 === */

async function syncFromMock(): Promise<ManifestEntry[]> {
  // 直接读 mock 数据，写入 Dexie
  const manifest = MOCK_MANIFEST;
  await DB.saveManifest(manifest);

  let synced = 0;
  for (const entry of manifest) {
    const content = MOCK_FILES[entry.path];
    if (!content) continue;
    await DB.saveNote(entry.path, content, entry.mtime, entry.hash);
    synced++;
  }

  _status = {
    source: 'mock',
    total: manifest.length,
    synced,
    errors: [],
    lastSync: Date.now(),
  };
  return manifest;
}

/* === OSS / HTTP 模式 === */

async function syncFromOSS(): Promise<ManifestEntry[]> {
  // V10 fix: 用 CapacitorHttp 绕过 WebView CORS;带重试
  const manifestUrl = SOURCE.baseUrl + SOURCE.manifestPath;
  console.log('[sync] GET', manifestUrl);
  let raw: unknown;
  try {
    raw = await httpGetJson(manifestUrl);
  } catch (e) {
    throw new Error(`manifest 拉取/解析失败 (${manifestUrl}): ${(e as Error).message}`);
  }
  // 只同步 .md 文件:其他类型一律不进 manifest / 不下载
  const manifest: ManifestEntry[] = onlyMarkdown(raw as ManifestEntry[]);
  console.log(`[sync] manifest 共 ${Array.isArray(raw) ? raw.length : 0} 条,过滤后 md ${manifest.length} 条`);

  await DB.saveManifest(manifest);
  _status.errors = [];

  // 找出还没缓存(或已变化)的条目
  const findMissing = async (): Promise<ManifestEntry[]> => {
    const miss: ManifestEntry[] = [];
    for (const e of manifest) {
      const c = await DB.loadNote(e.path);
      if (!(c && c.hash === e.hash && c.mtime >= e.mtime)) miss.push(e);
    }
    return miss;
  };

  const fetchOne = async (entry: ManifestEntry): Promise<boolean> => {
    const fileUrl = `${SOURCE.baseUrl}${SOURCE.notesPrefix}/${encPath(entry.path)}`;
    try {
      const content = await httpGetText(fileUrl);   // 内部已带 3 次重试
      await DB.saveNote(entry.path, content, entry.mtime, entry.hash);
      return true;
    } catch {
      return false;
    }
  };

  // 并发下载(6 路),最多两遍——第一遍网络抖动漏掉的,第二遍补齐,尽量保证全缓存
  const CONCURRENCY = 6;
  let toFetch = await findMissing();
  console.log(`[sync] 需下载 ${toFetch.length} 个(其余已缓存)`);
  for (let pass = 0; pass < 2 && toFetch.length > 0; pass++) {
    let idx = 0;
    const worker = async () => {
      while (idx < toFetch.length) {
        const entry = toFetch[idx++];
        await fetchOne(entry);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    toFetch = await findMissing();  // 重新统计,剩下的进入下一遍
    console.log(`[sync] 第 ${pass + 1} 遍后仍缺 ${toFetch.length} 个`);
  }

  // V44: 同步 chunk 切分(所有已缓存的 notes → chunks)
  await reindexChunks(manifest);

  // V48: 异步建向量索引(后台,不阻塞 sync)
  buildVectorIndex().then(({ indexed, total }) => {
    console.log(`[sync] vector indexed: ${indexed}/${total} chunks`);
  }).catch(e => console.warn('[sync] vector index failed', e));

  // synced 按「真实缓存状态」统计:显示 1258/1258 即代表确实全部缓存
  const synced = manifest.length - toFetch.length;

  _status = {
    source: 'oss',
    total: manifest.length,
    synced,
    errors: toFetch.map(e => `${e.path}: 未缓存(网络失败)`),
    lastSync: Date.now(),
  };
  return manifest;
}

/* === 入口 === */

export async function sync(): Promise<ManifestEntry[]> {
  if (SOURCE.type === 'mock') return syncFromMock();
  if (SOURCE.type === 'oss') return syncFromOSS();
  throw new Error(`Unknown sync source: ${SOURCE.type}`);
}

/* === 文件读取 === */

export async function getNote(path: string): Promise<NoteFile | null> {
  // 优先缓存
  const cached = await DB.loadNote(path);
  if (cached) {
    // v1.14.0: 把 chunks 信息传给 parseNote,渲染时插 data-cid 锚点(用于 jump-to-chunk)
    const chunks = await DB.loadChunksForNote(path);
    const parsed = parseNote(cached.content, {
      chunks: chunks.length > 0 ? chunks.map(c => ({ idx: c.idx, startOffset: c.startOffset, endOffset: c.endOffset })) : undefined,
      path,
    });
    return {
      path: cached.path,
      content: cached.content,
      ...parsed,
      mtime: cached.mtime,
    };
  }
  // 缓存未命中（mock 模式不应该发生；OSS 模式按需拉）
  if (SOURCE.type === 'oss') {
    const fileUrl = `${SOURCE.baseUrl}${SOURCE.notesPrefix}/${encPath(path)}`;
    try {
      const content = await httpGetText(fileUrl);
      const entry = await DB.getManifestEntry(path);
      const mtime = entry?.mtime ?? Date.now();
      const hash = entry?.hash ?? '';
      await DB.saveNote(path, content, mtime, hash);
      const parsed = parseNote(content);
      return { path, content, ...parsed, mtime };
    } catch (e) {
      const msg = (e as Error).message;
      throw new Error(`oss:${msg}`);
    }
  }
  return null;
}

export function getSourceConfig(): SyncSourceConfig {
  return { ...SOURCE };
}

/** V44: 全量重建 chunks 索引(对所有已缓存的 notes) */
async function reindexChunks(_manifest: ManifestEntry[]) {
  const allNotes = await DB.loadAllNotes();
  let totalChunks = 0;
  for (const note of allNotes) {
    const chunks = chunkDocument(note.path, note.content);
    const rows = chunks.map(c => ({
      idx: c.idx,
      heading: c.heading,
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      hash: chunkHash(c.content),
      mtime: note.mtime,
    }));
    await DB.saveChunks(note.path, rows);
    totalChunks += rows.length;
  }
  console.log(`[sync] chunked: ${allNotes.length} notes → ${totalChunks} chunks`);
}