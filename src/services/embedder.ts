/**
 * V48: Embedding 引擎（轻量级 + 框架完整）
 *
 * 设计:
 * - 用 char n-gram + hashing trick 把文本映射成 256 维向量
 * - 0 网络依赖、0 大模型下载、0 启动成本
 * - cosine 相似度检索,在 webview 跑 <10ms / 1000 chunks
 *
 * v1.9 升级路径:
 * - 把 embedOne(text) 换成 @xenova/transformers pipeline('Xenova/bge-small-zh-v1.5')
 * - 框架(chunkVectors 表 / RRF / search.ts)不变
 */

const VEC_DIM = 256;            // 向量维度
const NGRAM_MIN = 2;             // char n-gram 最小
const NGRAM_MAX = 4;             // char n-gram 最大

/** 把文本 hash 到 VEC_DIM 维向量(归一化) */
export function embedText(text: string): Float32Array {
  const vec = new Float32Array(VEC_DIM);
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return vec;
  // char n-gram
  for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
    for (let i = 0; i <= t.length - n; i++) {
      const gram = t.slice(i, i + n);
      const h = hashString(gram);
      const idx = Math.abs(h % VEC_DIM);
      vec[idx] += 1;
    }
  }
  // 归一化(L2 norm)
  let sum = 0;
  for (let i = 0; i < VEC_DIM; i++) sum += vec[i] * vec[i];
  if (sum > 0) {
    const norm = Math.sqrt(sum);
    for (let i = 0; i < VEC_DIM; i++) vec[i] /= norm;
  }
  return vec;
}

/** djb2 hash → 32 位整数 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** cosine 相似度 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;   // 已归一化,dot 即 cos sim
}

/** 查询 top-K 向量最相似的 chunk
 * @param queryVec 查询向量
 * @param candidates [{path, idx, vec}, ...] 待检索的向量集合
 * @param k topK
 */
export function topKByVector(
  queryVec: Float32Array,
  candidates: Array<{ path: string; idx: number; vec: Float32Array }>,
  k: number
): Array<{ path: string; idx: number; score: number }> {
  const scored = candidates.map(c => ({
    path: c.path,
    idx: c.idx,
    score: cosineSimilarity(queryVec, c.vec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** RRF (Reciprocal Rank Fusion) 融合两个排序列表 */
export function rrfFuse<T extends { score?: number }>(
  listA: Array<{ path: string; idx: number } & T>,
  listB: Array<{ path: string; idx: number } & T>,
  k: number = 60
): Array<{ path: string; idx: number; rrfScore: number; a?: T; b?: T }> {
  const map = new Map<string, { path: string; idx: number; rrfScore: number; a?: T; b?: T }>();
  listA.forEach((item, rank) => {
    const key = `${item.path}#${item.idx}`;
    const score = 1 / (k + rank + 1);
    if (!map.has(key)) map.set(key, { path: item.path, idx: item.idx, rrfScore: 0, a: item });
    map.get(key)!.rrfScore += score;
  });
  listB.forEach((item, rank) => {
    const key = `${item.path}#${item.idx}`;
    const score = 1 / (k + rank + 1);
    if (!map.has(key)) map.set(key, { path: item.path, idx: item.idx, rrfScore: 0, b: item });
    map.get(key)!.rrfScore += score;
  });
  return Array.from(map.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}