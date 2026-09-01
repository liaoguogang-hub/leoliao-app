/**
 * 联网搜索 Provider — 给对话补"网页"事实
 *
 * 支持:
 *   - tavily:  推荐（LLM-friendly，自带摘要，免费层 1000 次/月）
 *   - bing:    Azure Bing Search API，需要 key
 *   - duckduckgo: 无 key，但 HTML 解析可能不稳定
 *   - searxng: 自托管元搜索（无 key）
 *   - custom:  通用 HTTP 端点，返回 { results: [{title,url,content}] }
 */

export type WebProviderId = 'tavily' | 'bing' | 'duckduckgo' | 'searxng' | 'custom';

export interface WebProviderPreset {
  id: WebProviderId;
  label: string;
  defaultUrl: string;
  requiresApiKey: boolean;
  /** 自定义端点的默认 result 字段路径（custom 用） */
  defaultResultPath?: string;
}

export const WEB_PROVIDERS: Record<WebProviderId, WebProviderPreset> = {
  tavily: {
    id: 'tavily',
    label: 'Tavily (推荐)',
    defaultUrl: 'https://api.tavily.com/search',
    requiresApiKey: true,
  },
  bing: {
    id: 'bing',
    label: 'Bing Search API',
    defaultUrl: 'https://api.bing.microsoft.com/v7.0/search',
    requiresApiKey: true,
  },
  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo (无 key)',
    defaultUrl: 'https://html.duckduckgo.com/html/',
    requiresApiKey: false,
  },
  searxng: {
    id: 'searxng',
    label: 'SearXNG (自托管)',
    defaultUrl: '',
    requiresApiKey: false,
  },
  custom: {
    id: 'custom',
    label: '自定义 (通用 HTTP)',
    defaultUrl: '',
    requiresApiKey: false,
    defaultResultPath: 'results',
  },
};

export const WEB_PROVIDER_LIST: WebProviderPreset[] = [
  WEB_PROVIDERS.tavily,
  WEB_PROVIDERS.bing,
  WEB_PROVIDERS.duckduckgo,
  WEB_PROVIDERS.searxng,
  WEB_PROVIDERS.custom,
];

export interface WebSearchSettings {
  provider: WebProviderId;
  url: string;           // 端点 URL
  apiKey: string;        // 可选
  maxResults: number;    // 默认 5
}

export interface WebResult {
  title: string;
  url: string;
  content: string;       // 摘要/正文片段
}

/** 统一入口 — 各 provider 内部规范化为 {title,url,content}[] */
export async function webSearch(query: string, settings: WebSearchSettings): Promise<WebResult[]> {
  const preset = WEB_PROVIDERS[settings.provider];
  if (!settings.url && preset.defaultUrl) {
    settings = { ...settings, url: preset.defaultUrl };
  }
  switch (settings.provider) {
    case 'tavily':     return tavilySearch(query, settings);
    case 'bing':       return bingSearch(query, settings);
    case 'duckduckgo': return ddgSearch(query, settings);
    case 'searxng':    return searxngSearch(query, settings);
    case 'custom':     return customSearch(query, settings);
  }
}

/* ============ Provider 实现 ============ */

async function tavilySearch(query: string, s: WebSearchSettings): Promise<WebResult[]> {
  const res = await fetch(s.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: s.apiKey,
      query,
      max_results: s.maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const json: any = await res.json();
  return (json.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    content: (r.content || '').slice(0, 800),
  }));
}

async function bingSearch(query: string, s: WebSearchSettings): Promise<WebResult[]> {
  const url = new URL(s.url);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(s.maxResults));
  const res = await fetch(url.toString(), {
    headers: { 'Ocp-Apim-Subscription-Key': s.apiKey },
  });
  if (!res.ok) throw new Error(`Bing ${res.status}`);
  const json: any = await res.json();
  const items = json.webPages?.value || [];
  return items.map((r: any) => ({
    title: r.name || '',
    url: r.url || '',
    content: (r.snippet || '').slice(0, 800),
  }));
}

/** DDG HTML endpoint: POST q=...，HTML 返回，需 parse — 简化实现，只取前 N 个 .result__a */
async function ddgSearch(query: string, s: WebSearchSettings): Promise<WebResult[]> {
  const body = new URLSearchParams({ q: query, kl: '' });
  const res = await fetch(s.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`DDG ${res.status}`);
  const html = await res.text();
  return parseDDGHTML(html, s.maxResults);
}

function parseDDGHTML(html: string, max: number): WebResult[] {
  // 极简解析：抓 <a class="result__a"> 标题和 href，<td class="result__snippet"> 摘要
  const out: WebResult[] = [];
  const aRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<td[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const titles: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html))) {
    titles.push({ url: m[1], title: m[2].replace(/<[^>]*>/g, '').trim() });
  }
  const snippets: string[] = [];
  while ((m = snipRe.exec(html))) {
    snippets.push(m[1].replace(/<[^>]*>/g, '').trim());
  }
  for (let i = 0; i < Math.min(titles.length, max); i++) {
    out.push({
      title: titles[i].title,
      url: titles[i].url,
      content: (snippets[i] || '').slice(0, 800),
    });
  }
  return out;
}

/** SearXNG JSON API（?format=json）— 直接走 fetch + 标准化字段 */
async function searxngSearch(query: string, s: WebSearchSettings): Promise<WebResult[]> {
  const url = new URL(s.url);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('count', String(s.maxResults));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`SearXNG ${res.status}`);
  const json: any = await res.json();
  return (json.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    content: (r.content || r.snippet || '').slice(0, 800),
  }));
}

/** 自定义：POST {query, max_results} 期望返回 {results:[{title,url,content}]} */
async function customSearch(query: string, s: WebSearchSettings): Promise<WebResult[]> {
  const res = await fetch(s.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}),
    },
    body: JSON.stringify({ query, max_results: s.maxResults, q: query, limit: s.maxResults }),
  });
  if (!res.ok) throw new Error(`Custom ${res.status}`);
  const json: any = await res.json();
  const items = json.results || json.data || [];
  return items.slice(0, s.maxResults).map((r: any) => ({
    title: r.title || r.name || '',
    url: r.url || r.link || '',
    content: (r.content || r.snippet || r.text || '').slice(0, 800),
  }));
}