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
  maxTokens: 65536,             // MiniMax-M3 上下文 1M,LLM thinking 消耗大量 token,给输出 64K 留足
};

export function loadLLMSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // V1.1.3+ 自动迁移：localStorage 里的 maxTokens < 16384 是早期默认值（1024/8192/16384）
      // 这些值对 MiniMax-M3 这种 1M context 的模型太小,长回答必被截断。
      // 强制升级到 DEFAULTS.maxTokens (65536)，但用户主动设的更高值保留。
      if (typeof parsed.maxTokens === 'number' && parsed.maxTokens < 16384) {
        console.log('[llm-settings] 升级 maxTokens', parsed.maxTokens, '→', DEFAULTS.maxTokens, '(旧值太小)');
        parsed.maxTokens = DEFAULTS.maxTokens;
      }
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