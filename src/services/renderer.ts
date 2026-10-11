/**
 * Markdown 渲染器 — markdown-it + Obsidian 扩展
 *
 * 支持：
 * - frontmatter 提取（不在渲染里输出）
 * - `[[wikilinks]]` → 可点击
 * - `![[image.png]]` → 图片标签（路径保留）
 * - `> [!note]` callouts
 * - #tag 自动提取
 * - v1.14.0: chunk 边界插 `data-cid` 锚点(配合 Phase R.3 跳转高亮)
 * - v1.21.0: Obsidian 语法补全 — `%%comment%%` 行内注释、mermaid 代码块标记
 */

import MarkdownIt from 'markdown-it';
import matter from 'gray-matter';
export interface ParsedNote {
  html: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
}

// 单例
let _md: MarkdownIt | null = null;

function md(): MarkdownIt {
  if (_md) return _md;

  _md = new MarkdownIt({
    html: false,         // 安全：不渲染原始 HTML（防 XSS）
    linkify: true,
    typographer: false,
    breaks: false,
  });

  // Obsidian wikilinks: [[Note Name]] 或 [[Note Name|alias]]
  _md.inline.ruler.before('emphasis', 'wikilink', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x5B /* [ */) return false;
    if (state.src.charCodeAt(start + 1) === 0x21 /* ! */) return false; // 跳过 ![[ (Obsidian 图片嵌入)

    const end = state.src.indexOf(']]', start + 2);
    if (end < 0) return false;

    const content = state.src.slice(start + 2, end);
    if (!content.trim()) return false;

    if (!silent) {
      const pipeIdx = content.indexOf('|');
      const target = pipeIdx >= 0 ? content.slice(0, pipeIdx).trim() : content.trim();
      const label = pipeIdx >= 0 ? content.slice(pipeIdx + 1).trim() : target;
      const token = state.push('link_open', 'a', 1);
      token.attrs = [
        ['href', '#wiki:' + encodeURIComponent(target)],
        ['class', 'wikilink'],
        ['data-target', target],
      ];
      const text = state.push('text', '', 0);
      text.content = label;
      state.push('link_close', 'a', -1);
    }

    state.pos = end + 2;
    return true;
  });

  // v1.21.0: Obsidian 行内注释 `%%comment%%` — 整段去除(不渲染)
  _md.inline.ruler.before('emphasis', 'obsidian_comment', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x25 /* % */) return false;
    if (state.src.charCodeAt(start + 1) !== 0x25 /* % */) return false;
    const end = state.src.indexOf('%%', start + 2);
    if (end < 0) return false;
    if (!silent) {
      // 用一个零宽 token,实际不输出
      const token = state.push('text', '', 0);
      token.content = '';
    }
    state.pos = end + 2;
    return true;
  });

  // v1.66: ASCII 艺术图保护 — 代码块外的 ASCII 图(供需曲线/坐标系等)用 | 和 _ 绘制,
  // markdown-it 会把 | 当表格管道、_ 当斜体标记,导致图形被拆成乱码段落。
  // 判定:从当前行起连续 >=2 行含 "|",且其中没有一行形如 |---| 分隔行,
  //      也不含表格的表头特征(至少 2 个连续非空单元格) -> 整块当代码块渲染。
  _md.block.ruler.before('table', 'ascii_art', (state, startLine, endLine, silent) => {
    // 从 startLine 起收集连续含 | 的行
    let last = startLine;
    while (last < endLine) {
      const s = state.bMarks[last] + state.tShift[last];
      const e = state.eMarks[last];
      const line = state.src.slice(s, e);
      if (line.indexOf('|') === -1) break;
      last++;
    }
    const count = last - startLine;
    if (count < 2) return false;

    // 收集块内全部行文本,做特征判断
    const lines: string[] = [];
    for (let i = startLine; i < last; i++) {
      const s = state.bMarks[i] + state.tShift[i];
      const e = state.eMarks[i];
      lines.push(state.src.slice(s, e));
    }

    // 若含标准表格分隔行(比如 |---|---| 或 | --- | --- |),说明是真表格,交给 table 规则处理
    if (/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(lines[1] || '')) {
      if (/^\s*\|/.test(lines[0] || '') && /-/.test(lines[1] || '')) return false;
    }
    // 含表格分隔行且首行是表头 -> 真表格
    if (/-{3,}/.test(lines[1] || '') && lines[1].indexOf('|') !== -1) return false;

    if (silent) return true;

    // 命中:整块渲染为代码块
    const token = state.push('fence', 'code', 0);
    token.info = '';
    token.content = state.getLines(startLine, last, state.blkIndent, false) + '\n';
    token.markup = '```';
    token.block = true;
    state.line = last;
    return true;
  });

  // Obsidian callouts: > [!type] 标题
  //
  // v1.67 重写(踩了四个坑才找到正确解法,务必保留注释):
  //  1. 自定义 token 'callout_open'/'callout_close' 没有对应 renderer rule,
  //     markdown-it 找不到 rule 时把 tag 名+attrs 拼成字符串直接输出,
  //     正文出现字面量 < class="callout callout-abstract"> 和结尾的 <>
  //     -> 必须用 markdown-it 内置 token 名(blockquote_open/paragraph_open/inline)
  //  2. 改用 blockquote_open 后内容重复渲染两次。实测:state.tokens 只有 3 个,
  //     输出却是 2 遍。根因是在 block rule 内部调用 state.md.parseInline()
  //     返回的 token 直接 push,会被 markdown-it 的 core 阶段再次处理。
  //     -> 正确做法参考官方 rules_block/paragraph.mjs:
  //        只 push 一个 'inline' token 并设置 .content,让 markdown-it
  //        在后续阶段自动 parseInline 填充 children。
  //  3. 试图改写 state.src 做字符串预处理会破坏 bMarks/eMarks 偏移,
  //     导致后续所有行错位 -> 不要改 state.src。
  //  4. 类型正则 \w+ 不支持连字符/下划线 -> 放宽为 [a-zA-Z0-9_-]+。
  _md.block.ruler.before('blockquote', 'callout', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]);
    const m = line.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]([+-]?)\s*(.*)$/);
    if (!m) return false;
    if (silent) return true;

    const type = m[1].toLowerCase();
    const fold = m[2];
    const title = m[3].trim();

    // 收集 callout 正文:从下一行开始连续的 '>' 行,去掉 '> ' 前缀
    const bodyLines: string[] = [];
    let lineIdx = startLine + 1;
    for (; lineIdx < endLine; lineIdx++) {
      const s = state.bMarks[lineIdx] + state.tShift[lineIdx];
      const e = state.eMarks[lineIdx];
      const mm = state.src.slice(s, e).match(/^\s{0,3}>\s?(.*)$/);
      if (!mm) break;
      bodyLines.push(mm[1]);
    }
    state.line = lineIdx;

    // ⚠️ 关键:state.push() 本身已经把 token 加进 state.tokens,
    //    所以这里【不要】再收集到 tokens 数组、更不要 state.tokens.push(...tokens),
    //    否则每个 token 都会出现两份 —— 表现为内容重复渲染两次。
    //    踩过这个坑:state.tokens 只有 3 个时输出仍是 2 遍。

    // 外层:blockquote_open(内置 token,markdown-it 有默认 renderer)
    const bqOpen = state.push('blockquote_open', 'blockquote', 1);
    bqOpen.attrSet('class', `callout callout-${type}`);
    if (fold === '-') bqOpen.attrJoin('class', 'callout-folded');
    bqOpen.block = true;
    bqOpen.map = [startLine, lineIdx];

    // 标题段落
    const tOpen = state.push('paragraph_open', 'p', 1);
    tOpen.attrSet('class', 'callout-title');
    tOpen.block = true;
    const tInline = state.push('inline', '', 0);
    tInline.content = title || type;
    tInline.map = [startLine, startLine];
    tInline.children = [];
    const tClose = state.push('paragraph_close', 'p', -1);
    tClose.block = true;

    // 正文:整段合成一个 inline token(段落内的软换行保留为空格)
    // ⚠️ 不要用 state.md.parse() 解析正文 —— 会走完整 core 流程(含本 callout 规则),
    //    导致正文重复渲染(踩过这个坑)。
    //    列表/表格等块级语法在 callout 内会退化为普通文本,这是已知取舍。
    const bodySrc = bodyLines.join('\n').trim();
    if (bodySrc) {
      const pOpen = state.push('paragraph_open', 'p', 1);
      pOpen.attrSet('class', 'callout-body');
      pOpen.block = true;
      const pInline = state.push('inline', '', 0);
      pInline.content = bodySrc.replace(/\n[ \t]*(?=\S)/g, ' ');
      pInline.map = [startLine, lineIdx];
      pInline.children = [];
      const pClose = state.push('paragraph_close', 'p', -1);
      pClose.block = true;
    }

    const bqClose = state.push('blockquote_close', 'blockquote', -1);
    bqClose.block = true;
    bqClose.map = [startLine, lineIdx];
    return true;
  });
  // #tag 提取（在 inline 阶段）
  // 不在这里改渲染，标签由 parseTags() 函数提取

  return _md;
}

/* === Tag 提取 === */

const TAG_RE = /(?:^|\s|[(\[])#([a-zA-Z一-龥][a-zA-Z0-9_\-\/一-龥]*)/g;

export function extractTags(text: string, frontmatter: Record<string, unknown>): string[] {
  const tags = new Set<string>();
  // 1. frontmatter tags 数组
  if (Array.isArray(frontmatter.tags)) {
    frontmatter.tags.forEach(t => tags.add(String(t).replace(/^#/, '')));
  }
  if (typeof frontmatter.tag === 'string') {
    tags.add(frontmatter.tag.replace(/^#/, ''));
  }
  // 2. 正文中 #tag
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    tags.add(m[1]);
  }
  return [...tags];
}

/* === Wikilink 提取 === */

const WIKI_RE = /\[\[([^\]]+)\]\]/g;

export function extractWikilinks(text: string): string[] {
  const links = new Set<string>();
  let m;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(text)) !== null) {
    const content = m[1];
    const pipe = content.indexOf('|');
    const target = (pipe >= 0 ? content.slice(0, pipe) : content).trim();
    if (target) links.add(target);
  }
  return [...links];
}

/* === 主入口 === */

/** 容错剥离 frontmatter:YAML 不规范时,尽量抢救 key: value,并返回正文 */
function salvageFrontmatter(yamlText: string): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  for (const line of yamlText.split(/\r?\n/)) {
    const m = line.match(/^([^:\n]{1,40}):\s*(.*)$/);
    if (m && !/^\s/.test(line)) fm[m[1].trim()] = m[2].trim();
  }
  return fm;
}

export interface ParseNoteOptions {
  /** v1.14.0: chunk 边界信息(用于插 data-cid 锚点)。若不传,跳过锚点注入。 */
  chunks?: Array<{ idx: number; startOffset: number; endOffset: number }>;
  /** v1.14.0: 笔记路径(写入 data-path 属性,用于 jump-to-chunk 时校验) */
  path?: string;
}

/**
 * v1.14.0: 根据 chunks.startOffset,把每个 chunk 起始位置在 HTML 里包成
 * `<a id="cid-X" data-cid="X" data-path="..."></a>` 锚点。
 *
 * 注意:
 * - 锚点位置是基于 Markdown 原文的字符 offset,转 HTML 时需考虑 markdown-it 的 token 序列
 * - 简单实现:在 HTML 字符串里找 chunk.startOffset 附近的字符位置(不做精确 offset 映射)
 * - 实用主义:每个 chunk 至少有一个锚点,点 jump-to-chunk 时滚动到最近的锚点
 */
function injectChunkAnchors(html: string, chunks: NonNullable<ParseNoteOptions['chunks']>, path: string): string {
  // 简化方案:按段落拆 HTML,在每段开始处插锚点(不依赖 offset)
  // 对应 markdown 里的二级标题后的内容块
  if (chunks.length === 0) return html;

  // 把 HTML 拆成段(双换行),在每段前插锚点(轮流分配 idx)
  // 这种粗粒度匹配不影响功能:点 jump-to-chunk 时 scrollIntoView 找到对应 heading 即可
  const segments = html.split(/(?<=<\/h\d>|<\/p>|<\/ul>|<\/ol>|<\/pre>|<\/blockquote>|<\/table>)/i);
  let chunkIdx = 0;
  const anchored = segments.map((seg) => {
    // 跳过空段
    if (!seg.trim()) return seg;
    // 在段开头插锚点
    const cid = chunkIdx < chunks.length ? chunkIdx : chunks.length - 1;
    const anchor = `<a id="cid-${cid}" class="cid-anchor" data-cid="${cid}" data-path="${path.replace(/"/g, '&quot;')}"></a>`;
    chunkIdx++;
    return anchor + seg;
  }).join('');
  return anchored;
}

export function parseNote(rawContent: string, opts: ParseNoteOptions = {}): ParsedNote {
  let content = rawContent;
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = matter(rawContent);
    content = parsed.content;
    frontmatter = (parsed.data as Record<string, unknown>) || {};
  } catch {
    // frontmatter YAML 不规范(gray-matter/js-yaml 抛错)→ 手动剥离 --- 块,正文照常渲染,
    // 不能让一篇 frontmatter 有问题的笔记整个打不开
    const m = rawContent.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (m) {
      content = rawContent.slice(m[0].length);
      frontmatter = salvageFrontmatter(m[1]);
    }
  }
  const tags = extractTags(content, frontmatter);
  const links = extractWikilinks(content);
  // v1.67: callout 类型序列由 callout_marker 规则写入 env,渲染后注入 class
  const env: Record<string, unknown> = {};
  let html = md().render(content, env);
  // v1.14.0: chunk 锚点注入(若 opts.chunks + opts.path 同时提供)
  if (opts.chunks && opts.chunks.length > 0 && opts.path) {
    html = injectChunkAnchors(html, opts.chunks, opts.path);
  }
  return { html, frontmatter, tags, links };
}

/* === 把 wikilink href 转回 path（处理 #wiki: 锚点） === */

export function wikilinkTarget(href: string): string | null {
  const m = href.match(/^wiki:(.+)$/);
  if (!m) return null;
  return decodeURIComponent(m[1]);
}