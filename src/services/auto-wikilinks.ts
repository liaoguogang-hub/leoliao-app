/**
 * v1.30.0 — Auto-inject Wikilinks
 *
 * 用户场景:Obsidian vault 迁移过来后,大多数笔记正文里没有 [[wikilink]] 标记,
 *           导致 graph-view 没节点、wikilink 跳转失效
 *
 * 解决方案:遍历 vault,对每篇 A,扫所有其他笔记 B 的标题,
 *          如果 A 正文里**没有** [[B]] 但**提到** B 标题中的核心词,就在第一次出现处注入 [[B]]
 *
 * 设计原则:
 * 1. **零 token / 离线**:纯本地字符匹配,不调 LLM
 * 2. **可逆**:提供 revert() 函数,删除之前注入的链接
 * 3. **保守**:只在"高置信度"(标题中的核心词在 A 正文里至少出现 1 次,且 A 里没有 [[B]])时注入
 * 4. **不破坏语义**:在第一次出现的核心词后面立即加 [[B]],不加到标题或正文开头
 *
 * 用法:
 *   const result = await autoInjectWikilinks({ dryRun: true });
 *   // { added: 42, candidates: [...], skipped: [...] }
 *   const result2 = await autoInjectWikilinks({ dryRun: false });
 *   // 实际写入
 */

import { db } from './db';

export interface AutoWikilinkCandidate {
  /** 源笔记(被注入链接的那篇) */
  sourcePath: string;
  /** 目标笔记(被 [[...]] 引用的) */
  targetPath: string;
  /** 命中的核心词 */
  matchedKeyword: string;
  /** 注入位置的字符 offset(在 sourcePath 的 content 中) */
  insertOffset: number;
  /** 预览(注入点附近 60 字) */
  preview: string;
}

export interface AutoWikilinkResult {
  /** 成功注入的链接数 */
  added: number;
  /** 评估的候选数(扫描出的所有可能) */
  candidates: AutoWikilinkCandidate[];
  /** 跳过的(已存在或低于阈值) */
  skipped: number;
  /** dryRun 模式 */
  dryRun: boolean;
  /** 耗时 ms */
  durationMs: number;
}

export interface AutoWikilinkOptions {
  /** true = 只统计不写;false = 真写 */
  dryRun?: boolean;
  /** 单篇笔记最多注入多少链接(默认 50,防止单篇链接爆炸) */
  maxPerNote?: number;
  /** 单笔记标题最少要几个字符才参与匹配(默认 3,过滤太短标题) */
  minTitleLen?: number;
  /** 是否跳过本地文件路径(📕📘 前缀)— 默认 true */
  skipLocalFiles?: boolean;
}

const WIKILINK_RE = /\[\[([^\]\|]+?)(?:\|[^\]]*)?\]\]/g;

/**
 * 提取笔记标题的"核心词" — 用于跨笔记匹配
 *
 * 策略:
 * - 去掉 .md 扩展名
 * - 去掉前后路径(只留 basename)
 * - 去掉日期前缀(2024-01-15 xxx → xxx)
 * - 去掉序号(01. xxx → xxx)
 * - 拆成英文/中文 token
 * - 过滤停用词
 */
export function extractKeywords(title: string): string[] {
  // 去扩展名
  let t = title.replace(/\.md$/i, '');
  // 去路径(只留 basename,OEBPS/ch3.xhtml → ch3)
  const parts = t.split('/');
  t = parts[parts.length - 1];
  // 去日期前缀 2024-01-15 xxx
  t = t.replace(/^\d{4}[-_]\d{1,2}[-_]\d{1,2}[-_ ]?/, '');
  // 去序号前缀 01. / 01- / (1) /
  t = t.replace(/^\d+[\.\-_\s]+/, '');
  // 去常见前缀(中文类目标记)
  t = t.replace(/^(公众号|读书|笔记|草稿|模板|归档)/, '');

  const keywords = new Set<string>();

  // 英文/数字 token
  const enMatches = t.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const w of enMatches) {
    if (w.length >= 3) keywords.add(w);
  }
  // 中文:拆字 + 2-gram
  const cnChars = t.match(/[一-鿿]+/g) || [];
  for (const seg of cnChars) {
    for (let i = 0; i < seg.length - 1; i++) {
      const bg = seg.slice(i, i + 2);
      if (!STOP_WORDS.has(bg)) keywords.add(bg);
    }
    // 也存整段(如果 ≤ 6 字)
    if (seg.length >= 2 && seg.length <= 6) {
      keywords.add(seg);
    }
  }
  // 数字也算(可能是笔记 ID)
  const nums = t.match(/\d+/g) || [];
  for (const n of nums) {
    if (n.length >= 2) keywords.add(n);
  }
  return [...keywords];
}

const STOP_WORDS = new Set([
  '这是', '我们', '他们', '自己', '因为', '所以', '如果', '或者',
  '那么', '什么', '怎么', '现在', '可以', '应该', '需要',
]);

/**
 * 主入口:扫描 vault,生成候选 wikilink 注入列表
 *
 * @returns 候选列表(已经在内部过滤了"已经存在 [[B]]"的情况)
 */
export async function autoInjectWikilinks(
  opts: AutoWikilinkOptions = {}
): Promise<AutoWikilinkResult> {
  const start = performance.now();
  const dryRun = opts.dryRun ?? true;
  const maxPerNote = opts.maxPerNote ?? 50;    // v1.50.0: 单篇放宽,不设全局上限
  const minTitleLen = opts.minTitleLen ?? 3;
  const skipLocal = opts.skipLocalFiles ?? true;

  // 1) 读所有笔记
  const allNotes = await db().notes.toArray();
  if (skipLocal) {
    // 默认跳过本地文件(📕📘 前缀)
  }

  // 2) 构建"标题 → keywords"索引(只保留 vault 笔记,跳过本地文件)
  const targetIndex: Array<{ path: string; title: string; keywords: string[] }> = [];
  for (const n of allNotes) {
    if (skipLocal && (n.path.startsWith('📕') || n.path.startsWith('📘'))) continue;
    const title = n.path.split('/').pop()?.replace(/\.md$/, '') || n.path;
    if (title.length < minTitleLen) continue;
    const keywords = extractKeywords(title);
    if (keywords.length === 0) continue;
    targetIndex.push({ path: n.path, title, keywords });
  }

  console.log(`[auto-wikilinks] 扫描 ${allNotes.length} 笔记 / 目标索引 ${targetIndex.length} 条`);

  // 3) 对每篇源笔记,扫所有目标
  const candidates: AutoWikilinkCandidate[] = [];
  let skipped = 0;

  for (const note of allNotes) {
    if (skipLocal && (note.path.startsWith('📕') || note.path.startsWith('📘'))) continue;
    // 跳过自己
    const selfTitle = note.path.split('/').pop()?.replace(/\.md$/, '') || '';
    if (selfTitle.length < minTitleLen) continue;

    // 提取已有的 [[...]] (避免重复)
    const existingWikilinks = new Set<string>();
    WIKILINK_RE.lastIndex = 0;
    let m;
    while ((m = WIKILINK_RE.exec(note.content)) !== null) {
      existingWikilinks.add(m[1].trim().toLowerCase());
    }

    // 记录匹配过的目标(每篇只匹配一次,避免重复注 [[A]][[A]])
    const matched = new Set<string>();

    // 逐个目标检查
    let noteInjected = 0;
    for (const t of targetIndex) {
      if (t.path === note.path) continue;
      if (noteInjected >= maxPerNote) break;
      // 已有 [[B]] 跳过
      const tLower = t.title.toLowerCase();
      if (existingWikilinks.has(tLower)) {
        skipped++;
        continue;
      }
      // 标题含关键词检查(每个关键词扫一次,找到第一个匹配的位置)
      for (const kw of t.keywords) {
        if (matched.has(t.path)) break;
        // 在 note.content 里找 kw 第一次出现的位置(排除已经是 [[...]] 内部)
        const idx = findKeywordOutsideWikilink(note.content, kw);
        if (idx >= 0) {
          // 排除标题/路径区(避免污染 frontmatter)
          if (idx < 200 && note.content.slice(0, idx).includes('---')) continue;
          matched.add(t.path);
          const previewStart = Math.max(0, idx - 30);
          const previewEnd = Math.min(note.content.length, idx + kw.length + 30);
          const preview = note.content.slice(previewStart, previewEnd);
          candidates.push({
            sourcePath: note.path,
            targetPath: t.path,
            matchedKeyword: kw,
            insertOffset: idx,
            preview: preview,
          });
          noteInjected++;
          break;  // 每个目标只贡献一个候选
        }
      }
    }
  }

  console.log(`[auto-wikilinks] 找到 ${candidates.length} 个候选`);

  // 4) dryRun 就直接返回
  if (dryRun) {
    return {
      added: 0,
      candidates,
      skipped,
      dryRun: true,
      durationMs: Math.round(performance.now() - start),
    };
  }

  // 5) 实际写入 — 按 sourcePath 分组,合并到一次 update
  let added = 0;
  const bySource = new Map<string, AutoWikilinkCandidate[]>();
  for (const c of candidates) {
    if (!bySource.has(c.sourcePath)) bySource.set(c.sourcePath, []);
    bySource.get(c.sourcePath)!.push(c);
  }

  for (const [sourcePath, cands] of bySource) {
    const note = await db().notes.get(sourcePath);
    if (!note) continue;
    // 按 insertOffset 倒序插入(避免 offset 偏移)
    cands.sort((a, b) => b.insertOffset - a.insertOffset);
    let content = note.content;
    for (const c of cands) {
      // 在 idx 处把原 kw 替换为 marker + [[kw]] — marker 方便回滚
      const before = content.slice(0, c.insertOffset);
      const after = content.slice(c.insertOffset + c.matchedKeyword.length);
      // v1.32.0: 加 marker(HTML 注释,渲染时不可见,但能被正则识别)
      const marker = `<!--@leoliao:aw:${added}:${encodeURIComponent(c.targetPath)}-->`;
      const replacement = `${marker}[[${c.matchedKeyword}]]`;
      content = before + replacement + after;
      added++;
    }
    // 保存
    const newMtime = Date.now();
    await db().notes.put({
      ...note,
      content,
      mtime: newMtime,
    });
    // 同步触发 chunker 重切(让 graph-view 立即可见)
    try {
      const { saveChunks } = await import('./db');
      const { chunkDocument, chunkHash } = await import('./chunker');
      const chunks = chunkDocument(note.path, content, {
        mode: 'paragraph-only',
        forceChunkSize: 500,
      });
      await saveChunks(note.path, chunks.map(c => ({
        idx: c.idx,
        heading: c.heading,
        content: c.content,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        hash: chunkHash(c.content),
        mtime: newMtime,
      })));
    } catch (e) {
      console.warn('[auto-wikilinks] chunker 重切失败', sourcePath, e);
    }
  }

  console.log(`[auto-wikilinks] 实际注入 ${added} 条 wikilink`);

  return {
    added,
    candidates,
    skipped,
    dryRun: false,
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * 在 content 里找 kw 第一次出现的位置,且**不在**已有的 [[...]] 内部
 *
 * 算法:遍历所有 [[...]] 的范围,排除之;然后在剩余文本里找
 */
function findKeywordOutsideWikilink(content: string, kw: string): number {
  // 先标记所有 [[...]] 的范围
  const ranges: Array<[number, number]> = [];
  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  // 在 content 里找 kw 第一次出现
  const lowerContent = content.toLowerCase();
  const lowerKw = kw.toLowerCase();
  let pos = 0;
  while (true) {
    const idx = lowerContent.indexOf(lowerKw, pos);
    if (idx < 0) return -1;
    // 检查 idx 是否在某个 wikilink 范围内
    const inRange = ranges.some(([s, e]) => idx >= s && idx < e);
    if (!inRange) return idx;
    pos = idx + lowerKw.length;
  }
}

/**
 * v1.32.0: 回滚 — 删除所有由 autoInjectWikilinks 注入的 [[xxx]] 链接
 *
 * 策略:v1.32 起,所有注入的 [[xxx]] 前面都有 `<!--@leoliao:aw:{idx}:{targetPath}-->` 标记
 * 删除时:对每篇笔记,扫描所有 `<!--@leoliao:aw:N:...-->[[xxx]]` 模式,只删这种配对
 *
 * ⚠️ 用户手动写的 [[xxx]] **不会被删**(没标记)
 */
const AUTO_MARKER_RE = /<!--@leoliao:aw:(\d+):([^>]+?)-->\[\[([^\]\|]+?)(?:\|[^\]]*)?\]\]/g;

export async function revertAutoInjectedWikilinks(): Promise<{ removed: number; affectedNotes: number }> {
  const allNotes = await db().notes.toArray();
  let removed = 0;
  let affected = 0;
  for (const n of allNotes) {
    const original = n.content;
    const cleaned = original.replace(AUTO_MARKER_RE, (_m, _idx, _target, keyword) => {
      removed++;
      return keyword;
    });
    if (cleaned !== original) {
      affected++;
      await db().notes.put({
        ...n,
        content: cleaned,
        mtime: Date.now(),
      });
      // 同步触发 chunker 重切(让 graph 立刻看不到这些 wikilink)
      try {
        const { saveChunks } = await import('./db');
        const { chunkDocument, chunkHash } = await import('./chunker');
        const chunks = chunkDocument(n.path, cleaned, { mode: 'paragraph-only', forceChunkSize: 500 });
        await saveChunks(n.path, chunks.map(c => ({
          idx: c.idx,
          heading: c.heading,
          content: c.content,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          hash: chunkHash(c.content),
          mtime: Date.now(),
        })));
      } catch (e) {
        console.warn('[auto-wikilinks] chunker 重切失败', n.path, e);
      }
    }
  }
  return { removed, affectedNotes: affected };
}
