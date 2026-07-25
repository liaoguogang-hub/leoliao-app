/**
 * 导出服务 — MD → HTML/PDF 导出 + 分享
 * V32: 客户端生成真 PDF(html2canvas + jsPDF)
 *      原生平台: Filesystem 写 .pdf 后 Capacitor Share
 *      Web 平台:  直接触发下载 .pdf
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { NoteFile } from '../types';
import type { ThemeSettings } from './settings';

/** 根据当前主题生成内嵌 CSS */
function themeCSS(s: ThemeSettings): string {
  return `
:root {
  --bg: ${s.bgColor};
  --bg-2: ${s.bg2Color};
  --card: ${s.bg2Color};
  --fg: ${s.fgColor};
  --dim: ${s.dimColor};
  --accent: ${s.accentColor};
  --link: ${s.linkColor};
  --wikilink: ${s.wikilinkColor};
  --heading: ${s.headingColor};
  --border: ${s.borderColor};
  --body-font-family: ${s.fontFamily};
  --body-font-size: ${s.fontSize}px;
}`;
}

/** 生成自包含 HTML 文档字符串 */
export function generateHTML(note: NoteFile, settings: ThemeSettings): string {
  const title = note.path.split('/').pop()?.replace(/\.md$/, '') || '笔记';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(title)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: var(--body-font-family, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif);
  background: var(--bg);
  color: var(--fg);
  line-height: 1.7;
  padding: 24px;
  -webkit-font-smoothing: antialiased;
}
${themeCSS(settings)}
/* 笔记正文样式 */
.note-header { border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 20px; }
.note-title { font-size: 24px; font-weight: 700; color: var(--accent); margin-bottom: 8px; word-break: break-word; }
.note-meta { font-size: 11px; color: var(--dim); }
.note-body { font-size: var(--body-font-size, 15px); line-height: 1.8; }
.note-body h1, .note-body h2, .note-body h3, .note-body h4 {
  color: var(--heading, var(--accent)); margin: 1.5em 0 0.5em; font-weight: 700;
}
.note-body h1 { font-size: 24px; }
.note-body h2 { font-size: 20px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.note-body h3 { font-size: 17px; }
.note-body h4 { font-size: 15px; }
.note-body p { margin: 0.8em 0; }
.note-body ul, .note-body ol { padding-left: 1.5em; margin: 0.8em 0; }
.note-body li { margin: 0.3em 0; }
.note-body a { color: var(--link, var(--accent)); text-decoration: underline; }
.note-body a.wikilink { color: var(--wikilink, #ffcc44); background: rgba(255,204,68,0.1); padding: 1px 4px; border-radius: 3px; }
.note-body code { background: var(--bg-2); padding: 1px 5px; border-radius: 3px; font-family: 'SF Mono', Menlo, monospace; font-size: 13px; }
.note-body pre { background: var(--bg-2); border: 1px solid var(--border); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 1em 0; }
.note-body pre code { background: transparent; padding: 0; }
.note-body blockquote { border-left: 3px solid var(--accent); padding-left: 12px; margin: 1em 0; color: var(--dim); }
.note-body hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
.note-body img { max-width: 100%; border-radius: 6px; margin: 1em 0; }
.note-body .callout { border-left: 3px solid; padding: 8px 12px; margin: 1em 0; background: var(--card); border-radius: 4px; }
.note-body .callout-note { border-color: #4488ff; }
.note-body .callout-warning { border-color: #ffcc44; }
.note-body .callout-tip { border-color: #88ff88; }
.note-body .callout-info { border-color: var(--accent); }
.frontmatter { background: var(--card); border-radius: 6px; padding: 12px; margin-bottom: 16px; font-size: 12px; }
.fm-row { display: flex; gap: 8px; padding: 2px 0; }
.fm-key { color: var(--accent); min-width: 80px; }
.fm-val { color: var(--fg); word-break: break-word; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.tag { background: rgba(0,255,170,0.1); color: var(--accent); padding: 2px 8px; border-radius: 4px; font-size: 11px; }
@media print {
  @page { margin: 1.5cm; }
  body { background: white; color: black; padding: 0; }
  a { color: #0066cc !important; }
  .note-body a.wikilink { color: #b8860b !important; }
}
</style>
</head>
<body>
<article class="note">
  <header class="note-header">
    <h1 class="note-title">${escapeHTML(title)}</h1>
    <div class="note-meta">📂 ${escapeHTML(note.path)}</div>
  </header>
  ${formatFrontmatter(note.frontmatter)}
  ${note.tags.length > 0 ? '<div class="tags">' + note.tags.map(t => `<span class="tag">#${escapeHTML(t)}</span>`).join('') + '</div>' : ''}
  <div class="note-body">
    ${note.html}
  </div>
</article>
</body>
</html>`;
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatFrontmatter(fm: Record<string, unknown>): string {
  const keys = Object.keys(fm).filter(k => k !== 'tags');
  if (!keys.length) return '';
  return `<div class="frontmatter">${keys.map(k =>
    `<div class="fm-row"><span class="fm-key">${escapeHTML(k)}</span><span class="fm-val">${escapeHTML(String(fm[k]))}</span></div>`
  ).join('')}</div>`;
}

/** 安全的文件名(去特殊字符) */
function safeFileName(path: string): string {
  const base = path.split('/').pop()?.replace(/\.md$/, '') || '笔记';
  return base.replace(/[<>:"/\\|?*]/g, '_').slice(0, 100);
}

/**
 * 导出为 HTML 文件并通过系统分享
 * 原生平台: 用 Filesystem 写 temp 文件后 Share
 * 浏览器: 用 Blob + 下载链接 降级
 */
export async function exportHTML(note: NoteFile, settings: ThemeSettings): Promise<void> {
  const html = generateHTML(note, settings);
  const fileName = safeFileName(note.path) + '.html';

  if (Capacitor.isNativePlatform()) {
    try {
      // 1. 写临时文件到 Cache 目录
      await Filesystem.writeFile({
        path: fileName,
        data: html,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      // 2. 获取 URI
      const uriResult = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Cache,
      });
      // 3. 分享文件
      await Share.share({
        title: fileName.replace('.html', ''),
        files: [uriResult.uri],
        dialogTitle: '分享 HTML 文件',
      });
    } catch (e) {
      console.error('[exportHTML] 原生分享失败:', e);
      // 降级到浏览器下载
      downloadBlob(html, fileName, 'text/html');
    }
  } else {
    downloadBlob(html, fileName, 'text/html');
  }
}

/**
 * 导出为真 PDF (V32)
 *
 * 流程(html2canvas + jsPDF):
 *   1. 把笔记 HTML 塞进离屏 div(屏幕外,不影响 UI)
 *   2. 等图片/字体加载完
 *   3. html2canvas 渲染整个 div → canvas
 *   4. 按 A4 宽度等比切片,逐页 addImage 到 jsPDF
 *   5. 拿到 PDF Blob → base64
 *   6. 原生: Filesystem.writeFile(.pdf) + Capacitor.Share
 *      Web:   直接 <a download>
 *
 * 注意: PDF 是 canvas 截图,文字不可选中/复制(中文 web 字体可正常渲染)。
 */
export async function exportPDF(note: NoteFile, settings: ThemeSettings, onDone?: () => void): Promise<void> {
  const fileName = safeFileName(note.path);

  // 1. 构建离屏容器
  const container = document.createElement('div');
  container.innerHTML = generateHTML(note, settings);
  // 屏幕外、固定 A4 宽度(794px @ 96dpi ≈ 210mm),白底确保打印效果
  container.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'width:794px',
    'padding:32px',
    'background:#ffffff',
    'color:#1a1a1a',
    'font-family:-apple-system,PingFang SC,Microsoft YaHei,sans-serif',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(container);

  // 2. 等图片/字体加载
  try {
    await waitForAssets(container);
  } catch (e) {
    console.warn('[exportPDF] 等待资源超时,继续:', e);
  }

  // 3. 渲染 canvas
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(container, {
      scale: 2,                  // 高清
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      allowTaint: false,
    });
  } catch (e) {
    console.error('[exportPDF] html2canvas 失败:', e);
    document.body.removeChild(container);
    alert('PDF 渲染失败,请改用"导出 HTML 文件"');
    if (onDone) onDone();
    return;
  }
  document.body.removeChild(container);

  // 4. 切片拼 A4 PDF
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const imgWidthMm = pageWidthMm;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  if (imgHeightMm <= pageHeightMm) {
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidthMm, imgHeightMm);
  } else {
    // 多页: 按 A4 高度切片(用 page-slicing,简单做法是把整张图放在第一页并裁剪显示区)
    let remaining = imgHeightMm;
    let position = 0;
    while (remaining > 0) {
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidthMm, imgHeightMm);
      remaining -= pageHeightMm;
      position -= pageHeightMm;
      if (remaining > 0) pdf.addPage();
    }
  }

  // 5. 拿 PDF Blob
  const pdfBlob = pdf.output('blob');
  const pdfBase64 = await blobToBase64(pdfBlob);

  // 6. 分发
  const pdfFileName = fileName + '.pdf';
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: pdfFileName,
        data: pdfBase64,
        directory: Directory.Cache,
      });
      const uriResult = await Filesystem.getUri({
        path: pdfFileName,
        directory: Directory.Cache,
      });
      await Share.share({
        title: fileName,
        files: [uriResult.uri],
        dialogTitle: '分享 PDF',
      });
    } catch (e) {
      console.error('[exportPDF] 原生分享失败:', e);
      alert('PDF 生成成功但分享失败,可改用"导出 HTML 文件"');
    }
  } else {
    downloadBlobFromBlob(pdfBlob, pdfFileName);
  }

  if (onDone) onDone();
}

/** 等所有图片加载完 */
function waitForAssets(root: HTMLElement, timeoutMs = 8000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let pending = imgs.length;
    const timer = setTimeout(() => {
      console.warn('[waitForAssets] 超时,继续');
      resolve();
    }, timeoutMs);
    const done = () => {
      pending--;
      if (pending <= 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    imgs.forEach(img => {
      if (img.complete) { done(); return; }
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  });
}

/** Blob → base64 (不带 data: 前缀) */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 触发浏览器下载 Blob 文件 */
function downloadBlobFromBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 旧版保留兼容(文本 → Blob 下载) */
function downloadBlob(content: string, fileName: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 保存笔记到本地
 * V36.1: Web 用 showSaveFilePicker(Leo 选位置);Android 退回固定路径(Android 11+ scoped storage
 *        阻止写到 SAF picker 选的文件,所以不再弹 picker,直接写 Directory.Documents 公共目录)
 * @returns 保存信息 { fileName, location },用户取消返回 null
 */
export interface SaveResult {
  fileName: string;
  /** "picker" = Leo 选了位置;"Documents/{fileName}" = Android 固定路径 */
  location: string;
}

export async function saveToLocal(note: NoteFile): Promise<SaveResult | null> {
  const fileName = safeFileName(note.path) + '.md';
  if (!Capacitor.isNativePlatform()) {
    return await saveOnWeb(note.content, fileName);
  }
  return await saveOnNative(note.content, fileName);
}

/**
 * Web 平台保存 — 优先 showSaveFilePicker(Chrome/Edge),不支持就 fallback 下载
 */
async function saveOnWeb(content: string, fileName: string): Promise<SaveResult | null> {
  // showSaveFilePicker 在 secure context 才可用,且仅 Chromium 系
  const pickerFn = (window as any).showSaveFilePicker;
  if (typeof pickerFn === 'function') {
    try {
      const handle = await pickerFn({
        suggestedName: fileName,
        types: [{
          description: 'Markdown',
          accept: { 'text/markdown': ['.md'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { fileName, location: 'picker' };
    } catch (e: any) {
      // 用户取消(AbortError)→ 静默返回 null,不报错
      if (e?.name === 'AbortError') return null;
      // picker 失败 → fallback 下载
      console.warn('[export] showSaveFilePicker 失败,fallback:', e?.message);
    }
  }
  // Fallback: <a download> 下载(浏览器默认路径,无法选位置)
  downloadBlob(content, fileName, 'text/markdown');
  return { fileName, location: 'picker' };
}

/**
 * Native 平台保存 — 写到公共 Documents 目录(Leo 用文件管理器能找到)
 * V36.1 变更:Android 11+ scoped storage 限制,SAF picker 选的文件 app 无法覆盖写
 *   (Leo 反馈 "覆盖保存显示失败")。退回到固定路径方案,V36 之前就是这个行为。
 *   Leo 文件管理器 → 内部存储 → Documents → knowledge-base/{fileName}
 */
async function saveOnNative(content: string, fileName: string): Promise<SaveResult | null> {
  // 用 Documents/knowledge-base/{fileName} 子目录,避免污染用户 Documents 根目录
  const relativePath = `knowledge-base/${fileName}`;
  try {
    // 先确保 knowledge-base 子目录存在
    try {
      await Filesystem.mkdir({
        path: 'knowledge-base',
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e: any) {
      // 已存在会抛 EEXIST,忽略
      if (!String(e?.message ?? '').includes('exist')) {
        console.warn('[export] mkdir knowledge-base 失败(可能已存在):', e?.message);
      }
    }
    await Filesystem.writeFile({
      path: relativePath,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    return { fileName, location: `Documents/${relativePath}` };
  } catch (e: any) {
    throw new Error(`写入失败: ${e.message || e}`);
  }
}