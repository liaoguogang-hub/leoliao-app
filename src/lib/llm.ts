/**
 * LLM 客户端 — 统一调用层，支持流式（SSE）和一次性两种模式
 *
 * 用法:
 *   for await (const delta of chatStream({messages, settings})) { ... }
 *
 * 设计要点:
 *   - 流式通过 fetch + ReadableStream（无需 EventSource，自带 Authorization header）
 *   - Anthropic 走独立路径（不同的请求/响应结构）
 *   - 失败抛 Error 含状态码 + body 前 200 字
 */

import { PROVIDERS, type ProviderId } from './llm-providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMSettings {
  provider: ProviderId;
  baseUrl: string;          // 例如 https://api.openai.com/v1
  apiKey: string;
  model: string;
  temperature?: number;       // 默认 0.7
  maxTokens?: number;        // 默认 1024
}

interface OpenAIRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface AnthropicRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  max_tokens: number;
  temperature?: number;
  system?: string;          // system 从 messages 抽出来
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
}

interface AnthropicChunk {
  type?: string;             // content_block_delta / message_stop ...
  delta?: { type?: string; text?: string };
}

/** 一次性返回完整响应（不流式），用于测试连接 */
export async function chatOnce(messages: ChatMessage[], settings: LLMSettings): Promise<string> {
  const provider = PROVIDERS[settings.provider];
  const url = provider.isAnthropic
    ? `${settings.baseUrl.replace(/\/+$/, '')}/v1/messages`
    : `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let body: any;
  if (provider.isAnthropic) {
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    const { system, ...rest } = toAnthropicRequest(messages, settings);
    body = { ...rest, stream: false, ...(system ? { system } : {}) };
  } else {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
    body = { ...toOpenAIRequest(messages, settings), stream: false };
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
  }
  const json: any = await res.json();
  if (provider.isAnthropic) {
    const block = (json.content || []).find((b: any) => b.type === 'text');
    return block?.text || '';
  }
  return json.choices?.[0]?.message?.content || '';
}

/** 流式输出 — 每块是 assistant 增量文本 */
export async function* chatStream(
  messages: ChatMessage[],
  settings: LLMSettings,
  signal?: AbortSignal
): AsyncGenerator<string, void, undefined> {
  const provider = PROVIDERS[settings.provider];
  const url = provider.isAnthropic
    ? `${settings.baseUrl.replace(/\/+$/, '')}/v1/messages`
    : `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  let body: any;
  if (provider.isAnthropic) {
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    const { system, ...rest } = toAnthropicRequest(messages, settings);
    body = { ...rest, stream: true, ...(system ? { system } : {}) };
  } else {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
    body = { ...toOpenAIRequest(messages, settings), stream: true };
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.body) {
    // 极少数环境（老 WebView）没 ReadableStream，降级
    const text = await res.text();
    yield* parseSSE(text, provider.isAnthropic);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 按行切
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Anthropic 用 event: + data: 两行；OpenAI 仅 data:
      if (provider.isAnthropic) {
        if (trimmed.startsWith('event:')) continue;
        if (!trimmed.startsWith('data:')) continue;
      } else {
        if (!trimmed.startsWith('data:')) continue;
      }
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json: any = JSON.parse(payload);
        const delta = provider.isAnthropic
          ? extractAnthropicDelta(json)
          : extractOpenAIDelta(json);
        if (delta) yield delta;
      } catch {
        // SSE 行偶尔 JSON 解析失败（注释行、心跳），忽略
      }
    }
  }
}

function* parseSSE(text: string, isAnthropic: boolean): Generator<string> {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json: any = JSON.parse(payload);
      const delta = isAnthropic ? extractAnthropicDelta(json) : extractOpenAIDelta(json);
      if (delta) yield delta;
    } catch {}
  }
}

function extractOpenAIDelta(json: OpenAIChunk): string {
  return json.choices?.[0]?.delta?.content || '';
}

function extractAnthropicDelta(json: AnthropicChunk): string {
  if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
    return json.delta.text || '';
  }
  return '';
}

function toOpenAIRequest(messages: ChatMessage[], settings: LLMSettings): OpenAIRequest {
  return {
    model: settings.model,
    messages,
    stream: true,
    temperature: settings.temperature ?? 0.7,
    max_tokens: settings.maxTokens ?? 1024,
  };
}

function toAnthropicRequest(messages: ChatMessage[], settings: LLMSettings): Omit<AnthropicRequest, 'stream'> & { system?: string } {
  const systemMsgs = messages.filter(m => m.role === 'system').map(m => m.content);
  const nonSystem = messages.filter(m => m.role !== 'system');
  return {
    model: settings.model,
    messages: nonSystem,
    max_tokens: settings.maxTokens ?? 1024,
    temperature: settings.temperature ?? 0.7,
    system: systemMsgs.length ? systemMsgs.join('\n\n') : undefined,
  };
}

/** 验证 provider+url+key 是否有效（发一个 1 token 的 ping） */
export async function testConnection(settings: LLMSettings): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    const reply = await chatOnce(
      [{ role: 'user', content: 'ping' }],
      { ...settings, maxTokens: 8, temperature: 0 }
    );
    return { ok: true, model: settings.model, error: undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}