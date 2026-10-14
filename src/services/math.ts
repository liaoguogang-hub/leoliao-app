/**
 * v1.69: LaTeX 数学公式渲染(KaTeX)
 *
 * 背景: 知识库里有大量 Obsidian/Obsidian-Math 写法的公式,例如
 *   $$E_s = \frac{\text{供给量变化 \%}}{\text{价格变化 \%}}$$
 *   $MRS = \frac{\Delta B}{\Delta A}$
 * 之前项目没有任何数学渲染库,$$ 原样当文本输出,手机上完全没法读。
 *
 * 支持的定界符:
 *   块级: $$...$$(可跨行)   \[...\]
 *   行内: $...$              \(...\)
 *
 * 版本注记: **必须注册 renderer.rules**。踩过的坑 —— 自定义 token 类型
 * ('math_inline'/'math_block')如果忘了注册渲染规则,markdown-it 找不到
 * rule 时会把 tag 名和 attrs 拼成字符串直接输出(表现为正文里出现
 * 字面量 <math class="...">),这是 callout 那次同样的失败模式。
 */
import katex from 'katex';

/** HTML 转义(公式语法错误时原样回显用) */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 渲染单个公式;语法错误不抛异常,回显红色源码,不让整篇笔记打不开 */
function renderTex(tex: string, displayMode: boolean): string {
  const src = tex.trim();
  if (!src) return '';
  try {
    return katex.renderToString(src, {
      displayMode,
      throwOnError: false,   // 语法错误渲染成红色文本而非抛错
      errorColor: '#cc0000',
      strict: false,         // 允许中文等非 ASCII 出现在 \text{}
      trust: false,          // 不放行 \htmlClass 等危险命令
    });
  } catch (e) {
    return `<code class="math-error" title="${escapeHtml(String(e))}">${escapeHtml(src)}</code>`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mathPlugin(md: any): void {
  /* ---------------- 块级: $$ ... $$ ---------------- */
  // 放在 table 之前:公式里可能出现 |x| 这种竖线,避免被表格规则抢走
  md.block.ruler.before('table', 'math_block', (
    state: any, startLine: number, endLine: number, silent: boolean,
  ) => {
    // 缩进 >= 4 空格交给 code 规则(缩进代码块)
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;

    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const first = state.src.slice(pos, max);

    const open = first.match(/^\s*(\$\$|\\\[)/);
    if (!open) return false;
    if (silent) return true;

    const marker = open[1];
    const closer = marker === '$$' ? '$$' : '\\]';
    const rest = first.slice(first.indexOf(marker) + marker.length);

    let content: string;
    let nextLine: number;

    const closeIdx = rest.indexOf(closer);
    if (closeIdx >= 0) {
      // 单行闭合: $$...$$
      content = rest.slice(0, closeIdx);
      nextLine = startLine + 1;
    } else {
      const buf: string[] = [];
      if (rest.trim()) buf.push(rest);
      let i = startLine + 1;
      for (; i < endLine; i++) {
        const s = state.bMarks[i] + state.tShift[i];
        const e = state.eMarks[i];
        const l = state.src.slice(s, e);
        const ci = l.indexOf(closer);
        if (ci >= 0) {
          buf.push(l.slice(0, ci));
          break;
        }
        buf.push(l);
      }
      content = buf.join('\n');
      nextLine = i < endLine ? i + 1 : endLine;
    }

    // state.push 已经把它加进 state.tokens,不要再 tokens.push(...) 造成双份
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.markup = marker;
    token.content = content.trim();
    token.map = [startLine, nextLine];
    state.line = nextLine;
    return true;
  });

  /* ---------------- 行内: $ ... $ 与 \( ... \) ---------------- */
  md.inline.ruler.before('escape', 'math_inline', (
    state: any, silent: boolean,
  ) => {
    const src: string = state.src;
    const pos: number = state.pos;
    const c0 = src.charCodeAt(pos);

    let openLen: number;
    let closer: string;

    if (c0 === 0x24 /* $ */) {
      // $$ 交给块级规则
      if (src.charCodeAt(pos + 1) === 0x24) return false;
      // 转义 \$
      if (pos > 0 && src.charCodeAt(pos - 1) === 0x5C) return false;
      openLen = 1;
      closer = '$';
    } else if (c0 === 0x5C /* \ */ && src.charCodeAt(pos + 1) === 0x28 /* ( */) {
      openLen = 2;
      closer = '\\)';
    } else {
      return false;
    }

    // Obsidian 规则:开头 $ 之后不能是空白 —— 否则 "$ 5 万" 这类会被误判成公式
    const after = src.charCodeAt(pos + openLen);
    if (after === 0x20 || after === 0x09 || after === 0x0A) return false;

    // 找闭合符
    let i = pos + openLen;
    let found = -1;
    while (i < src.length) {
      const c = src.charCodeAt(i);
      if (c === 0x0A) break;                       // 行内公式不跨行
      if (c === 0x5C) {                            // 跳过 \( 这类转义
        if (closer === '$') { i += 2; continue; }
      }
      if (closer === '$' && c === 0x24) {
        const prev = src.charCodeAt(i - 1);
        // 闭合 $ 前不能是空白(否则 "$5 和 $10" 会被误判)
        if (prev === 0x20 || prev === 0x09) { i++; continue; }
        // 闭合 $ 后不能紧跟数字(同上)
        const next = src.charCodeAt(i + 1);
        if (next >= 0x30 && next <= 0x39) { i++; continue; }
        found = i;
        break;
      }
      if (closer === '\\)' && c === 0x5C && src.charCodeAt(i + 1) === 0x29 /* ) */) {
        found = i;
        break;
      }
      i++;
    }
    if (found < 0) return false;

    const content = src.slice(pos + openLen, found);
    if (!content.trim()) return false;
    if (silent) return true;

    const token = state.push('math_inline', 'math', 0);
    token.markup = closer === '$' ? '$' : '\\(';
    token.content = content;
    state.pos = found + closer.length;
    return true;
  });

  /* ---------------- 渲染规则(必须注册,否则输出字面量!) ---------------- */
  md.renderer.rules.math_inline = (tokens: any[], idx: number) => {
    return renderTex(tokens[idx].content, false);
  };
  md.renderer.rules.math_block = (tokens: any[], idx: number) => {
    return `<div class="math-block">${renderTex(tokens[idx].content, true)}</div>\n`;
  };
}
