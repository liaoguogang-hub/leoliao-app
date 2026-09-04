/**
 * V47: Wiki 引擎 — 跨笔记主题关联
 *
 * 提供:
 * - backlinks(path): 找出所有引用了 path 的笔记(反向链接)
 * - tagIndex(): 按 frontmatter tag 分组所有笔记
 * - vaultStats(): vault 全貌统计
 * - recentNotes(limit): 最近更新的笔记
 * - orphanNotes(): 没有 wikilink 也没被引用的孤立笔记
 */

import { db } from './db';

/** v1.48.0: 轻量 frontmatter tags 提取(不跑完整 markdown-it,只正则取 --- 块里的 tags/tag)
 *  大幅提速 vaultStats / tagIndex(1200 篇不再逐个 parseNote) */
function extractTagsQuick(content: string): string[] {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const fm = m[1];
  // tags: [a, b] 或 tag: x
  const tags: string[] = [];
  const arr = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  if (arr) {
    for (const t of arr[1].split(',')) {
      const v = t.trim().replace(/^['"]|['"]$/g, '').replace(/^#/, '');
      if (v) tags.push(v);
    }
  }
  const one = fm.match(/^tag:\s*(.+)$/m);
  if (one) {
    const v = one[1].trim().replace(/^['"]|['"]$/g, '').replace(/^#/, '');
    if (v) tags.push(v);
  }
  return tags;
}

export interface BackLink {
  /** 来源笔记路径(被找反向链接的笔记) */
  path: string;
  /** 反向链接 — 在来源笔记中引用了 path 的位置(context) */
  context: string;        // 包含 [[path]] 的一行(去掉 wikilink)
  /** 来源笔记的标题 */
  title: string;
  /** 来源笔记 mtime */
  mtime: number;
}

export interface TagIndex {
  tag: string;
  count: number;
  paths: string[];
}

export interface VaultStats {
  totalNotes: number;
  totalSize: number;          // 字节
  totalLinks: number;         // [[wikilinks]] 总数
  totalBackLinks: number;     // 反向链接总数
  totalChunks: number;
  totalTags: number;
  folderCount: number;
  avgNoteSize: number;
  largestNote?: { path: string; size: number };
}

/** 把 wikilink 内容提取出来(支持 [[xxx]] 和 [[xxx|alias]]) */
function extractWikilinks(content: string): string[] {
  const re = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1].trim());
  }
  return Array.from(out);
}

/** 找指向 targetPath 的所有反向链接 */
export async function backlinks(targetPath: string): Promise<BackLink[]> {
  const targetName = targetPath.replace(/\.md$/, '');
  const targetBasename = targetName.split('/').pop() || targetName;
  const all = await db().notes.toArray();
  const out: BackLink[] = [];
  for (const n of all) {
    const links = extractWikilinks(n.content);
    if (!links.includes(targetName) && !links.includes(targetBasename)) continue;
    // 找含 wikilink 的行作为 context
    const lines = n.content.split('\n');
    for (const line of lines) {
      if (line.includes(`[[${targetName}]]`) || line.includes(`[[${targetBasename}]]`)
        || line.includes(`[[${targetName}|`) || line.includes(`[[${targetBasename}|`)) {
        // 清理 wikilink syntax,保留自然语言
        const context = line
          .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, p, alias) => alias || p)
          .trim()
          .slice(0, 200);
        out.push({
          path: n.path,
          title: n.path.split('/').pop()?.replace(/\.md$/, '') || n.path,
          context,
          mtime: n.mtime,
        });
        break;
      }
    }
  }
  // 按 mtime 倒序
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** 按 tag 分组(从 frontmatter.tags) — v1.48.0 用轻量提取,不再 parseNote */
export async function tagIndex(): Promise<TagIndex[]> {
  const all = await db().notes.toArray();
  const map = new Map<string, string[]>();
  for (const n of all) {
    const tags = extractTagsQuick(n.content);
    for (const t of tags) {
      if (!t) continue;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(n.path);
    }
  }
  const out: TagIndex[] = [];
  for (const [tag, paths] of map) {
    out.push({ tag, count: paths.length, paths: paths.sort() });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/** vault 整体统计 */
export async function vaultStats(): Promise<VaultStats> {
  const all = await db().notes.toArray();
  const chunkCount = await db().chunks.count();
  // link 数(全 vault [[wikilinks]] 总数)
  let totalLinks = 0;
  for (const n of all) totalLinks += extractWikilinks(n.content).length;
  // 反向链接(去重:同一对源-目标只算一次)
  const linkPairs = new Set<string>();
  for (const n of all) {
    const links = extractWikilinks(n.content);
    for (const l of links) linkPairs.add(`${n.path}→${l}`);
  }
  // 文件夹数
  const folders = new Set<string>();
  for (const n of all) {
    const parts = n.path.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  // tag 数(v1.48: 轻量提取)
  const tagSet = new Set<string>();
  for (const n of all) {
    const tags = extractTagsQuick(n.content);
    for (const t of tags) tagSet.add(t);
  }
  const totalSize = all.reduce((s, n) => s + n.content.length, 0);
  const avgNoteSize = all.length === 0 ? 0 : Math.round(totalSize / all.length);
  // 最大笔记
  let largest: { path: string; size: number } | undefined;
  for (const n of all) {
    if (!largest || n.content.length > largest.size) {
      largest = { path: n.path, size: n.content.length };
    }
  }
  return {
    totalNotes: all.length,
    totalSize,
    totalLinks,
    totalBackLinks: linkPairs.size,
    totalChunks: chunkCount,
    totalTags: tagSet.size,
    folderCount: folders.size,
    avgNoteSize,
    largestNote: largest,
  };
}

/** 最近更新的 N 篇笔记 */
export async function recentNotes(limit = 20): Promise<Array<{ path: string; title: string; mtime: number; size: number }>> {
  const all = await db().notes.toArray();
  const sorted = all.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  return sorted.map(n => ({
    path: n.path,
    title: n.path.split('/').pop()?.replace(/\.md$/, '') || n.path,
    mtime: n.mtime,
    size: n.content.length,
  }));
}

/** 孤立笔记:既没 wikilink 出,也没 wikilink 进 */
export async function orphanNotes(): Promise<string[]> {
  const all = await db().notes.toArray();
  // 出链集合:这篇笔记里的 [[xxx]]
  const outgoing = new Set<string>();
  // 进链集合:这篇笔记被哪些 [[xxx]] 引用
  const incoming = new Set<string>();
  for (const n of all) {
    const name = n.path.replace(/\.md$/, '');
    const links = extractWikilinks(n.content);
    for (const l of links) outgoing.add(`${n.path}→${l}`);
    // 反向:下一篇笔记里是否引用了我
    incoming.add(name);
  }
  const orphans: string[] = [];
  for (const n of all) {
    const name = n.path.replace(/\.md$/, '');
    const hasOut = outgoing.has(n.path);   // 有没有 [[xxx]]
    const isReferenced = all.some(other => {
      if (other.path === n.path) return false;
      const links = extractWikilinks(other.content);
      return links.includes(name);
    });
    if (!hasOut && !isReferenced) orphans.push(n.path);
  }
  return orphans;
}

/** 提取 frontmatter tags(单篇笔记用) */
export function getNoteTags(note: { frontmatter?: any }): string[] {
  if (!note.frontmatter) return [];
  const t = note.frontmatter.tags;
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(/[,\s]+/).filter(Boolean);
  return [];
}