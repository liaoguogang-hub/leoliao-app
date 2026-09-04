/**
 * V44: 文档 chunk 切分引擎
 * v1.26.0: 加 paragraphOnly + forceChunkSize 选项 — 让无标题文本(前言/目录/EPUB 章节)能细切
 *
 * 策略(默认 mode='heading'):
 * - 按二级标题 (## ...) 切分(若没有则整个文档为 1 个 chunk)
 * - 每个 chunk 目标 500 字,超过则按段落再切
 * - 留 100 字 overlap 让跨段语义更连贯
 *
 * 策略(mode='paragraph-only'):v1.26.0 新增
 * - 完全按段落 + 字数切分,不依赖二级标题
 * - 适用于:前言/后记/目录/EPUB 单章节(无 # 标记)
 * - 每 ~forceChunkSize 字切一段
 *
 * 返回: { path, idx, heading, content, startOffset, endOffset }
 */

export interface Chunk {
  path: string;           // 所属笔记路径
  idx: number;            // chunk 在该笔记内的索引(0-based)
  heading: string;        // 所属二级标题(顶层则取笔记文件名)
  content: string;        // chunk 正文
  startOffset: number;    // 在原文档里的起始字符位置
  endOffset: number;      // 结束字符位置(不含)
}

export interface ChunkOptions {
  /** 切分模式:'heading'(默认) | 'paragraph-only'(v1.26) */
  mode?: 'heading' | 'paragraph-only';
  /** paragraph-only 模式下,每 ~forceChunkSize 字切一段(默认 400) */
  forceChunkSize?: number;
}

const OVERLAP_CHARS = 100;      // 跨段 overlap
const HARD_MAX = 800;           // 单 chunk 硬上限(实际目标 ~500-800 字)
const HARD_MIN = 100;            // 太短就合到上一 chunk
const DEFAULT_FORCE_CHUNK = 400; // v1.26.0: paragraph-only 模式默认 400 字一段

/** 主入口 */
export function chunkDocument(path: string, content: string, opts: ChunkOptions = {}): Chunk[] {
  const fileName = path.split('/').pop()?.replace(/\.md$/, '') || path;

  // v1.26.0: paragraph-only 模式 — 纯按段落 + 字数切
  if (opts.mode === 'paragraph-only') {
    return chunkParagraphOnly(path, content, fileName, opts.forceChunkSize ?? DEFAULT_FORCE_CHUNK);
  }

  // 默认 heading 模式
  const sections = splitByHeadings(content);
  const chunks: Chunk[] = [];
  let idx = 0;
  for (const sec of sections) {
    const heading = sec.heading || fileName;
    const pieces = splitByParagraph(sec.content, sec.startOffset);
    for (const p of pieces) {
      chunks.push({
        path,
        idx: idx++,
        heading,
        content: p.content,
        startOffset: p.startOffset,
        endOffset: p.endOffset,
      });
    }
  }
  return chunks;
}

/** v1.26.0: paragraph-only 模式 — 完全按段落 + 字数切, 不依赖 ## 标记
 *  算法:
 *  1. 按双换行(\n\n)拆成段落
 *  2. 累加段落,直到总字数 >= forceChunkSize 就切一个 chunk
 *  3. 边界硬切:超过 forceChunkSize * 1.5 还没遇到 \n\n,强制按字数切
 *  4. overlap 100 字(同 heading 模式)
 */
function chunkParagraphOnly(
  path: string,
  content: string,
  fileName: string,
  forceSize: number,
): Chunk[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // 按 \n\n 拆段
  const paragraphs: Array<{ text: string; startOffset: number }> = [];
  let pos = 0;
  const paraSep = /\n\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = paraSep.exec(trimmed)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    const text = trimmed.slice(pos, start).trim();
    if (text) {
      paragraphs.push({
        text,
        startOffset: content.indexOf(text, pos >= 0 ? pos : 0),
      });
    }
    pos = end;
  }
  // 最后一段
  const lastText = trimmed.slice(pos).trim();
  if (lastText) {
    paragraphs.push({
      text: lastText,
      startOffset: content.indexOf(lastText, Math.max(0, pos)),
    });
  }

  // 累加段落成 chunk
  const chunks: Chunk[] = [];
  let curText = '';
  let curStart = 0;
  let idx = 0;

  const flush = () => {
    if (curText.trim()) {
      chunks.push({
        path,
        idx: idx++,
        heading: `${fileName} #${idx}`,
        content: curText.trim(),
        startOffset: curStart,
        endOffset: curStart + curText.length,
      });
    }
  };

  for (const p of paragraphs) {
    // 单段就超过 1.5x — 强制按字数切
    if (p.text.length > forceSize * 1.5) {
      flush();
      // 按字数切这一段
      let subPos = 0;
      while (subPos < p.text.length) {
        const subEnd = Math.min(subPos + forceSize, p.text.length);
        const piece = p.text.slice(subPos, subEnd);
        chunks.push({
          path,
          idx: idx++,
          heading: `${fileName} #${idx}`,
          content: piece,
          startOffset: p.startOffset + subPos,
          endOffset: p.startOffset + subEnd,
        });
        if (subEnd >= p.text.length) break;
        subPos = Math.max(subEnd - OVERLAP_CHARS, subPos + 1);
      }
      curText = '';
      continue;
    }
    // 累加
    if (curText.length === 0) {
      curStart = p.startOffset;
      curText = p.text;
    } else {
      curText += '\n\n' + p.text;
    }
    // 满了就 flush
    if (curText.length >= forceSize) {
      flush();
      // overlap:留最后 ~100 字给下一 chunk
      const overlapText = curText.slice(-OVERLAP_CHARS);
      curText = overlapText;
      curStart = p.startOffset + p.text.length - overlapText.length;
    }
  }
  flush();
  return chunks;
}

/** 按二级标题 (## ) 切 — 顶层(无 ##)则整篇 1 个 section */
interface Section { heading: string; content: string; startOffset: number; }

function splitByHeadings(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let cur: Section | null = null;
  let lineStart = 0;

  for (const line of lines) {
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      // 切出新 section
      if (cur) {
        cur.content = content.slice(cur.startOffset, lineStart).trim();
        sections.push(cur);
      }
      cur = {
        heading: line.slice(3).trim(),
        content: '',
        startOffset: lineStart + line.length + 1,   // 标题行之后的下一行
      };
    }
    lineStart += line.length + 1;   // \n
  }
  if (cur) {
    cur.content = content.slice(cur.startOffset).trim();
    sections.push(cur);
  }
  if (sections.length === 0) {
    // 整篇 1 section
    sections.push({ heading: '', content: content.trim(), startOffset: 0 });
  }
  return sections;
}

interface Piece { content: string; startOffset: number; endOffset: number; }

/** 按段落切 — 目标 TARGET_CHARS,overlap OVERLAP_CHARS */
function splitByParagraph(text: string, baseOffset: number): Piece[] {
  const trimmed = text.trim();
  if (trimmed.length <= HARD_MAX) {
    return [{ content: trimmed, startOffset: baseOffset, endOffset: baseOffset + trimmed.length }];
  }
  // 找段落边界(双换行 / \n\n)
  const pieces: Piece[] = [];
  let pos = 0;
  while (pos < trimmed.length) {
    let end = Math.min(pos + HARD_MAX, trimmed.length);
    // 找最近的段落结束
    if (end < trimmed.length) {
      // 优先 \n\n
      const paraBreak = trimmed.lastIndexOf('\n\n', end);
      if (paraBreak > pos + HARD_MIN) end = paraBreak;
      else {
        // 次选单换行
        const lineBreak = trimmed.lastIndexOf('\n', end);
        if (lineBreak > pos + HARD_MIN) end = lineBreak;
      }
    }
    const piece = trimmed.slice(pos, end).trim();
    if (piece) {
      pieces.push({
        content: piece,
        startOffset: baseOffset + pos,
        endOffset: baseOffset + end,
      });
    }
    if (end >= trimmed.length) break;
    pos = Math.max(end - OVERLAP_CHARS, pos + 1);
  }
  return pieces;
}

/** 计算 hash(同 note-view 编辑时的 djb2) */
export function chunkHash(s: string): string {
  const enc = new TextEncoder().encode(s);
  let h = 5381;
  for (let i = 0; i < enc.length; i++) h = ((h << 5) + h + enc[i]) | 0;
  return (h >>> 0).toString(36);
}
