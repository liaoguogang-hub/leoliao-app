/**
 * 开机欢迎图服务
 * - 从 OSS welcome/manifest.json 读图片清单
 * - 下载并缓存到 IndexedDB(离线也能显示)
 * - 随机返回一张缓存图片,作为开机欢迎页
 * - 以后只要更新 OSS welcome/ 里的图片(+ 定时任务重建清单)即可
 */
import { CapacitorHttp } from '@capacitor/core';
import { getSourceConfig } from './sync';
import * as DB from './db';

interface WelcomeEntry { name: string; size: number; hash: string; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function baseUrl(): string {
  return getSourceConfig().baseUrl;
}

async function httpGet(url: string, opts: any = {}, retries = 3): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await CapacitorHttp.get({ url, connectTimeout: 15000, readTimeout: 20000, ...opts });
      if (res.status === 200) return res.data;
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) break;
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await sleep(300 * (i + 1));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? '请求失败'));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** 立即返回一张已缓存的随机欢迎图(没有则 null) */
export async function pickCachedWelcome(): Promise<string | null> {
  const all = await DB.loadAllWelcome();
  if (!all.length) return null;
  // 无 Math.random 限制(这是普通 app 代码,不是 workflow 脚本)
  const idx = Math.floor(Math.random() * all.length);
  return all[idx].dataUrl;
}

/** 首次无缓存时:只快速下载一张随机图并缓存,立即用于显示(其余交给 syncWelcome 补齐) */
export async function fetchRandomWelcomeQuick(): Promise<string | null> {
  const raw = await httpGet(`${baseUrl()}/welcome/manifest.json`);
  const list: WelcomeEntry[] = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
  if (!Array.isArray(list) || !list.length) return null;
  const e = list[Math.floor(Math.random() * list.length)];
  const dataUrl = await downloadAsDataUrl(`${baseUrl()}/welcome/${encodeURIComponent(e.name)}`);
  if (!dataUrl) return null;
  await DB.saveWelcome(e.name, dataUrl, e.hash);
  return dataUrl;
}

async function downloadAsDataUrl(url: string): Promise<string | null> {
  const data = await httpGet(url, { responseType: 'blob' });
  if (typeof data === 'string') return `data:image/jpeg;base64,${data}`;   // 原生返回 base64
  if (data instanceof Blob) return await blobToDataUrl(data);              // web 返回 Blob
  return null;
}

/** 后台同步:拉清单 → 下载缺失/变化的图 → 缓存 → 清理已删除的 */
export async function syncWelcome(): Promise<void> {
  const raw = await httpGet(`${baseUrl()}/welcome/manifest.json`);
  const list: WelcomeEntry[] = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
  if (!Array.isArray(list)) return;

  const cached = await DB.loadAllWelcome();
  const cachedMap = new Map(cached.map(c => [c.name, c]));
  const wanted = new Set(list.map(e => e.name));

  for (const e of list) {
    const c = cachedMap.get(e.name);
    if (c && c.hash === e.hash) continue; // 已缓存且未变
    try {
      const dataUrl = await downloadAsDataUrl(`${baseUrl()}/welcome/${encodeURIComponent(e.name)}`);
      if (dataUrl) await DB.saveWelcome(e.name, dataUrl, e.hash);
    } catch (err) {
      console.warn('[welcome] 下载失败', e.name, (err as Error).message);
    }
  }
  // 清理 OSS 上已删除的
  for (const c of cached) {
    if (!wanted.has(c.name)) await DB.deleteWelcome(c.name);
  }
}
