/**
 * V44: 文档 chunk 切分引擎
 *
 * 策略:
 * - 按二级标题 (## ...) 切分(若没有则整个文档为 1 个 chunk)
 * - 每个 chunk 目标 500 字,超过则按段落再切
 * - 留 100 字 overlap 让跨段语义更连贯
 * - 返回: { path, idx, heading, content, startOffset, endOffset }
 */

export interface Chunk {
  path: string;           // 所属笔记路径
  idx: number;            // chunk 在该笔记内的索引(0-based)
  heading: string;        // 所属二级标题(顶层则取笔记文件名)
  content: string;        // chunk 正文
  startOffset: number;    // 在原文档里的起始字符位置
  endOffset: number;      // 结束字符位置(不含)
}

const OVERLAP_CHARS = 100;      // 跨段 overlap
const HARD_MAX = 800;           // 单 chunk 硬上限(实际目标 ~500-800 字)
const HARD_MIN = 100;            // 太短就合到上一 chunk

/** 主入口:按二级标题 + 段落切分一篇 md 文档 */
export function chunkDocument(path: string, content: string): Chunk[] {
  const fileName = path.split('/').pop()?.replace(/\.md$/, '') || path;
  const sections = splitByHeadings(content);   // 按 ## 切
  const chunks: Chunk[] = [];
  let idx = 0;
  for (const sec of sections) {
    const heading = sec.heading || fileName;
    // 一段可能超长,按段落再切
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