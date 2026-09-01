/**
 * LLM Provider 预设 — OpenAI 兼容协议为主，Anthropic 单独走 /v1/messages
 *
 * 添加新 provider：只需在 PROVIDERS 加一条；无需改 llm.ts。
 */

export type ProviderId = 'openai' | 'deepseek' | 'minimax' | 'anthropic' | 'custom';

export interface ProviderPreset {
  id: ProviderId;
  label: string;            // 下拉里显示
  defaultBaseUrl: string;   // 默认 URL
  defaultModel: string;     // 默认模型
  models: string[];         // 快速选择下拉
  /** 是否走 Anthropic 的 /v1/messages 协议（独立，非 OpenAI 兼容） */
  isAnthropic?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'o1-mini', 'o1'],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M3',
    models: [
      'MiniMax-M3',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.7',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2',
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
    isAnthropic: true,
  },
  custom: {
    id: 'custom',
    label: '自定义 (OpenAI 兼容)',
    defaultBaseUrl: '',
    defaultModel: '',
    models: [],
  },
};

export function getProvider(id: ProviderId): ProviderPreset {
  return PROVIDERS[id] || PROVIDERS.openai;
}

export const PROVIDER_LIST: ProviderPreset[] = [
  PROVIDERS.openai,
  PROVIDERS.deepseek,
  PROVIDERS.minimax,
  PROVIDERS.anthropic,
  PROVIDERS.custom,
];