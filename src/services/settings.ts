/**
 * 设置服务 — localStorage 持久化 + CSS 变量实时生效
 * V29: 主题/字体/字号/链接色
 * V30: 补全所有 CSS var (bg2/card/border/dim) 让浅色主题整体协调
 */

export interface ThemeSettings {
  presetName?: string;       // 当前选的主题(用于恢复默认值)
  bgColor: string;
  bg2Color: string;         // 侧栏 / toolbar / 卡片背景
  fgColor: string;
  dimColor: string;         // 次要文字(meta/timestamp)
  borderColor: string;      // 分隔线
  linkColor: string;
  wikilinkColor: string;    // [[wikilink]] 链接色
  accentColor: string;       // 主色 (按钮/激活态)
  headingColor: string;      // body 内标题色
  fontFamily: string;
  fontSize: number;          // 笔记正文字号 (px)
}

/** 默认 (深色) - 5 个 CSS var 都是低饱和度 */
const DARK: ThemeSettings = {
  presetName: '深色（默认）',
  bgColor: '#0a1a2a',
  bg2Color: '#142a3e',
  fgColor: '#e8f0f5',
  dimColor: '#88aacc',
  borderColor: 'rgba(0, 255, 170, 0.15)',
  linkColor: '#00ffaa',
  wikilinkColor: '#ffcc44',
  accentColor: '#00ffaa',
  headingColor: '#00ffaa',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontSize: 15,
};

export const DEFAULT_SETTINGS: ThemeSettings = { ...DARK };

/** 4 个浅色/特色主题预设 - 所有 var 都调整,保证整体协调 */
export const PRESETS: Record<string, ThemeSettings> = {
  '深色（默认）': { ...DARK },
  '白色': {
    presetName: '白色',
    bgColor: '#ffffff',
    bg2Color: '#f5f5f7',           // 浅灰侧栏/toolbar
    fgColor: '#1a1a1a',
    dimColor: '#6b7785',
    borderColor: 'rgba(0, 0, 0, 0.12)',
    linkColor: '#0066cc',
    wikilinkColor: '#cc6600',
    accentColor: '#0066cc',
    headingColor: '#003366',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 15,
  },
  '羊皮纸': {
    presetName: '羊皮纸',
    bgColor: '#f4ecd8',
    bg2Color: '#e8dec2',           // 略深一点的米色
    fgColor: '#3a2f24',
    dimColor: '#8b7355',
    borderColor: 'rgba(92, 51, 23, 0.18)',
    linkColor: '#8b4513',
    wikilinkColor: '#a0522d',
    accentColor: '#8b4513',
    headingColor: '#5c3317',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 16,
  },
  '护眼绿': {
    presetName: '护眼绿',
    bgColor: '#c7e0c4',
    bg2Color: '#aacba6',           // 深一点的绿
    fgColor: '#1a3a1a',
    dimColor: '#4f7a4d',
    borderColor: 'rgba(13, 110, 13, 0.22)',
    linkColor: '#0d6e0d',
    wikilinkColor: '#b8860b',
    accentColor: '#0d6e0d',
    headingColor: '#0a4f0a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 15,
  },
  '夜色': {
    presetName: '夜色',
    bgColor: '#000000',
    bg2Color: '#0a0a14',
    fgColor: '#aabbcc',
    dimColor: '#4a5a6a',
    borderColor: 'rgba(102, 136, 255, 0.18)',
    linkColor: '#6688ff',
    wikilinkColor: '#ffcc44',
    accentColor: '#6688ff',
    headingColor: '#88aaff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 15,
  },
};

export function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem('kb-settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      // V30: 兼容老格式(只有 bgColor/fgColor 等,没有 bg2/dim/border)
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // 旧设置没有这些字段时,根据 preset 名称补全,否则用现成的
        bg2Color: parsed.bg2Color ?? DEFAULT_SETTINGS.bg2Color,
        dimColor: parsed.dimColor ?? DEFAULT_SETTINGS.dimColor,
        borderColor: parsed.borderColor ?? DEFAULT_SETTINGS.borderColor,
        wikilinkColor: parsed.wikilinkColor ?? DEFAULT_SETTINGS.wikilinkColor,
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: ThemeSettings): void {
  try {
    localStorage.setItem('kb-settings', JSON.stringify(s));
  } catch {}
}

/** 把设置应用到 document.documentElement 上,所有 CSS var 实时更新 */
export function applySettings(s: ThemeSettings): void {
  const root = document.documentElement;
  root.style.setProperty('--bg', s.bgColor);
  root.style.setProperty('--bg-2', s.bg2Color);
  root.style.setProperty('--card', s.bg2Color);             // card 跟随 bg2
  root.style.setProperty('--fg', s.fgColor);
  root.style.setProperty('--dim', s.dimColor);
  root.style.setProperty('--accent', s.accentColor);
  root.style.setProperty('--accent-2', s.accentColor);     // accent-2 同 accent
  root.style.setProperty('--link', s.linkColor);
  root.style.setProperty('--wikilink', s.wikilinkColor);
  root.style.setProperty('--heading', s.headingColor);
  root.style.setProperty('--border', s.borderColor);
  root.style.setProperty('--body-font-family', s.fontFamily);
  root.style.setProperty('--body-font-size', s.fontSize + 'px');
  // v1.50.0: 根据背景明暗标 data-theme,供 CSS 区分浅/深模式(emoji 对比度)
  const name = s.presetName || '';
  const isDarkName = name.includes('深色') || name.includes('夜色');
  // 兜底:按 fg/bg 亮度比判断(白底 → fg 深;暗底 → fg 亮)
  const fgLum = lum(s.fgColor);
  const bgLum = lum(s.bgColor);
  const dark = isDarkName || fgLum > bgLum + 0.3;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** 粗略计算 CSS 颜色亮度(hex/rgba) */
function lum(c: string): number {
  const m = c.match(/([\da-f]{2})[\da-f]{2}?/i);
  if (m) {
    const v = parseInt(m[1], 16) / 255;
    return v;
  }
  const rgba = c.match(/rgba?\((\d+)/);
  if (rgba) return parseInt(rgba[1], 10) / 255;
  return 0.5;
}
