/**
 * v1.12.0 Phase R.1 — 检索结果 Rerank 引擎
 * v1.12.2 Phase R.1.2 — 加 LRU 缓存层 + 权重常量集中
 *
 * 设计目标:
 * - 在 BM25 + 向量 RRF 融合之后,送 LLM 之前,加一道二次精排
 * - 召回率(Recall) 和 准确率(Precision) 同时拉高
 *
 * 实现策略(三档降级,首档失败自动 fallback):
 *   Level 1: Cross-encoder rerank(理想,需大模型)
 *     - 尝试 @xenova/transformers 加载 Xenova/ms-marco-MiniLM-L-6-v2
 *     - 给每对 (query, chunk.content) 打分,TopK 重排
 *   Level 2: 轻量级 BM25 重打分(fallback)
 *     - 不依赖任何模型,纯 JS token 重叠率
 *     - 公式: score = Σ tf-idf(qt in doc) × crossDocBoost(qt 出现在多文档中加权)
 *     - 加上: 标题/heading 命中加成(2x)
 *   Level 3: 直接返回原结果(连 Level 2 都失败时)
 *
 * 性能预算:
 * - Level 1: 50 候选 × ~30ms = 1.5s(超时 3s 终止)
 * - Level 2: 50 候选 × <1ms = <50ms
 *
 * 接口:
 *   rerank(query, results, opts?) => SearchResult[]  (按新分数降序)
 *
 * 失败兜底:
 *   - 任何抛错都被 catch,记 console.warn,返回原数组
 *   - 调用方拿到的永远是 SearchResult[],绝不会 throw
 *
 * v1.12.2 缓存策略:
 *   - LRU 缓存 100 条(query_hash + opts_hash → reranked results)
 *   - 命中缓存直接返回,跳过模型推理
 *   - 命中率统计暴露给 UI (getCacheStats)
 */

import type { SearchResult } from './search';

// === v1.12.2: 权重常量集中(可调优点) ===

/** Level 2 BM25 重打分权重 — 调到最佳组合后稳定下来 */
export const RERANK_WEIGHTS = {
  /** 标题命中加权(最强信号) */
  titleHit: 3.0,
  /** heading 命中加权 */
  headingHit: 2.0,
  /** chunk 内容 BM25 TF 加权 */
  contentTf: 1.0,
  /** 连续短语命中加成 */
  phraseBonus: 1.5,
  /** 太短的 chunk 降权系数 */
  shortChunkPenalty: 0.8,
  /** "太短"的字数阈值 */
  shortChunkThreshold: 50,
} as const;

// === 类型定义 ===

export interface RerankOptions {
  /** 返回前 N 条(默认:等于输入 results 长度) */
  topN?: number;
  /** 超时毫秒(默认 3000,超时则降级到 Level 2) */
  timeoutMs?: number;
  /** 强制使用 Level 2(测试或调试用) */
  forceFallback?: boolean;
  /** 是否把分数归一化到 0-1(默认 true,便于跨检索结果合并) */
  normalize?: boolean;
  /** v1.12.2: 是否跳过缓存(默认 false)— UI 调试用 */
  skipCache?: boolean;
}

export interface RerankStats {
  /** 用了哪一档 */
  level: 'cross-encoder' | 'bm25-rescore' | 'passthrough';
  /** 处理耗时 ms */
  durationMs: number;
  /** 输入候选数 */
  inputCount: number;
  /** 输出候选数 */
  outputCount: number;
  /** 是否超时降级 */
  timedOut: boolean;
  /** v1.12.2: 是否走了缓存 */
  cacheHit?: boolean;
}

export interface CacheStats {
  /** 当前缓存条数 */
  size: number;
  /** 累计命中次数 */
  hits: number;
  /** 累计未命中次数 */
  misses: number;
  /** 命中率 0-1 */
  hitRate: number;
  /** 累计驱逐次数(LRU) */
  evictions: number;
}

// === v1.12.2: LRU 缓存层 ===

interface CacheEntry {
  /** rerank 后结果(已排序) */
  results: SearchResult[];
  /** 时间戳(用于显示缓存新鲜度) */
  ts: number;
}

const CACHE_MAX_SIZE = 100;          // 最多 100 条
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟过期

class LRUCache {
  private map = new Map<string, CacheEntry>();
  private stats = { hits: 0, misses: 0, evictions: 0 };

  /** 简单 djb2 hash(JS 同步可用,不依赖 crypto.subtle) */
  private hash(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** 缓存 key = query + 结果指纹 + opts 指纹 */
  makeKey(query: string, results: SearchResult[], opts: RerankOptions): string {
    // 结果指纹:path+idx+content 长度(内容变化也能感知到)
    const resultSig = results
      .slice(0, 50)  // 只取前 50,避免太长
      .map(r => `${r.path}#${r.idx}:${r.snippet.length}`)
      .join('|');
    const optsSig = JSON.stringify({
      topN: opts.topN ?? -1,
      timeoutMs: opts.timeoutMs ?? -1,
      forceFallback: !!opts.forceFallback,
      normalize: opts.normalize ?? true,
    });
    return this.hash(query + '||' + resultSig + '||' + optsSig);
  }

  get(key: string): SearchResult[] | null {
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      this.map.delete(key);
      this.stats.misses++;
      return null;
    }
    // LRU 命中:删了重插,刷新"最近使用"位置
    this.map.delete(key);
    this.map.set(key, entry);
    this.stats.hits++;
    return entry.results;
  }

  set(key: string, results: SearchResult[]): void {
    // 已存在先删
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { results, ts: Date.now() });

    // 超 LRU 上限:删最旧的(Map 保持插入顺序,最旧的就是首个)
    while (this.map.size > CACHE_MAX_SIZE) {
      const firstKey = this.map.keys().next().value;
      if (!firstKey) break;
      this.map.delete(firstKey);
      this.stats.evictions++;
    }
  }

  clear(): void {
    this.map.clear();
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.map.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
      evictions: this.stats.evictions,
    };
  }

  /** 重置累计统计(不清缓存内容)— 调试用 */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }
}

const _cache = new LRUCache();

/** v1.12.2: UI 监控用 */
export function getCacheStats(): CacheStats {
  return _cache.getStats();
}

/** v1.12.2: 清空缓存(测试 / "重新建索引"按钮) */
export function clearRerankCache(): void {
  _cache.clear();
}

// === Level 1: Cross-encoder rerank(懒加载) ===

interface CrossEncoderPipeline {
  (query: string, docs: string[], options?: { topk?: number }): Promise<Array<{ score: number; index: number }>>;
}

let _crossEncoderPromise: Promise<CrossEncoderPipeline | null> | null = null;

/**
 * 懒加载 cross-encoder 模型(首次调用才下载 ~25MB)
 * 失败返回 null,调用方降级到 Level 2
 */
async function loadCrossEncoder(): Promise<CrossEncoderPipeline | null> {
  if (_crossEncoderPromise) return _crossEncoderPromise;

  _crossEncoderPromise = (async () => {
    try {
      // 动态 import 避免首屏加载 @xenova/transformers(~5MB)
      const tf = await import('@xenova/transformers' as any).catch(() => null);
      if (!tf) {
        console.warn('[reranker] @xenova/transformers not available');
        return null;
      }
      const { pipeline, env } = tf as any;
      // 允许本地缓存(用户已有 model 时复用)
      env.allowLocalModels = true;
      env.useFS = undefined as any;  // 默认就行

      const pipe: any = await pipeline(
        'text-classification',
        'Xenova/ms-marco-MiniLM-L-6-v2',
        { quantized: true }  // 量化模型 ~25MB,精度损失 < 2%
      );
      console.log('[reranker] cross-encoder loaded');
      // 包装成统一接口
      return async (query: string, docs: string[], options) => {
        const inputs = docs.map(d => `${query} [SEP] ${d.slice(0, 512)}`);
        const outputs = await pipe(inputs, { topk: 1 });
        // outputs 是 Array<Array<{label, score}>>,取 score 字段
        const scored = outputs.map((out: any, idx: number) => {
          const score = Array.isArray(out) ? (out[0]?.score ?? 0) : (out?.score ?? 0);
          return { score, index: idx };
        });
        scored.sort((a: any, b: any) => b.score - a.score);
        return options?.topk ? scored.slice(0, options.topk) : scored;
      };
    } catch (e) {
      console.warn('[reranker] cross-encoder load failed, will use Level 2:', e);
      return null;
    }
  })();

  return _crossEncoderPromise;
}

// === Level 2: 轻量级 BM25 重打分(零依赖) ===

const STOP_WORDS = new Set([
  // 中文
  '的', '了', '是', '在', '和', '与', '或', '及', '等', '为', '我', '你', '他', '她', '它',
  '这', '那', '有', '没', '不', '也', '都', '就', '要', '会', '能', '把', '被', '对', '从',
  // 英文
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'and', 'or', 'but',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'as', 'this', 'that', 'these',
  'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they',
]);

function tokenizeBM25(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // 英文按词
  const enMatches = text.toLowerCase().match(/[a-z0-9_]+/g);
  if (enMatches) {
    for (const m of enMatches) {
      if (m.length > 1 && !STOP_WORDS.has(m)) out.push(m);
    }
  }
  // 中文按字 + 2-gram
  const cnChars = text.match(/[一-鿿]+/g);
  if (cnChars) {
    for (const seg of cnChars) {
      const chars = [...seg];
      for (const c of chars) {
        if (!STOP_WORDS.has(c)) out.push(c);
      }
      for (let i = 0; i < chars.length - 1; i++) {
        const bg = chars[i] + chars[i + 1];
        if (!STOP_WORDS.has(chars[i]) && !STOP_WORDS.has(chars[i + 1])) out.push(bg);
      }
    }
  }
  return out;
}

/**
 * 对单个结果重打分:综合 query 在 chunk 各字段中的命中情况
 *
 * 加分项(权重来自 RERANK_WEIGHTS):
 *   + 标题命中 ×titleHit(默认 3.0)
 *   + heading 命中 ×headingHit(默认 2.0)
 *   + chunk.content 命中 ×contentTf(默认 1.0,BM25 风格)
 *   + chunk.content 中连续命中相邻位置 ×phraseBonus(默认 1.5)
 *
 * 减分项:
 *   - chunk 太短(碎片) ×shortChunkPenalty(默认 0.8)
 */
function bm25RescoreOne(query: string, result: SearchResult): number {
  const qTokens = tokenizeBM25(query);
  if (qTokens.length === 0) return 0;

  const titleLower = result.title.toLowerCase();
  const headingLower = result.heading.toLowerCase();
  const contentLower = result.snippet.toLowerCase();

  let score = 0;

  for (const qt of qTokens) {
    // 标题命中(强信号)
    if (titleLower.includes(qt)) {
      score += RERANK_WEIGHTS.titleHit;
    }
    // heading 命中(中等)
    if (headingLower.includes(qt)) {
      score += RERANK_WEIGHTS.headingHit;
    }
    // chunk 内容命中
    const tf = contentLower.split(qt).length - 1;  // 出现次数
    if (tf > 0) {
      // BM25 风格的 TF 饱和
      const norm = (tf * (1.5 + 1)) / (tf + 1.5 * (1 - 0.75 + 0.75 * 1));
      score += norm * RERANK_WEIGHTS.contentTf;
    }
  }

  // 连续 token 命中加成(query 是连续的,文档也是连续的,匹配更可信)
  const qPhrase = qTokens.join('');  // 粗略的连续字符串
  if (qPhrase.length >= 4 && contentLower.includes(qPhrase)) {
    score += RERANK_WEIGHTS.phraseBonus;
  }

  // 长度惩罚:chunk 太短可能是碎片
  if (result.snippet.length < RERANK_WEIGHTS.shortChunkThreshold) {
    score *= RERANK_WEIGHTS.shortChunkPenalty;
  }

  return score;
}

function normalizeScores(arr: SearchResult[], newScores: number[]): SearchResult[] {
  const max = Math.max(...newScores, 0.0001);
  return arr.map((r, i) => ({ ...r, score: newScores[i] / max }));
}

// === 主入口 ===

/**
 * Rerank 入口 — 永不抛出,失败返回原数组
 *
 * v1.12.2: 接入 LRU 缓存,命中直接返回,跳过模型推理
 *
 * @example
 *   const fused = await searchHybrid(query, 50);
 *   const top = await rerank(query, fused, { topN: 10 });
 */
export async function rerank(
  query: string,
  results: SearchResult[],
  opts: RerankOptions = {}
): Promise<SearchResult[]> {
  const start = performance.now();
  const topN = opts.topN ?? results.length;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const normalize = opts.normalize ?? true;

  // 边界:空结果或 query 为空,直接返回
  if (!results || results.length === 0 || !query.trim()) {
    return results;
  }

  // v1.12.2: LRU 缓存命中检查
  if (!opts.skipCache) {
    const cacheKey = _cache.makeKey(query, results, opts);
    const cached = _cache.get(cacheKey);
    if (cached) {
      console.log(`[reranker] cache hit ${Math.round(performance.now() - start)}ms, ${cached.length} results`);
      return cached;
    }
  }

  let finalResults: SearchResult[] = [];

  // Level 1: Cross-encoder(除非强制 fallback)
  if (!opts.forceFallback) {
    try {
      const ce = await Promise.race([
        loadCrossEncoder(),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error('load timeout')), timeoutMs)),
      ]);
      if (ce) {
        const docs = results.map(r => r.snippet);
        const scored = await Promise.race([
          ce(query, docs, { topk: topN }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('inference timeout')), timeoutMs)),
        ]);
        const out: SearchResult[] = [];
        for (const s of scored) {
          out.push({ ...results[s.index], score: s.score });
        }
        finalResults = normalize ? normalizeScores(out, out.map(r => r.score)) : out;
        console.log(`[reranker] Level 1 (cross-encoder) done in ${Math.round(performance.now() - start)}ms, ${results.length}→${finalResults.length}`);
        // 写缓存
        if (!opts.skipCache) {
          _cache.set(_cache.makeKey(query, results, opts), finalResults);
        }
        return finalResults;
      }
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      console.warn(`[reranker] Level 1 failed (${msg}), falling back to Level 2`);
    }
  }

  // Level 2: BM25 重打分
  try {
    const scores = results.map(r => bm25RescoreOne(query, r));
    // 按新分数降序排
    const indexed = results.map((r, i) => ({ r, s: scores[i] }));
    indexed.sort((a, b) => b.s - a.s);
    const sliced = indexed.slice(0, topN).map(x => x.r);
    finalResults = normalize
      ? sliced.map((r, i) => ({ ...r, score: indexed[i].s }))
      : sliced;
    console.log(`[reranker] Level 2 (bm25-rescore) done in ${Math.round(performance.now() - start)}ms, ${results.length}→${finalResults.length}`);
    // 写缓存
    if (!opts.skipCache) {
      _cache.set(_cache.makeKey(query, results, opts), finalResults);
    }
    return finalResults;
  } catch (e) {
    console.warn('[reranker] Level 2 failed, returning passthrough:', e);
    // Level 3: passthrough
    return results.slice(0, topN);
  }
}

/**
 * 仅做统计的快速检查(给 UI 显示用)
 */
export async function getRerankerStatus(): Promise<{ crossEncoderAvailable: boolean }> {
  try {
    const ce = await Promise.race([
      loadCrossEncoder(),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('timeout')), 500)),
    ]);
    return { crossEncoderAvailable: !!ce };
  } catch {
    return { crossEncoderAvailable: false };
  }
}

/**
 * 重置懒加载缓存(测试用)
 */
export function _resetRerankerForTests(): void {
  _crossEncoderPromise = null;
}
