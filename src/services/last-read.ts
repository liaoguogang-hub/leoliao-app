/**
 * v1.68: 阅读位置记忆
 *
 * 目的: 打开 md 文件后关闭 APP,下次打开自动回到同一篇笔记的同一位置。
 *
 * 存储两条信息:
 *   - path  : 上次打开的笔记**原始**路径(md 的相对路径,与 manifest 一致)
 *   - ratio : `.main` 滚动比例 0..1
 *
 * 为什么用比例而不是像素:
 *   安卓机横竖屏切换、系统字号变化、markdown 图片加载先后都会改变
 *   scrollHeight;像素值会漂移,比例更稳。同时保留 px 作为兜底
 *   (短文档 max<=0 等比例失效场景)。
 */

const KEY = 'll-last-read-v1';

export interface LastReadState {
  /** 笔记相对路径 */
  path: string;
  /** `.main` 滚动比例 0..1 */
  ratio: number;
  /** 原始 scrollTop,比例失效时兜底 */
  px: number;
  /** 记录时间戳(ms) */
  at: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 读取上次阅读位置;无记录或数据损坏返回 null */
export function loadLastRead(): LastReadState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<LastReadState>;
    if (!o || typeof o.path !== 'string' || !o.path) return null;
    const px = Number(o.px);
    return {
      path: o.path,
      ratio: clamp01(Number(o.ratio)),
      px: Number.isFinite(px) && px > 0 ? px : 0,
      at: Number(o.at) || 0,
    };
  } catch {
    return null;
  }
}

/** 写入阅读位置(整体覆盖) */
export function saveLastRead(state: LastReadState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 存储满/被禁用:静默,不影响阅读 */
  }
}

/** 清除记录(笔记已删除或路径失效时调用) */
export function clearLastRead(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 静默 */
  }
}
