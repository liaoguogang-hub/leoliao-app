/**
 * Markdown 渲染器 — markdown-it + Obsidian 扩展
 *
 * 支持：
 * - frontmatter 提取（不在渲染里输出）
 * - `[[wikilinks]]` → 可点击
 * - `![[image.png]]` → 图片标签（路径保留）
 * - `> [!note]` callouts
 * - #tag 自动提取
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

  // Obsidian callouts: > [!note] 内容
  // markdown-it 默认 blockquote 渲染，我们拦截开头 [!type]
  _md.block.ruler.before('blockquote', 'callout', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max);
    const m = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (!m) return false;
    if (silent) return true;

    const type = m[1].toLowerCase();
    const firstLineText = m[2].trim();

    const tokens: any[] = [];
    const open = new state.Token('callout_open', '', 0);
    open.attrSet('class', `callout callout-${type}`);
    open.block = true;
    tokens.push(open);

    // 如果第一行有内容，作为段落开始
    if (firstLineText) {
      const inline = state.md.parseInline(firstLineText, state.env);
      tokens.push(...inline);
    }

    // 后续 > 行作为内容
    let lineIdx = startLine + 1;
    while (lineIdx < endLine) {
      const s = state.bMarks[lineIdx] + state.tShift[lineIdx];
      const e = state.eMarks[lineIdx];
      const l = state.src.slice(s, e);
      const mm = l.match(/^>\s?(.*)$/);
      if (!mm) break;
      if (mm[1].trim()) {
        const inline = state.md.parseInline(mm[1], state.env);
        tokens.push(...inline);
        const softbreak = new state.Token('softbreak', '', 0);
        tokens.push(softbreak);
      }
      lineIdx++;
    }

    const close = new state.Token('callout_close', '', 0);
    close.block = true;
    tokens.push(close);

    state.line = lineIdx;
    state.tokens.push(...tokens);
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

export function parseNote(rawContent: string): ParsedNote {
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
  const html = md().render(content);
  return { html, frontmatter, tags, links };
}

/* === 把 wikilink href 转回 path（处理 #wiki: 锚点） === */

export function wikilinkTarget(href: string): string | null {
  const m = href.match(/^wiki:(.+)$/);
  if (!m) return null;
  return decodeURIComponent(m[1]);
}