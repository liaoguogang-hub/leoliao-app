#!/usr/bin/env node
/**
 * md2html.mjs — 把 Leo 的 wiki markdown 转成 HTML
 *
 * 特性:
 * - 解析 frontmatter(--- 块)成 metadata
 * - Obsidian wikilink [[X]] → 锚点链接
 * - Obsidian callout > [!note] → 高亮框
 * - code block + table + list
 * - 单文件 HTML,样式内嵌(暗色主题,看像 Obsidian)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import MarkdownIt from 'markdown-it';

const files = process.argv.slice(2);
if (!files.length) {
  console.log('用法: node md2html.mjs file1.md [file2.md ...]');
  process.exit(1);
}

/** 极简 frontmatter 解析(避免 gray-matter 处理 wikilink 里的 `|` 报错) */
function extractFrontmatter(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { data: {}, body: text };
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  const data = {};
  for (const line of fmText.split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  if (data.tags) {
    data.tags = data.tags.split(',').map(s => s.trim()).filter(Boolean);
  }
  return { data, body };
}

const md = new MarkdownIt({
  html: true,
  linkify: false,           // 关掉自动 linkify,避免 [[X]] 被误判
  typographer: false,
  breaks: false,
});

// 1) Obsidian wikilink: [[X]] / [[X|alias]] / [[X#heading]]
//    用 push 放到最后,确保在其他规则后跑
md.inline.ruler.push('wikilink', (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5B) return false;
  if (state.src.charCodeAt(start + 1) === 0x21) return false;  // 跳过 ![[
  if (state.src.charCodeAt(start + 1) === 0x5B) return false;  // 跳过 [[
  const end = state.src.indexOf(']]', start + 2);
  if (end < 0) return false;
  const content = state.src.slice(start + 2, end);
  if (!content.trim()) return false;
  if (!silent) {
    const pipeIdx = content.indexOf('|');
    const target = (pipeIdx >= 0 ? content.slice(0, pipeIdx) : content).trim();
    const label = (pipeIdx >= 0 ? content.slice(pipeIdx + 1) : target).trim();
    const t = state.push('link_open', 'a', 1);
    t.attrs = [['href', '#' + target.replace(/[^\w一-龥]/g, '_')], ['class', 'wikilink']];
    const tx = state.push('text', '', 0);
    tx.content = label;
    state.push('link_close', 'a', -1);
  }
  state.pos = end + 2;
  return true;
});

// 2) Obsidian callout
md.block.ruler.before('blockquote', 'callout', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const line = state.src.slice(start, max);
  const m = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
  if (!m) return false;
  if (silent) return true;
  const type = m[1].toLowerCase();
  const first = m[2].trim();
  const open = new state.Token('callout_open', '', 0);
  open.attrSet('class', `callout callout-${type}`);
  open.block = true;
  const tokens = [open];
  if (first) {
    tokens.push(...state.md.parseInline(first, state.env));
  }
  let i = startLine + 1;
  while (i < endLine) {
    const s = state.bMarks[i] + state.tShift[i];
    const e = state.eMarks[i];
    const l = state.src.slice(s, e);
    const mm = l.match(/^>\s?(.*)$/);
    if (!mm) break;
    if (mm[1].trim()) {
      tokens.push(...state.md.parseInline(mm[1], state.env));
      tokens.push(new state.Token('softbreak', '', 0));
    }
    i++;
  }
  tokens.push(new state.Token('callout_close', '', 0));
  state.line = i;
  state.tokens.push(...tokens);
  return true;
});

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', monospace, sans-serif; background: #0a1a2a; color: #e8f0f5; line-height: 1.7; padding: 24px 16px; }
.container { max-width: 880px; margin: 0 auto; }
.frontmatter { background: #142a3e; border-left: 3px solid #00ffaa; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px; font-size: 13px; }
.frontmatter h2 { display: none; }
.frontmatter p { margin: 4px 0; color: #88aacc; }
.frontmatter strong { color: #00ffaa; margin-right: 8px; }
.frontmatter a { color: #88aacc; }
h1 { color: #00ffaa; font-size: 28px; margin: 24px 0 16px; border-bottom: 1px solid rgba(0,255,170,0.2); padding-bottom: 8px; }
h2 { color: #00ffaa; font-size: 22px; margin: 28px 0 12px; }
h3 { color: #88e0c0; font-size: 17px; margin: 20px 0 8px; }
h4 { color: #88e0c0; font-size: 15px; margin: 16px 0 6px; }
p { margin: 10px 0; }
ul, ol { padding-left: 28px; margin: 10px 0; }
li { margin: 4px 0; }
a { color: #00ffaa; text-decoration: underline; }
a.wikilink { color: #ffcc44; background: rgba(255,204,68,0.1); padding: 1px 4px; border-radius: 3px; text-decoration: none; }
code { background: #142a3e; padding: 1px 5px; border-radius: 3px; font-family: 'SF Mono', Menlo, monospace; font-size: 13px; color: #ffcc44; }
pre { background: #142a3e; border: 1px solid rgba(0,255,170,0.15); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0; }
pre code { background: transparent; padding: 0; color: #e8f0f5; }
blockquote { border-left: 3px solid #00ffaa; padding: 4px 12px; margin: 12px 0; color: #88aacc; }
hr { border: none; border-top: 1px solid rgba(0,255,170,0.15); margin: 20px 0; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
th, td { border: 1px solid rgba(0,255,170,0.2); padding: 6px 10px; text-align: left; }
th { background: #142a3e; color: #00ffaa; }
tr:nth-child(even) { background: rgba(255,255,255,0.02); }
.callout { border-left: 3px solid; padding: 8px 12px; margin: 12px 0; background: #142a3e; border-radius: 4px; }
.callout-note { border-color: #4488ff; }
.callout-warning, .callout-caution { border-color: #ffaa44; }
.callout-tip, .callout-hint { border-color: #88ff88; }
.callout-info { border-color: #00ffaa; }
.callout-danger { border-color: #ff4466; }
`;

// 把 [[X]] / [[X|Y]] 转成 markdown 标准链接 [Y](X),避免被 markdown-it 当 code/text 处理
function preprocessWikilinks(text) {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
    const pipeIdx = inner.indexOf('|');
    if (pipeIdx >= 0) {
      const target = inner.slice(0, pipeIdx).trim();
      const label = inner.slice(pipeIdx + 1).trim();
      return `[${label}](${target})`;
    }
    return `[${inner.trim()}](${inner.trim()})`;
  });
}

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const { body: content, data: fm } = extractFrontmatter(raw);
  // frontmatter 的链接也处理(但保留 key/value 形式,只把 [[X]] 转成 [X](X) 形式)
  const fmProcessed = JSON.stringify(fm).replace(/\\"path\\":\\"([^\\"]+)\\"/g, '"path":"$1"');
  const processed = preprocessWikilinks(content);
  const body = md.render(processed);
  const name = basename(f, '.md');

  // 渲染 frontmatter 成一个 meta 块
  const fmHtml = Object.keys(fm).length
    ? '<aside class="frontmatter">' + Object.entries(fm)
        .filter(([k]) => !['title','type','status','date','tags'].includes(k))
        .map(([k, v]) => {
          const s = Array.isArray(v) ? v.map(escapeHtml).join(' / ') : escapeHtml(v);
          // 把 [[X]] 替换成 <a> 形式
          const withLinks = s.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
            const pipeIdx = inner.indexOf('|');
            const target = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
            const label = (pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : target).trim();
            return `<a href="#${target.replace(/[^\w一-龥]/g, '_')}" class="wikilink">${label}</a>`;
          });
          return `<p><strong>${k}</strong> ${withLinks}</p>`;
        })
        .join('') + '</aside>'
    : '';

  // 提取 title
  const title = (typeof fm.title === 'string' ? fm.title : name).replace(/[<>]/g, '');

  // HTML 转义 helper
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">
${fmHtml}
${body}
<hr>
<p style="color:#88aacc;font-size:12px;text-align:center;margin-top:32px">
  LeoLiao 知识库 · 由 markdown-it 渲染 · 2026-07-07
</p>
</div>
</body>
</html>
`;

  const outPath = f.replace(/\.md$/, '.html');
  // 把 [X](Y) 形式的内部链接转成 wikilink 样式
  const finalHtml = html.replace(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g, (m, href, attrs, text) => {
    if (!/^https?:/.test(href) && !/\.[a-z]{2,4}$/i.test(href)) {
      return `<a href="#${href.replace(/[^\w一-龥]/g, '_')}" class="wikilink"${attrs}>${text}</a>`;
    }
    return m;
  });
  writeFileSync(outPath, finalHtml);
  console.log(`✓ ${f} → ${outPath} (${(finalHtml.length/1024).toFixed(1)} KB)`);
}