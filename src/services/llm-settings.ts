/**
 * LLM 设置 — localStorage 持久化
 *
 * 与主题设置 (kb-settings) 分开存，避免格式冲突
 */

import { PROVIDERS, type LLMSettings as _LLMSettings } from '../lib/llm';
export type LLMSettings = _LLMSettings;

const KEY = 'kb-llm-settings';

const DEFAULTS: LLMSettings = {
  provider: 'deepseek',          // 国内用户友好（也支持 OpenAI 兼容 URL）
  baseUrl: PROVIDERS.deepseek.defaultBaseUrl,
  apiKey: '',
  model: PROVIDERS.deepseek.defaultModel,
  temperature: 0.3,             // 质量优先 (0.7 太随机,容易跑偏)
  maxTokens: 8192,              // MiniMax-M3 上下文 1M,给输出留足空间避免截断
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