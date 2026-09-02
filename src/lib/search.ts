/**
 * V44: BM25 检索 — 对 Dexie chunks 表打分
 *
 * 跟 v1.x 不同:
 * - 检索粒度从整篇文档 → chunk(~500 字)
 * - 返回结果含 heading(所属二级标题)
 * - 支持 paths 过滤(多 KB / 文件夹范围选择)
 * - 1200+ chunks 规模 BM25 足够快(<50ms),不需要上向量
 */

import { db } from '../services/db';
import { embedText, topKByVector, rrfFuse } from '../services/embedder';
import {
  loadAllChunkVectors, totalChunkVectors, saveChunkVectors,
  type ChunkVectorRow,
} from '../services/db';

export type SearchMode = 'bm25' | 'vector' | 'hybrid';

export interface SearchResult {
  path: string;             // 所属笔记路径
  idx: number;              // chunk 在笔记内的索引
  heading: string;          // 所属二级标题
  title: string;            // 笔记标题(从 path 提取)
  snippet: string;          // 含 query token 的上下文片段
  score: number;            // BM25 分数
  mtime: number;
}

const K1 = 1.5;
const B = 0.75;
const AVG_LEN_GUESS = 300;     // chunk 平均约 300 字
const SNIPPET_RADIUS = 100;

// 中英常见停用词
const STOP = new Set([
  '的', '了', '是', '在', '和', '与', '或', '及', '等', '为', '我', '你', '他', '她', '它',
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'and', 'or', 'but', 'in', 'on',
  'at', 'to', 'for', 'of', 'with', 'by', 'as', 'this', 'that', 'these', 'those', 'it', 'its',
]);

function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const enMatches = text.toLowerCase().match(/[a-z0-9_]+/g);
  if (enMatches) {
    for (const m of enMatches) {
      if (m.length > 1 && !STOP.has(m)) out.push(m);
    }
  }
  const cnChars = text.match(/[一-鿿]+/g);
  if (cnChars) {
    for (const seg of cnChars) {
      const chars = [...seg];
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (!STOP.has(c)) out.push(c);
      }
      for (let i = 0; i < chars.length - 1; i++) {
        const bg = chars[i] + chars[i + 1];
        if (!STOP.has(chars[i]) && !STOP.has(chars[i + 1])) out.push(bg);
      }
    }
  }
  return out;
}

function titleFromPath(path: string): string {
  const last = path.split('/').pop() || path;
  return last.replace(/\.md$/i, '');
}

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
  let s = content.slice(0, SNIPPET_RADIUS * 2).replace(/\s+/g, ' ');
  if (content.length > SNIPPET_RADIUS * 2) s += '...';
  return s;
}

/**
 * 主入口 — V49: 混合检索(BM25 + 向量 + RRF 融合 + 本地文件支持)
 *
 * @param query  查询字符串
 * @param k      最大返回条数(默认 9999 = 全召回)
 * @param maxChars 字符数安全阀(默认 30000 字 ≈ 10K tokens)
 * @param paths  可选 — 限定检索范围(文件夹前缀列表,空=全部 vault)
 * @param mode   检索模式:'bm25' | 'vector' | 'hybrid'(默认 hybrid)
 * @param includeLocal 是否包含本地文件(PDF 等,默认 false = 仅 vault)
 */
export async function search(
  query: string,
  k = 9999,
  maxChars = 30000,
  paths: string[] = [],
  mode: SearchMode = 'hybrid',
  includeLocal = false
): Promise<SearchResult[]> {
  // 过滤掉 📕 本地文件路径(除非 includeLocal=true)
  const effectivePaths = includeLocal
    ? paths
    : paths.filter(p => !p.startsWith('📕'));
  if (mode === 'bm25') return searchBM25(query, k, maxChars, effectivePaths);
  if (mode === 'vector') return searchVector(query, k, maxChars, effectivePaths);
  return searchHybrid(query, k, maxChars, effectivePaths);
}

/** V48: BM25 单跑 */
async function searchBM25(query: string, k: number, maxChars: number, paths: string[]): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const qTokens = tokenize(q);
  if (qTokens.length === 0) return [];

  // 拉所有 chunks
  let allChunks = await db().chunks.toArray();
  if (allChunks.length === 0) return [];
  // paths 过滤
  if (paths.length > 0) {
    allChunks = allChunks.filter(c =>
      paths.some(p => c.path === p || c.path.startsWith(p + '/'))
    );
  }
  if (allChunks.length === 0) return [];

  // 1) doc freq
  const df = new Map<string, number>();
  for (const c of allChunks) {
    const seen = new Set(tokenize(c.content));
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = allChunks.length;

  // 2) IDF
  const idf = new Map<string, number>();
  for (const [t, c] of df) {
    idf.set(t, Math.log(1 + (N - c + 0.5) / (c + 0.5)));
  }

  // 3) 打分
  const results: SearchResult[] = [];
  for (const c of allChunks) {
    const tokens = tokenize(c.content);
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
        path: c.path,
        idx: c.idx,
        heading: c.heading,
        title: titleFromPath(c.path),
        snippet: extractSnippet(c.content, qTokens),
        score,
        mtime: c.mtime,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);

  // 4) 字符数安全阀
  let totalChars = 0;
  const limited: SearchResult[] = [];
  for (const r of results) {
    if (limited.length >= k) break;
    const rChars = r.snippet.length + + r.title.length + r.path.length + r.heading.length + 50;
    if (limited.length > 0 && totalChars + rChars > maxChars) break;
    limited.push(r);
    totalChars += rChars;
  }
  return limited;
}

/** V48: 向量检索(query → cosine sim top-K) */
async function searchVector(query: string, k: number, maxChars: number, paths: string[]): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const allVecs = await loadAllChunkVectors();
  if (allVecs.length === 0) {
    console.warn('[search] no vectors, fallback to BM25');
    return searchBM25(query, k, maxChars, paths);
  }
  // paths 过滤
  const filtered = paths.length > 0
    ? allVecs.filter(v => paths.some(p => v.path === p || v.path.startsWith(p + '/')))
    : allVecs;
  if (filtered.length === 0) return [];

  const qVec = embedText(q);
  // 准备候选 (查 chunks 表拿 heading/mtime)
  const allChunks = await db().chunks.toArray();
  const chunkMap = new Map<string, typeof allChunks[0]>();
  for (const c of allChunks) chunkMap.set(`${c.path}#${c.idx}`, c);

  const candidates = filtered.map(v => ({ path: v.path, idx: v.idx, vec: v.vec }));
  const top = topKByVector(qVec, candidates, k);
  const results: SearchResult[] = [];
  let totalChars = 0;
  for (const r of top) {
    const chunk = chunkMap.get(`${r.path}#${r.idx}`);
    if (!chunk) continue;
    const snippet = chunk.content.length > 300 ? chunk.content.slice(0, 300) + '...' : chunk.content;
    const rChars = snippet.length + chunk.heading.length + r.path.length + 50;
    if (results.length > 0 && totalChars + rChars > maxChars) break;
    results.push({
      path: r.path,
      idx: r.idx,
      heading: chunk.heading,
      title: titleFromPath(r.path),
      snippet,
      score: r.score,
      mtime: chunk.mtime,
    });
    totalChars += rChars;
  }
  return results;
}

/** V48: 混合检索 — BM25 top50 + 向量 top50 → RRF 融合 */
async function searchHybrid(query: string, k: number, maxChars: number, paths: string[]): Promise<SearchResult[]> {
  const [bm25Top, vecTop] = await Promise.all([
    searchBM25(query, 50, maxChars * 2, paths),
    searchVector(query, 50, maxChars * 2, paths),
  ]);
  // 转成 (path, idx, score) 形式供 RRF
  const bm25Items = bm25Top.map(r => ({ path: r.path, idx: r.idx, score: r.score, fullResult: r }));
  const vecItems = vecTop.map(r => ({ path: r.path, idx: r.idx, score: r.score, fullResult: r }));
  const fused = rrfFuse(bm25Items, vecItems, 60);
  // 取回完整结果(优先 bm25,其次 vector)
  const out: SearchResult[] = [];
  let totalChars = 0;
  for (const f of fused.slice(0, k)) {
    const src = (f as any).a?.fullResult || (f as any).b?.fullResult;
    if (!src) continue;
    const rChars = src.snippet.length + src.title.length + src.path.length + src.heading.length + 50;
    if (out.length > 0 && totalChars + rChars > maxChars) break;
    out.push({ ...src, score: f.rrfScore });
    totalChars += rChars;
  }
  return out;
}

/** V48: 把所有 chunks → 批量 embed → 写入 chunkVectors */
export async function buildVectorIndex(onProgress?: (done: number, total: number) => void): Promise<{ indexed: number; total: number }> {
  const allChunks = await db().chunks.toArray();
  const existing = await loadAllChunkVectors();
  const existMap = new Map<string, ChunkVectorRow>();
  for (const v of existing) existMap.set(`${v.path}#${v.idx}`, v);
  let indexed = 0;
  const total = allChunks.length;
  const BATCH = 50;
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    const rows = batch.map(c => {
      const vec = embedText(c.content);
      return { path: c.path, idx: c.idx, vec, dim: vec.length, hash: c.hash, mtime: c.mtime };
    });
    await saveChunkVectors(batch[0].path, rows);
    indexed += batch.length;
    if (onProgress) onProgress(indexed, total);
  }
  return { indexed, total };
}

/** V48: 索引状态 */
export async function vectorIndexStatus(): Promise<{ total: number; chunks: number }> {
  const total = await totalChunkVectors();
  const chunks = await db().chunks.count();
  return { total, chunks };
}

/** 把检索结果组装成 RAG 用的 system + user prompt(V44:含 heading 上下文) */
export function buildRAGPrompt(query: string, results: SearchResult[]): { system: string; user: string } {
  if (results.length === 0) {
    return {
      system: '你是 LeoLiao 知识库助手。',
      user: `【问题】\n${query}\n\n【知识库检索结果】\n（无 — 知识库内未找到相关内容）`,
    };
  }
  const ctx = results
    .map((r, i) => {
      const snip = r.snippet.length > 600 ? r.snippet.slice(0, 600) + '...' : r.snippet;
      return `[#${i + 1}] 笔记: ${r.title}\n路径: ${r.path}\n小节: ${r.heading}\n内容: ${snip}`;
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

/** V44: KB+Web 全量 RAG prompt */
export function buildFullRAGPrompt(
  query: string,
  kbResults: SearchResult[],
  webResults: Array<{ title: string; url: string; content: string }>
): { system: string; user: string } {
  const parts: string[] = [];
  if (kbResults.length > 0) {
    parts.push('## 知识库检索结果（本地笔记 chunks）');
    parts.push(
      kbResults.map((r, i) => {
        const snip = r.snippet.length > 600 ? r.snippet.slice(0, 600) + '...' : r.snippet;
        return `[KB#${i + 1}] 笔记: ${r.title}\n路径: ${r.path}\n小节: ${r.heading}\n内容: ${snip}`;
      }).join('\n\n---\n\n')
    );
  }
  if (webResults.length > 0) {
    parts.push('## 联网搜索结果');
    parts.push(
      webResults.map((r, i) => {
        const snip = r.content.length > 600 ? r.content.slice(0, 600) + '...' : r.content;
        return `[Web#${i + 1}] 标题: ${r.title}\nURL: ${r.url}\n摘要: ${snip}`;
      }).join('\n\n---\n\n')
    );
  }

  const sourcesDesc: string[] = [];
  if (kbResults.length > 0) sourcesDesc.push('本地知识库 [KB#1] [KB#2]...');
  if (webResults.length > 0) sourcesDesc.push('联网 [Web#1] [Web#2]...');

  if (kbResults.length === 0 && webResults.length === 0) {
    return {
      system: '直接回答用户问题。不要模拟 KB 检索、网页搜索或任何检索过程。' +
              '不要使用 [KB#1]、[Web#1]、[1]、[2] 等引用标签。' +
              '不要输出"Let me check..."、"Looking at..."、"检索结果"等中间思考过程。' +
              '直接给出最终答案。',
      user: query,
    };
  }

  const system = `你是 LeoLiao 知识库助手。基于下面检索结果回答用户问题。
规则:
1. 优先使用检索结果回答（${sourcesDesc.join(' / ')}）
2. 如果所有检索结果都不含答案,明确说"未找到相关信息",不要编造
3. 回答末尾用"参考来源: [KB#1] [Web#2]..."格式列出引用
4. 简洁,1-3 段,不要长篇大论
5. 用户用中文就回中文,英文就回英文`;

  const user = `【问题】\n${query}\n\n${parts.join('\n\n')}`;

  return { system, user };
}