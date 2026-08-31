/**
 * BM25 检索 — 对本地 Dexie notes 表全文打分
 *
 * 1216 篇规模下 BM25 足够快（<50ms），不需要上向量数据库
 * 后续若 KB 突破 10k+ 篇，再换成 embedding 索引
 */

import { db } from '../services/db';

export interface SearchResult {
  path: string;             // vault 路径
  title: string;            // 提取的标题（第一行 # 或文件名）
  snippet: string;          // 含 query token 的上下文片段
  score: number;            // BM25 分数
  mtime: number;
}

const K1 = 1.5;             // BM25 词频饱和参数
const B = 0.75;             // 文档长度归一化参数
const AVG_LEN_GUESS = 300;   // 1216 篇平均约 300 tokens（不强求精确，BM25 对此不敏感）
const SNIPPET_RADIUS = 80;  // 片段前后字符数

// 中英常见停用词（小集合，避免召回噪音；常见 RAG 列表可后续扩）
const STOP = new Set([
  '的', '了', '是', '在', '和', '与', '或', '及', '等', '为', '我', '你', '他', '她', '它',
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'and', 'or', 'but', 'in', 'on',
  'at', 'to', 'for', 'of', 'with', 'by', 'as', 'this', 'that', 'these', 'those', 'it', 'its',
]);

/** 中英混合分词：英文按 \w+；中文按字。简单够用 */
function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // 英文/数字
  const enMatches = text.toLowerCase().match(/[a-z0-9_]+/g);
  if (enMatches) {
    for (const m of enMatches) {
      if (m.length > 1 && !STOP.has(m)) out.push(m);
    }
  }
  // 中文：单字 + 简单二元组
  const cnChars = text.match(/[一-鿿]+/g);
  if (cnChars) {
    for (const seg of cnChars) {
      const chars = [...seg];
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (!STOP.has(c)) out.push(c);
      }
      // 二元组：捕获常见双字词
      for (let i = 0; i < chars.length - 1; i++) {
        const bg = chars[i] + chars[i + 1];
        if (!STOP.has(chars[i]) && !STOP.has(chars[i + 1])) out.push(bg);
      }
    }
  }
  return out;
}

/** 提取标题：第一行 # 开头，没有就用文件名 */
function extractTitle(path: string, content: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const name = path.split('/').pop() || path;
  return name.replace(/\.md$/i, '');
}

/** 提取片段：第一个包含 query token 的窗口 */
function extractSnippet(content: string, qTokens: string[]): string {
  const lower = content.toLowerCase();
  for (const qt of qTokens) {
    const idx = lower.indexOf(qt);
    if (idx >= 0) {
      const start = Math.max(0, idx - SNIPPET_RADIUS);
      const end = Math.min(content.length, idx + qt.length + SNIPPET_RADIUS);
      let snippet = content.slice(start, end).replace(/\s+/g, ' ');
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      return snippet;
    }
  }
  // fallback: 取前 SNIPPET_RADIUS*2 字符
  let s = content.slice(0, SNIPPET_RADIUS * 2).replace(/\s+/g, ' ');
  if (content.length > SNIPPET_RADIUS * 2) s += '...';
  return s;
}

/** 主入口：对所有缓存笔记跑 BM25，返回 top-K */
export async function search(query: string, k = 5): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const qTokens = tokenize(q);
  if (qTokens.length === 0) return [];

  // 拉所有缓存的笔记（一次性，1216 篇没问题；10k+ 再考虑分批）
  const allNotes = await db().notes.toArray();
  if (allNotes.length === 0) return [];

  // 1) 计算每个 token 的 doc freq
  const df = new Map<string, number>();
  for (const note of allNotes) {
    const seen = new Set(tokenize(note.content));
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = allNotes.length;

  // 2) 计算 IDF（BM25+1 平滑）
  const idf = new Map<string, number>();
  for (const [t, c] of df) {
    idf.set(t, Math.log(1 + (N - c + 0.5) / (c + 0.5)));
  }

  // 3) 对每篇文档打分
  const results: SearchResult[] = [];
  for (const note of allNotes) {
    const tokens = tokenize(note.content);
    const docLen = tokens.length;
    if (docLen === 0) continue;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt) || 0;
      if (f === 0) continue;
      const w = idf.get(qt) || 0;
      const norm = f * (K1 + 1) / (f + K1 * (1 - B + B * docLen / AVG_LEN_GUESS));
      score += w * norm;
    }
    if (score > 0) {
      results.push({
        path: note.path,
        title: extractTitle(note.path, note.content),
        snippet: extractSnippet(note.content, qTokens),
        score,
        mtime: note.mtime,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

/** 把检索结果组装成 RAG 用的 system + user prompt */
export function buildRAGPrompt(query: string, results: SearchResult[]): { system: string; user: string } {
  if (results.length === 0) {
    return {
      system: '你是 LeoLiao 知识库助手。',
      user: `【问题】\n${query}\n\n【知识库检索结果】\n（无 — 知识库内未找到相关内容）`,
    };
  }
  const ctx = results
    .map((r, i) => {
      // 控制上下文长度：每个 snippet 最长 600 字符
      const snip = r.snippet.length > 600 ? r.snippet.slice(0, 600) + '...' : r.snippet;
      return `[#${i + 1}] 标题: ${r.title}\n路径: ${r.path}\n内容: ${snip}`;
    })
    .join('\n\n---\n\n');

  const system = `你是 LeoLiao 知识库助手。基于下面【知识库检索结果】回答用户问题。
规则:
1. 优先使用 [#1][#2]... 引用的内容回答
2. 如果检索结果不包含答案,明确说"知识库内未找到相关信息",不要编造
3. 回答末尾用"参考来源: [[#1]] [[#2]]..."格式列出引用
4. 简洁,1-3 段,不要长篇大论
5. 用户用中文就回中文,英文就回英文`;

  const user = `【问题】\n${query}\n\n【知识库检索结果】\n${ctx}`;

  return { system, user };
}