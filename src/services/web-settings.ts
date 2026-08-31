/**
 * 联网搜索设置 — localStorage 持久化
 */

import { WEB_PROVIDERS, type WebSearchSettings as _WebSearchSettings } from '../lib/web-search';
export type WebSearchSettings = _WebSearchSettings;

const KEY = 'kb-web-settings';

const DEFAULTS: WebSearchSettings = {
  provider: 'tavily',
  url: WEB_PROVIDERS.tavily.defaultUrl,
  apiKey: '',
  maxResults: 5,
};

export function loadWebSettings(): WebSearchSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch {}
  return { ...DEFAULTS };
}

export function saveWebSettings(s: WebSearchSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}