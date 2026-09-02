/**
 * V46: 长期记忆设置 — localStorage 持久化
 */

const KEY = 'kb-memory-settings';

export interface MemorySettings {
  /** V46: 是否启用长期记忆提取 */
  enabled: boolean;
  /** 自动提取触发时机: 'every-turn' | 'manual' */
  mode: 'every-turn' | 'manual';
  /** 是否在 system prompt 注入记忆(让 LLM 知道用户偏好) */
  injectInPrompt: boolean;
}

const DEFAULTS: MemorySettings = {
  enabled: true,
  mode: 'every-turn',
  injectInPrompt: true,
};

export function loadMemorySettings(): MemorySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function saveMemorySettings(s: MemorySettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}