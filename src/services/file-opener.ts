/**
 * 本地文件打开服务 — V33
 * 支持:md / html / htm / txt / 图片(jpg/png/webp/gif) / docx / pdf (V42)
 *
 * 流程:
 *   1. FilePicker 调 Android SAF,返回 content:// URI
 *   2. CapacitorHttp.get({ url: uri, responseType: 'blob' }) 读字节
 *   3. 按扩展名分发到对应渲染器
 *
 * pptx 不做(无客户端方案)
 *
 * V39:新增 renderBytesToHtml(history 快照恢复)— 用历史里存的 Uint8Array 重新打开
 * V42:PDF 用 pdfjs-dist 内嵌渲染前 5 页(完整版提示用户在系统打开)
 */

import { FilePicker, PickedFile } from '@capawesome/capacitor-file-picker';
import DOMPurify from 'dompurify';
import mammoth from 'mammoth';
import MarkdownIt from 'markdown-it';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';  // V50: EPUB 解析
// Vite ?url 把 worker 单独打成资源,运行时 fetch
// @ts-ignore - Vite 虚拟模块
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// V42: 配置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl as unknown as string;

/** 打开的文件类型(给 SAF 过滤) */
const PICK_TYPES = [
  'text/markdown',
  'text/html',
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-powerpoint',                                              // ppt(老的)
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',   // pptx
  'application/msword',
  'image/*',
  'application/epub+zip',  // V50: EPUB
];

/** 文件元数据 + 内容 + 渲染结果 */
export interface OpenedFile {
  name: string;
  ext: string;
  mimeType: string;
  size: number;
  /** 原始字节(Uint8Array),图片是 buffer,文本是 UTF-8 解码后的字符串 */
  bytes?: Uint8Array;
  /** 文本/HTML/Markdown 原始字符串 */
  text?: string;
  /** 渲染后的 HTML(给 file-viewer 直接展示) */
  html: string;
  /** 提示信息(如"暂不支持 .pptx") */
  warning?: string;
  /** 来源标记:本地文件 */
  source: 'local';
}

/**
 * 打开系统文件选择器,读取并渲染文件
 * 失败/取消时返回 null
 */
export async function pickAndOpenFile(): Promise<OpenedFile | null> {
  let picked: PickedFile | null = null;
  try {
    const result = await FilePicker.pickFiles({
      types: PICK_TYPES,
      limit: 1,        // 只选一个(0=多选,但当前不支持>1)
      readData: true,  // 必须 true,否则只拿 URI 拿不到 data
    });
    if (!result.files.length) return null;
    picked = result.files[0];
  } catch (e: any) {
    if (e?.message?.includes('canceled') || e?.message?.includes('cancel')) {
      return null;  // 用户取消
    }
    console.error('[file-opener] pickFiles 失败:', e);
    throw e;
  }

  return await readAndRender(picked);
}

/** 拿到 picked 文件后,读字节 + 渲染 */
async function readAndRender(picked: PickedFile): Promise<OpenedFile> {
  const name = picked.name;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mimeType = picked.mimeType || guessMime(ext);

  // File Picker 在 readData: true 时直接给 base64
  const base64 = picked.data;  // 可能 undefined,某些 Android 版本不返回
  if (!base64) {
    return {
      name,
      ext,
      mimeType,
      size: picked.size,
      html: `<div class="file-error">⚠️ 无法读取文件内容,请重试或换文件</div>`,
      warning: '文件内容为空(readData 返回空)',
      source: 'local',
    };
  }

  // 直接把 base64 透传给 renderBytes,里面会自己解
  return renderBytes({ name, ext, mimeType, bytes: base64 });
}

/** V39: 给历史快照用 — 已经有 Uint8Array,直接渲染 */
export async function renderBytesToHtml(info: {
  name: string;
  ext?: string;
  size: number;
  bytes?: Uint8Array;
  mimeType?: string;
}): Promise<OpenedFile | null> {
  if (!info.bytes || info.bytes.byteLength === 0) return null;
  const base64 = uint8ArrayToBase64(info.bytes);
  const ext = (info.ext || info.name.split('.').pop() || '').toLowerCase();
  const mimeType = info.mimeType || guessMime(ext);
  return renderBytes({ name: info.name, ext, mimeType, bytes: base64 });
}

/** 内部:用 base64 串走主要渲染路径 */
async function renderBytes(info: { name: string; ext: string; mimeType: string; bytes: string | Uint8Array }): Promise<OpenedFile> {
  const { name, ext, mimeType } = info;
  const base64 = typeof info.bytes === 'string' ? info.bytes : uint8ArrayToBase64(info.bytes);
  const bytes = typeof info.bytes === 'string' ? base64ToUint8Array(info.bytes) : info.bytes;

  try {
    switch (ext) {
      case 'md':
      case 'markdown': {
        const text = new TextDecoder('utf-8').decode(bytes);
        const html = localMd.render(text);
        return makeFile(name, ext, mimeType, bytes, text, html, 'local');
      }
      case 'html':
      case 'htm': {
        const text = new TextDecoder('utf-8').decode(bytes);
        const safe = DOMPurify.sanitize(text, { USE_PROFILES: { html: true } });
        return makeFile(name, ext, mimeType, bytes, text, safe, 'local');
      }
      case 'txt': {
        const text = new TextDecoder('utf-8').decode(bytes);
        const html = `<pre class="txt-content">${escapeHtml(text)}</pre>`;
        return makeFile(name, ext, mimeType, bytes, text, html, 'local');
      }
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'gif': {
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const html = `<div class="image-content"><img src="${dataUrl}" alt="${escapeHtml(name)}" /></div>`;
        return makeFile(name, ext, mimeType, bytes, undefined, html, 'local');
      }
      case 'docx': {
        console.log('[file-opener] docx 开始转换, size=', bytes.byteLength, 'name=', name);
        try {
          const buffer = bytesToArrayBuffer(bytes);
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          const warnings = result.messages.length
            ? `<div class="file-warn">⚠️ docx 渲染警告:${result.messages.length} 条(可能丢排版细节)</div>`
            : '';
          return makeFile(
            name, ext, mimeType, bytes, undefined,
            warnings + `<div class="docx-content">${result.value}</div>`,
            'local'
          );
        } catch (e: any) {
          console.error('[file-opener] docx 转换失败:', e);
          return makeFile(
            name, ext, mimeType, bytes, undefined,
            `<div class="file-error">
              <strong>⚠️ docx 转换失败</strong><br>
              错误:${escapeHtml(e?.message || String(e))}<br>
              类型:${escapeHtml(e?.name || '?')}<br>
              <p style="margin-top:8px;font-size:13px">💡 docx 文件可能损坏</p>
            </div>`,
            'local',
            `docx 转换失败: ${e?.message || e}`
          );
        }
      }
      case 'pdf':
        return await renderPdf(name, ext, mimeType, bytes);
      case 'epub':
        return await renderEpub(name, ext, mimeType, bytes);
      case 'ppt':
      case 'pptx':
        return makeFile(
          name, ext, mimeType, bytes, undefined,
          `<div class="file-warn">📊 PPT/PPTX 无客户端方案,请先用 WPS/Office 另存为 PDF,再用本 APP 打开</div>`,
          'local',
          'ppt/pptx 不支持'
        );
      default:
        return makeFile(
          name, ext, mimeType, bytes, undefined,
          `<div class="file-warn">⚠️ 暂不支持 .${escapeHtml(ext)} 格式</div>`,
          'local',
          `不支持 .${ext}`
        );
    }
  } catch (e) {
    console.error(`[file-opener] 渲染 .${ext} 失败:`, e);
    return makeFile(
      name, ext, mimeType, bytes, undefined,
      `<div class="file-error">⚠️ 渲染 .${escapeHtml(ext)} 失败:${escapeHtml(String(e))}</div>`,
      'local',
      '渲染失败'
    );
  }
}

// ============ helpers ============

/** 本地 md 用 markdown-it 直接渲染(不带 wikilink/callout) */
const localMd = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

function makeFile(
  name: string,
  ext: string,
  mimeType: string,
  bytes: Uint8Array,
  text: string | undefined,
  html: string,
  source: 'local',
  warning?: string
): OpenedFile {
  return {
    name, ext, mimeType, size: bytes.byteLength,
    bytes, text, html, warning, source,
  };
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    md: 'text/markdown', markdown: 'text/markdown',
    html: 'text/html', htm: 'text/html',
    txt: 'text/plain',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    epub: 'application/epub+zip',  // V50: EPUB
  };
  return map[ext] || 'application/octet-stream';
}

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // 32KB chunks,防 atob/btoa stack overflow
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* === V42: PDF.js 内嵌渲染 ===
 * 把 PDF 前 N 页渲染成 PNG dataUrl,塞进 file-viewer 的 html 字段
 * (canvas 不能直接 innerHTML,所以每页都 toDataURL → <img>)
 * 默认上限 5 页,防止大 PDF 卡死;超出提示用户在系统打开
 */
const PDF_MAX_PAGES = 5;        // 一次最多渲染几页
const PDF_RENDER_SCALE = 1.5;   // 渲染清晰度(1.0 = 72dpi,1.5 = 108dpi)

async function renderPdf(
  name: string,
  ext: string,
  mimeType: string,
  bytes: Uint8Array
): Promise<OpenedFile> {
  try {
    console.log('[file-opener] PDF 开始渲染, size=', bytes.byteLength, 'name=', name);
    // PDF.js 要 ArrayBuffer
    const buffer = bytesToArrayBuffer(bytes);
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    console.log('[file-opener] PDF 共', totalPages, '页');

    const renderLimit = Math.min(totalPages, PDF_MAX_PAGES);
    const imgs: string[] = [];
    for (let i = 1; i <= renderLimit; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context 不可用');
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      imgs.push(`<div class="pdf-page"><div class="pdf-page-num">第 ${i} / ${totalPages} 页</div><img src="${canvas.toDataURL('image/png')}" alt="第${i}页" /></div>`);
    }

    const truncated = totalPages > PDF_MAX_PAGES;
    const tip = truncated
      ? `<div class="file-warn">📌 共 ${totalPages} 页,仅渲染前 ${PDF_MAX_PAGES} 页。完整 PDF 请用系统阅读器打开。</div>`
      : `<div class="file-warn" style="background:rgba(80,160,80,0.1);color:#2d9d5f">✅ 完整渲染 ${totalPages} 页</div>`;

    const html = `${tip}<div class="pdf-pages">${imgs.join('')}</div>`;
    const file = makeFile(
      name, ext, mimeType, bytes, undefined,
      html, 'local',
      truncated ? `PDF ${totalPages} 页,仅渲染前 ${PDF_MAX_PAGES} 页` : `PDF ${totalPages} 页`
    );

    // V49: 异步后台提取文字 + 切分 + 写 Dexie(让本地 PDF 可检索)
    indexLocalPdf(pdf, name, totalPages).catch(err => {
      console.warn('[file-opener] PDF 文字提取失败:', err);
    });

    return file;
  } catch (e: any) {
    console.error('[file-opener] PDF 渲染失败:', e);
    return makeFile(
      name, ext, mimeType, bytes, undefined,
      `<div class="file-error">
        <strong>⚠️ PDF 渲染失败</strong><br>
        错误:${escapeHtml(e?.message || String(e))}<br>
        类型:${escapeHtml(e?.name || '?')}<br>
        <p style="margin-top:8px;font-size:13px">💡 文件可能损坏或加密。请用 WPS / Adobe Acrobat 打开。</p>
      </div>`,
      'local',
      `PDF 渲染失败: ${e?.message || e}`
    );
  }
}

/** V49: 提取 PDF 所有页文字 → 切 chunk → 写 Dexie(让本地 PDF 可被 RAG 检索)
 *  - path = "📕 xxx.pdf#p{N}"(用 emoji 前缀区分 vault 笔记)
 *  - 后续 search() 默认不查本地文件,需在 chat settings 加 "📂 本地文件" KB 范围才查
 */
async function indexLocalPdf(pdf: any, name: string, totalPages: number): Promise<void> {
  try {
    const { saveChunks, saveChunkVectors } = await import('./db');
    const { chunkDocument, chunkHash } = await import('./chunker');
    const { embedText } = await import('./embedder');
    const pdfId = `📕 ${name}.pdf`;
    // 删旧(防止重复打开堆积)
    await saveChunks(pdfId, []);
    // 1) 提取所有页文字
    const allTextParts: string[] = [];
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getPageTextContent();
      const items = textContent.items || [];
      const pageText = items
        .map((it: any) => it.str || '')
        .filter((s: string) => s.trim())
        .join(' ');
      if (pageText.trim()) allTextParts.push(`\n\n## 第 ${i} 页\n\n${pageText}`);
    }
    const fullDoc = allTextParts.join('').trim();
    if (!fullDoc) {
      console.log('[file-opener] PDF 无可提取文字(可能是扫描版)');
      return;
    }
    console.log('[file-opener] PDF 文字提取完成,', fullDoc.length, '字');
    // 2) chunker 切分
    const chunks = chunkDocument(pdfId, fullDoc);
    // 3) 写 chunks
    const chunkRows = chunks.map(c => ({
      idx: c.idx,
      heading: c.heading || `第 1-${totalPages} 页`,
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      hash: chunkHash(c.content),
      mtime: Date.now(),
    }));
    await saveChunks(pdfId, chunkRows);
    // 4) 走 embedder 建向量索引
    const vecRows = chunks.map(c => {
      const vec = embedText(c.content);
      return {
        idx: c.idx,
        vec, dim: vec.length,
        hash: chunkHash(c.content),
        mtime: Date.now(),
      };
    });
    await saveChunkVectors(pdfId, vecRows);
    console.log('[file-opener] PDF 索引完成:', chunks.length, 'chunks');
  } catch (e) {
    console.warn('[file-opener] indexLocalPdf 失败:', e);
  }
}

/* === V50: EPUB 入库(轻量渲染 + 后台索引) ===
 * 不做分章渲染(canvas 在 WebView 渲染 zip 解析开销大),
 * 只展示"已加入 KB 索引"提示 + 后台解析 OEBPS 抽文字走 chunker
 */
async function renderEpub(
  name: string,
  ext: string,
  mimeType: string,
  bytes: Uint8Array
): Promise<OpenedFile> {
  console.log('[file-opener] EPUB 开始解析, size=', bytes.byteLength, 'name=', name);
  // 后台 fire-and-forget 索引(不阻塞返回,失败只 console.warn)
  indexLocalEpub(bytes, name).catch(err => {
    console.warn('[file-opener] EPUB 索引失败:', err);
  });
  // 展示提示
  const tip = `<div class="file-warn" style="background:rgba(80,160,200,0.1);color:#2a7da8">
    📘 EPUB 已加入 KB 索引<br/>
    <span style="font-size:13px">不渲染分章(性能考虑),但纯文本已喂 chunker + embedder,<br/>
    在 chat 里勾"📂 本地文件"或选 📘 前缀路径即可检索。</span>
  </div>`;
  return makeFile(name, ext, mimeType, bytes, undefined, tip, 'local', 'EPUB 已索引');
}

/** V50: 解析 EPUB → 抽所有章节纯文本 → 切 chunk → 写 Dexie
 *  - path = "📘 xxx.epub"
 *  - 复用 indexLocalPdf 的 saveChunks + embedder + chunker 管线
 *  - 章节级容忍:单章失败 warn 跳过;全书失败 catch 不 throw
 *  - 空文本(图画书 / 加密)console.log 跳过
 */
async function indexLocalEpub(bytes: Uint8Array, name: string): Promise<void> {
  try {
    const { saveChunks, saveChunkVectors } = await import('./db');
    const { chunkDocument, chunkHash } = await import('./chunker');
    const { embedText } = await import('./embedder');
    const epubId = `📘 ${name}.epub`;

    // 1) JSZip 解 zip
    const zip = await JSZip.loadAsync(bytes);

    // 2) 读 META-INF/container.xml 找 rootfile
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) {
      console.warn('[file-opener] EPUB 缺少 META-INF/container.xml, 不是合法 EPUB');
      return;
    }
    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const rootfileEl = containerDoc.querySelector('rootfile');
    const opfPath = rootfileEl?.getAttribute('full-path');
    if (!opfPath) {
      console.warn('[file-opener] EPUB container.xml 没有 rootfile[full-path]');
      return;
    }
    console.log('[file-opener] EPUB OPF:', opfPath);

    // 3) 读 OPF
    const opfXml = await zip.file(opfPath)?.async('string');
    if (!opfXml) {
      console.warn('[file-opener] EPUB 找不到 OPF:', opfPath);
      return;
    }
    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

    // 4) 解析 manifest (id → { href, mediaType }) + spine (idref 顺序)
    const manifest = new Map<string, { href: string; mediaType: string }>();
    opfDoc.querySelectorAll('manifest > item').forEach(item => {
      const id = item.getAttribute('id') || '';
      const href = item.getAttribute('href') || '';
      const mediaType = item.getAttribute('media-type') || '';
      if (id && href) manifest.set(id, { href, mediaType });
    });
    const spineIds: string[] = [];
    opfDoc.querySelectorAll('spine > itemref').forEach(ir => {
      const idref = ir.getAttribute('idref');
      if (idref) spineIds.push(idref);
    });
    console.log('[file-opener] EPUB spine:', spineIds.length, '章');

    // OPF 路径作为 base,resolve 相对路径
    const opfBase = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    // 5) 按 spine 顺序遍历,只取 XHTML/HTML 章节
    const chapterParts: string[] = [];
    for (const id of spineIds) {
      const entry = manifest.get(id);
      if (!entry) continue;
      const mime = entry.mediaType.toLowerCase();
      // 只取 XHTML / HTML(image/css/octet-stream 跳过)
      if (!/(xhtml|html)$/.test(mime)) continue;
      // resolve 相对路径(用 POSIX 路径在 zip 里定位)
      const href = entry.href;
      const fullPath = href.startsWith('/') ? href.substring(1) : (opfBase + href);
      // EPUB zip 用 / 路径
      const zipPath = fullPath.replace(/\\/g, '/');
      try {
        const xhtml = await zip.file(zipPath)?.async('string');
        if (!xhtml) {
          console.warn('[file-opener] EPUB 章节 zip 读取失败:', zipPath);
          continue;
        }
        // 6) DOMParser 抽纯文本(用 text/html 兼容 XHTML 实体)
        const xhtmlDoc = new DOMParser().parseFromString(xhtml, 'text/html');
        const title = xhtmlDoc.querySelector('title')?.textContent?.trim()
                    || xhtmlDoc.querySelector('h1, h2, h3')?.textContent?.trim()
                    || entry.href.replace(/\.[xX]?[hH][tT][mM][lL]?$/, '');
        const body = xhtmlDoc.body;
        const text = body?.textContent?.trim() || '';
        if (!text) {
          console.log('[file-opener] EPUB 章节空文本,跳过:', entry.href);
          continue;
        }
        chapterParts.push(`\n\n## ${title}\n\n${text}`);
      } catch (chapterErr) {
        console.warn('[file-opener] EPUB 章节解析失败:', zipPath, chapterErr);
        // 单章节失败容忍,继续下个
      }
    }

    // 7) 拼接全文
    const fullDoc = chapterParts.join('').trim();
    if (!fullDoc) {
      console.log('[file-opener] EPUB 无可提取文字(可能是图画书/加密)');
      return;
    }
    console.log('[file-opener] EPUB 文字提取完成,', fullDoc.length, '字');

    // 8) 删旧 + chunker 切分 + 写 chunks
    await saveChunks(epubId, []);  // 清旧
    const chunks = chunkDocument(epubId, fullDoc);
    const chunkRows = chunks.map(c => ({
      idx: c.idx,
      heading: c.heading || 'EPUB',
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      hash: chunkHash(c.content),
      mtime: Date.now(),
    }));
    await saveChunks(epubId, chunkRows);

    // 9) 走 embedder 建向量索引
    const vecRows = chunks.map(c => {
      const vec = embedText(c.content);
      return {
        idx: c.idx,
        vec, dim: vec.length,
        hash: chunkHash(c.content),
        mtime: Date.now(),
      };
    });
    await saveChunkVectors(epubId, vecRows);
    console.log('[file-opener] EPUB 索引完成:', chunks.length, 'chunks');
  } catch (e) {
    console.warn('[file-opener] indexLocalEpub 失败:', e);
  }
}
