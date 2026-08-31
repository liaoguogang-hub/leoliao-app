/**
 * LLM 设置 — localStorage 持久化
 *
 * 与主题设置 (kb-settings) 分开存，避免格式冲突
 */

import { PROVIDERS, type LLMSettings as _LLMSettings, type ProviderId } from '../lib/llm';
export type LLMSettings = _LLMSettings;

const KEY = 'kb-llm-settings';

const DEFAULTS: LLMSettings = {
  provider: 'deepseek',          // 国内用户友好（也支持 OpenAI 兼容 URL）
  baseUrl: PROVIDERS.deepseek.defaultBaseUrl,
  apiKey: '',
  model: PROVIDERS.deepseek.defaultModel,
  temperature: 0.7,
  maxTokens: 1024,
};

export function loadLLMSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch {}
  return { ...DEFAULTS };
}

export function saveLLMSettings(s: LLMSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}