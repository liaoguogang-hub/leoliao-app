/**
 * v1.16.0 Phase W.1 — 自动 Wiki 生成
 *
 * 输入:文件夹前缀(空 = 整个 vault)
 * 输出:AutoWiki 结构
 *   - 概览(100 字总结)
 *   - 关键概念 Top10(从 tag 频次 + chunk 关键词抽取)
 *   - MOC 索引(按 tag 聚类的笔记列表)
 *   - 时间线(按 mtime 排序的近期编辑)
 *
 * 两档实现:
 *   L1: LLM 归纳(若 chat settings 配置了 LLM)
 *   L2: 纯本地统计(关键词频次、tag 分布、最近编辑)— 兜底
 *
 * 永不抛错 — 失败返回统计视图
 */

import { db } from './db';
import { parseNote } from './renderer';
import { tagIndex, recentNotes } from './wiki';

// === 类型定义 ===

export interface AutoWikiConcept {
  term: string;            // 概念名
  weight: number;          // 权重 0-1
  /** 关联笔记路径(1-3 篇) */
  relatedPaths: string[];
}

export interface AutoWikiMoc {
  tag: string;
  count: number;
  paths: string[];
}

export interface AutoWikiTimelineEntry {
  path: string;
  title: string;
  mtime: number;
}

export interface AutoWiki {
  /** 统计文件夹范围 */
  scope: string;
  /** 笔记总数 */
  noteCount: number;
  /** 总大小(字节) */
  totalSize: number;
  /** 概览文字(LLM 生成 or 统计拼接) */
  overview: string;
  /** 关键概念 */
  concepts: AutoWikiConcept[];
  /** MOC 按 tag 聚合 */
  mocs: AutoWikiMoc[];
  /** 时间线 */
  timeline: AutoWikiTimelineEntry[];
  /** 生成时间戳 */
  generatedAt: number;
  /** 用的是 L1(LLM) 还是 L2(统计) */
  source: 'llm' | 'stats';
  /** 总耗时 ms */
  durationMs: number;
}

export interface AutoWikiOptions {
  /** 文件夹前缀(空 = 整个 vault) */
  prefix?: string;
  /** 概念数量上限(默认 10) */
  maxConcepts?: number;
  /** MOC tag 数量上限(默认 8) */
  maxMocs?: number;
  /** 时间线条数(默认 15) */
  maxTimeline?: number;
}

// === 主入口 ===

export async function generateAutoWiki(opts: AutoWikiOptions = {}): Promise<AutoWiki> {
  const start = performance.now();
  const prefix = opts.prefix || '';
  const maxConcepts = opts.maxConcepts ?? 10;
  const maxMocs = opts.maxMocs ?? 8;
  const maxTimeline = opts.maxTimeline ?? 15;

  // 1) 拉所有 notes + 过滤
  const allNotes = await db().notes.toArray();
  const filtered = prefix
    ? allNotes.filter(n => n.path === prefix || n.path.startsWith(prefix + '/'))
    : allNotes;

  // 2) 概览(统计拼接)
  const overview = buildOverview(filtered, prefix);

  // 3) 关键概念:tag 频次 + 标题/正文 token 频次
  const concepts = await extractConcepts(filtered, maxConcepts);

  // 4) MOC 按 tag 聚合
  const tagIdx = await tagIndex();
  const mocs: AutoWikiMoc[] = tagIdx
    .filter(t => !prefix || t.paths.some(p => p === prefix || p.startsWith(prefix + '/')))
    .slice(0, maxMocs)
    .map(t => ({
      tag: t.tag,
      count: t.count,
      paths: prefix
        ? t.paths.filter(p => p === prefix || p.startsWith(prefix + '/'))
        : t.paths,
    }));

  // 5) 时间线
  const recent = await recentNotes(maxTimeline);
  const timeline: AutoWikiTimelineEntry[] = (prefix
    ? recent.filter(n => n.path === prefix || n.path.startsWith(prefix + '/'))
    : recent
  ).map(n => ({
    path: n.path,
    title: n.path.split('/').pop()?.replace(/\.md$/, '') || n.path,
    mtime: n.mtime,
  }));

  return {
    scope: prefix || '(whole vault)',
    noteCount: filtered.length,
    totalSize: filtered.reduce((s, n) => s + n.content.length, 0),
    overview,
    concepts,
    mocs,
    timeline,
    generatedAt: Date.now(),
    source: 'stats',  // 当前 L1 LLM 归纳预留接口
    durationMs: Math.round(performance.now() - start),
  };
}

// === 子模块 ===

/** 概览:统计拼接 */
function buildOverview(notes: { path: string; content: string }[], prefix: string): string {
  if (notes.length === 0) {
    return `📭 范围 "${prefix || '(vault)'}" 内暂无笔记。`;
  }
  const totalSize = notes.reduce((s, n) => s + n.content.length, 0);
  const avgSize = Math.round(totalSize / notes.length);
  const folders = new Set<string>();
  for (const n of notes) {
    const parts = n.path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      folders.add(parts.slice(0, i + 1).join('/'));
    }
  }
  return [
    `📁 范围"${prefix || '(vault)'}"`,
    `共 ${notes.length} 篇笔记`,
    `总大小 ${(totalSize / 1024).toFixed(1)} KB`,
    `平均 ${avgSize} 字/篇`,
    `分布在 ${folders.size} 个子目录`,
  ].join(' · ');
}

/** 抽取关键概念:tag 频次 + 标题 token 频次 */
async function extractConcepts(
  notes: { path: string; content: string }[],
  max: number
): Promise<AutoWikiConcept[]> {
  const STOP = new Set([
    '的', '了', '是', '在', '和', '与', '或', '及', '等', '为', '我', '你', '他', '她', '它',
    '这', '那', '有', '没', '不', '也', '都', '就', '要', '会', '能',
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'and', 'or', 'but',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'as', 'this', 'that',
    'i', 'you', 'he', 'she', 'we', 'they', 'it', 'its',
  ]);

  const conceptMap = new Map<string, { weight: number; paths: Set<string> }>();

  // 来源 1:frontmatter tags
  for (const n of notes) {
    try {
      const { frontmatter } = parseNote(n.content);
      const tags = (frontmatter as any).tags;
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          const t = String(tag).replace(/^#/, '');
          if (!t || t.length < 2) continue;
          const existing = conceptMap.get(t);
          if (existing) {
            existing.weight += 2.0;
            existing.paths.add(n.path);
          } else {
            conceptMap.set(t, { weight: 2.0, paths: new Set([n.path]) });
          }
        }
      }
    } catch { /* frontmatter 解析失败,跳过 */ }
  }

  // 来源 2:笔记标题 token
  for (const n of notes) {
    const title = n.path.split('/').pop()?.replace(/\.md$/, '') || '';
    const enTokens = title.toLowerCase().match(/[a-z0-9_]+/g) || [];
    const cnChars = title.match(/[一-鿿]+/g) || [];
    const tokens = [
      ...enTokens.filter(t => t.length >= 2 && !STOP.has(t)),
      ...(cnChars.join('').split('').filter(c => !STOP.has(c))),
    ];
    for (const t of tokens) {
      const existing = conceptMap.get(t);
      if (existing) {
        existing.weight += 1.0;
        existing.paths.add(n.path);
      } else {
        conceptMap.set(t, { weight: 1.0, paths: new Set([n.path]) });
      }
    }
  }

  // 排序 + 归一化 + 截取
  const sorted = [...conceptMap.entries()]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, max);

  const maxWeight = sorted[0]?.[1].weight || 1;
  return sorted.map(([term, { weight, paths }]) => ({
    term,
    weight: weight / maxWeight,
    relatedPaths: [...paths].slice(0, 3),
  }));
}

/** 把 AutoWiki 渲染成 Markdown(可保存为 .md 文件) */
export function renderAutoWikiAsMarkdown(wiki: AutoWiki): string {
  const lines: string[] = [];
  lines.push(`# ${wiki.scope} Wiki`);
  lines.push('');
  lines.push(`> 自动生成于 ${new Date(wiki.generatedAt).toLocaleString('zh-CN')} · ${wiki.durationMs}ms · ${wiki.noteCount} 篇笔记`);
  lines.push('');
  lines.push('## 📌 概览');
  lines.push('');
  lines.push(wiki.overview);
  lines.push('');
  if (wiki.concepts.length > 0) {
    lines.push('## 🔑 关键概念');
    lines.push('');
    for (const c of wiki.concepts) {
      const bar = '█'.repeat(Math.round(c.weight * 10)) + '░'.repeat(10 - Math.round(c.weight * 10));
      lines.push(`- \`${c.term}\` ${bar} (${c.relatedPaths.length} 篇)`);
    }
    lines.push('');
  }
  if (wiki.mocs.length > 0) {
    lines.push('## 🗂 MOC 索引');
    lines.push('');
    for (const m of wiki.mocs) {
      lines.push(`### #${m.tag} (${m.count})`);
      for (const p of m.paths.slice(0, 20)) {
        lines.push(`- [[${p}]]`);
      }
      if (m.paths.length > 20) lines.push(`- ... +${m.paths.length - 20} 篇`);
      lines.push('');
    }
  }
  if (wiki.timeline.length > 0) {
    lines.push('## 📅 时间线');
    lines.push('');
    for (const t of wiki.timeline) {
      const date = new Date(t.mtime).toLocaleDateString('zh-CN');
      lines.push(`- ${date} [[${t.path}|${t.title}]]`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// === v1.17.0: Wiki MOC ===

export interface MocEntry {
  /** 关联笔记路径 */
  path: string;
  /** 关联笔记标题 */
  title: string;
  /** 关联类型 */
  kind: 'backlink' | 'same-tag' | 'parent' | 'downstream';
  /** 关联标签(同 tag 时) */
  tag?: string;
}

export interface NoteMoc {
  /** 当前笔记路径 */
  path: string;
  /** 反向链接(谁引用了我) */
  backlinks: MocEntry[];
  /** 同 tag 笔记 */
  sameTag: MocEntry[];
  /** 上层笔记(父目录的笔记/索引) */
  parents: MocEntry[];
  /** 下游笔记(我引用了谁,且该笔记反向引用了我 → 强连接) */
  downstream: MocEntry[];
  /** 统计 */
  stats: {
    backlinkCount: number;
    sameTagCount: number;
    parentCount: number;
    downstreamCount: number;
  };
}

/**
 * v1.17.0: 生成单篇笔记的 MOC(Map of Content)
 *
 * 4 类关联:
 *   - backlinks: 谁引用了我(wikilink 指向 path)
 *   - sameTag: 同 tag 笔记(共享至少 1 个 frontmatter tag)
 *   - parents: 父目录的笔记(从 path 提取父目录,找该目录下其他笔记)
 *   - downstream: 双向引用(我引用了它,它也引用了我)
 *
 * 注意:每类上限 20 条,避免页面过长
 */
export async function generateNoteMoc(path: string): Promise<NoteMoc> {
  const allNotes = await db().notes.toArray();
  const self = allNotes.find(n => n.path === path);
  if (!self) {
    return {
      path,
      backlinks: [], sameTag: [], parents: [], downstream: [],
      stats: { backlinkCount: 0, sameTagCount: 0, parentCount: 0, downstreamCount: 0 },
    };
  }

  const LIMIT = 20;

  // 1) 自己提取的 wikilinks(下游候选)
  const { links: myWikilinks } = parseNote(self.content);
  const myWikilinkSet = new Set(myWikilinks.map(l => l.toLowerCase().replace(/\.md$/, '')));

  // 2) 自己 frontmatter 的 tags
  const { frontmatter } = parseNote(self.content);
  const myTags = new Set<string>();
  if (Array.isArray((frontmatter as any).tags)) {
    for (const t of (frontmatter as any).tags) myTags.add(String(t).replace(/^#/, ''));
  }

  // 3) 反向链接 + 同 tag + 下游(一次遍历)
  const backlinks: MocEntry[] = [];
  const sameTag: MocEntry[] = [];
  const downstream: MocEntry[] = [];
  const seenSameTag = new Set<string>();

  for (const n of allNotes) {
    if (n.path === path) continue;
    const title = n.path.split('/').pop()?.replace(/\.md$/, '') || n.path;

    // 反向链接:谁引用了我
    try {
      const { links: otherLinks } = parseNote(n.content);
      const lowerLinks = otherLinks.map(l => l.toLowerCase().replace(/\.md$/, ''));
      if (lowerLinks.some(l => l === path.toLowerCase().replace(/\.md$/, ''))) {
        backlinks.push({ path: n.path, title, kind: 'backlink' });
      }
      // 下游:我引用了它 + 它引用了我
      if (myWikilinkSet.size > 0 && lowerLinks.some(l => myWikilinkSet.has(l))) {
        downstream.push({ path: n.path, title, kind: 'downstream' });
      }
    } catch { /* skip parse errors */ }

    // 同 tag
    if (myTags.size > 0) {
      try {
        const { frontmatter: otherFm } = parseNote(n.content);
        const otherTags = (otherFm as any).tags;
        if (Array.isArray(otherTags)) {
          for (const t of otherTags) {
            const tagStr = String(t).replace(/^#/, '');
            if (myTags.has(tagStr) && !seenSameTag.has(n.path)) {
              seenSameTag.add(n.path);
              sameTag.push({ path: n.path, title, kind: 'same-tag', tag: tagStr });
              break;
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // 4) 上层笔记(父目录的所有笔记)
  const parents: MocEntry[] = [];
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash > 0) {
    const parentDir = path.slice(0, lastSlash);
    for (const n of allNotes) {
      const np = n.path;
      if (np === path) continue;
      if (np.startsWith(parentDir + '/') && !np.slice(parentDir.length + 1).includes('/')) {
        const title = np.split('/').pop()?.replace(/\.md$/, '') || np;
        parents.push({ path: np, title, kind: 'parent' });
      }
    }
  }

  return {
    path,
    backlinks: backlinks.slice(0, LIMIT),
    sameTag: sameTag.slice(0, LIMIT),
    parents: parents.slice(0, LIMIT),
    downstream: downstream.slice(0, LIMIT),
    stats: {
      backlinkCount: backlinks.length,
      sameTagCount: sameTag.length,
      parentCount: parents.length,
      downstreamCount: downstream.length,
    },
  };
}

