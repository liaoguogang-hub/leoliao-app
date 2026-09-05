/**
 * LLM Provider 预设 — OpenAI 兼容协议为主，Anthropic 单独走 /v1/messages
 *
 * v1.52.0: 模型清单精简(用户反馈)— 10 个常用 provider
 * 模型名:suggestedModels 是推荐列表(UI 下拉显示);用户也可手输任意名字
 */

export type ProviderId =
  | 'openai'
  | 'deepseek'
  | 'minimax'
  | 'anthropic'
  | 'google'
  | 'moonshotai'
  | 'qwen'
  | 'zhipu'
  | 'ollama'
  | 'custom';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** 推荐模型列表 — UI 下拉显示 */
  suggestedModels: string[];
  /** 向后兼容旧字段 */
  models?: string[];
  /** 是否走 Anthropic 的 /v1/messages 协议 */
  isAnthropic?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'o1-mini', 'o1'],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M3',
    suggestedModels: [
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
    suggestedModels: [
      'claude-3-7-sonnet-latest',
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
    ],
    isAnthropic: true,
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
  },
  moonshotai: {
    id: 'moonshotai',
    label: 'Moonshot AI (Kimi)',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-128k',
    suggestedModels: [
      'moonshot-v1-128k',
      'moonshot-v1-32k',
      'moonshot-v1-auto',
      'kimi-k2-0711-preview',
      'kimi-k3',
      'moonshot-v1-8k',
    ],
  },
  qwen: {
    id: 'qwen',
    label: '通义千问 (DashScope)',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    defaultModel: 'qwen-plus',
    suggestedModels: [
      'qwen-max-latest',
      'qwen-plus',
      'qwen-turbo',
      'qwen-long',
      'qwen-vl-max',
      'qwq-32b-preview',
    ],
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    defaultBaseUrl: 'https://bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    suggestedModels: [
      'glm-4-plus',
      'glm-4-air',
      'glm-4-airx',
      'glm-4-flash',
      'glm-4-flashx',
    ],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (本地)',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    suggestedModels: [
      'llama3.2',
      'qwen2.5:7b',
      'qwen2.5:14b',
      'deepseek-r1:8b',
      'gemma2:9b',
    ],
  },
  custom: {
    id: 'custom',
    label: '自定义 (OpenAI 兼容直连)',
    defaultBaseUrl: '',
    defaultModel: '',
    suggestedModels: [],
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
  PROVIDERS.google,
  PROVIDERS.moonshotai,
  PROVIDERS.qwen,
  PROVIDERS.zhipu,
  PROVIDERS.ollama,
  PROVIDERS.custom,
];