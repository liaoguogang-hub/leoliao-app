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
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

// V50.6: PDF.js 4.x worker 路径变了, 改用 ?url 方式; 4.x 默认主线程跑更稳
// V50.9: webview worker fetch 不稳 — 但 PDF.js 4.x 强制要 workerSrc,不能为空
// 恢复 workerSrc 指向 Vite 打包后的 worker URL (webview 应该能 fetch localhost)
// PDF.js 4.x 已知 issue: 必须有 worker,否则 throw
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl as unknown as string;

/** V50.11 debug: webview 直接调 renderPdf(跳过 FilePicker UI) */
export async function __debugRenderPdf(bytes: Uint8Array, name: string): Promise<OpenedFile> {
  return renderPdf(name, 'pdf', 'application/pdf', bytes);
}

// V50.11 debug: 暴露 renderPdf 等给 window 让 webview CDP 直接调用
(globalThis as any).__leoliaoDebug = {
  renderPdf: __debugRenderPdf,
};

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
  /** V52: PDF/EPUB 后台索引完成的 promise;非 PDF/EPUB 文件不设。
   *  - main.ts openLocalFile 等此 promise resolve 后调 loadLocalNotes(),
   *    让文件树搜索框能立即搜到刚生成的 📕/📘 xxx.md(不用重启/sync)
   *  - 内部已 catch 错误,调用方再 .catch 是 no-op 安全
   */
  indexingDone?: Promise<void>;
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
    console.log('[file-opener] PDF worker:', (pdfjsLib as any).GlobalWorkerOptions?.workerSrc);
    // PDF.js 要 ArrayBuffer
    const buffer = bytesToArrayBuffer(bytes);
    // V50.7: useWorkerFetch: false 强制主线程跑
    const loadingTask = pdfjsLib.getDocument({
      data: buffer,
      useWorkerFetch: false,
      isEvalSupported: true,
    } as any);
    loadingTask.onProgress = (p: any) => console.log('[file-opener] PDF load progress:', p.loaded, '/', p.total);
    // PDF.js 3.x 直接是 thenable (没有 .promise)
    const pdf: any = await (loadingTask as any).promise || await loadingTask;
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
      await page.render({ canvasContext: ctx, viewport } as any).promise;
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
    // V52: 把 indexing promise 挂到 file.indexingDone,主线程 openLocalFile
    // 会在它 resolve 后调 loadLocalNotes(),让文件树搜索框能搜到 📕 xxx.pdf.md
    file.indexingDone = indexLocalPdf(pdf, name, totalPages).catch(err => {
      console.warn('[file-opener] PDF 文字提取失败:', err);
    });

    return file;
  } catch (e: any) {
    console.error('[file-opener] PDF 渲染失败:', e);
    console.error('[file-opener] PDF error name:', e?.name, 'message:', e?.message, 'stack:', e?.stack?.substring(0, 500));
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
    // V50.14: name 已带 .pdf, 不再加
    const pdfId = `📕 ${name}`;
    // 删旧(防止重复打开堆积)
    await saveChunks(pdfId, []);
    // 1) 提取所有页文字
    const allTextParts: string[] = [];
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      // V50.13: PDF.js 3.x API: getTextContent (不是 6.x 的 getPageTextContent)
      const textContent = await (page as any).getTextContent();
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

    // V51: 自动存一份 md 进 vault — 让本地 PDF 出现在文件树 + 走 sync 上 OSS
    try {
      const { saveNote } = await import('./db');
      const now = Date.now();
      const notePath = `📕 ${name}.md`;
      // 切每页 + 总字数, 加 frontmatter 标记来自本地 PDF
      const noteContent = `---\nlocal-file: pdf\noriginal-name: ${name}\nchunks: ${chunks.length}\ntotal-chars: ${fullDoc.length}\n---\n\n# 📕 ${name}\n\n> 🤖 本地 PDF 自动入库(v1.10+)\n> 共 ${pdf.numPages} 页 / ${fullDoc.length} 字 / ${chunks.length} chunks\n> 原文:${name}.pdf\n\n${fullDoc}\n`;
      const hash = await (await import('./chunker')).chunkHash(noteContent);
      await saveNote(notePath, noteContent, now, hash);
      console.log('[file-opener] PDF vault note 已存:', notePath);
    } catch (noteErr) {
      console.warn('[file-opener] PDF vault note 失败:', noteErr);
    }
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
  // V52: 把 indexing promise 挂到 file.indexingDone,主线程 openLocalFile
  // 会在它 resolve 后调 loadLocalNotes(),让文件树搜索框能搜到 📘 xxx.epub.md
  // 展示提示
  const tip = `<div class="file-warn" style="background:rgba(80,160,200,0.1);color:#2a7da8">
    📘 EPUB 已加入 KB 索引<br/>
    <span style="font-size:13px">不渲染分章(性能考虑),但纯文本已喂 chunker + embedder,<br/>
    在 chat 里勾"📂 本地文件"或选 📘 前缀路径即可检索。</span>
  </div>`;
  const file = makeFile(name, ext, mimeType, bytes, undefined, tip, 'local', 'EPUB 已索引');
  // 后台 fire-and-forget 索引(不阻塞返回,失败只 console.warn)
  file.indexingDone = indexLocalEpub(bytes, name).catch(err => {
    console.warn('[file-opener] EPUB 索引失败:', err);
  });
  return file;
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
    // V50.14: name 已带 .epub, 不再加
    const epubId = `📘 ${name}`;

    // 1) JSZip 解 zip
    const zip = await JSZip.loadAsync(bytes);

    // V50.1 修复: webview build 里 Object.keys(zip.files) 返回的 key 是 toString'd 字符串
    // 形如 "77,69,84,65,45,73,78,70,..." (逗号分隔 ASCII 码) — 不是真实路径
    // 但 zip.file(rawKey) 仍然能正常工作(zip 内部用同一 hash 索引)
    // 用 rawKey 直接调 zip.file(),通过解码 rawKey 做文件名匹配
    const rawKeys = Object.keys((zip as any).files);
    const decodePath = (rawKey: string): string => {
      if (rawKey.includes(',')) {
        const codes = rawKey.split(',').map(s => parseInt(s, 10));
        return codes.filter(c => !isNaN(c) && c > 0 && c < 0x110000).map(c => String.fromCharCode(c)).join('');
      }
      return rawKey;
    };
    const allFileObjs: { raw: string; decoded: string; entry: any }[] = [];
    for (const raw of rawKeys) {
      const decoded = decodePath(raw);
      const entry = (zip as any).files[raw];
      if (!entry?.dir) allFileObjs.push({ raw, decoded, entry });
    }
    // 用 raw key 直接调 zip.file()(匹配 JSZip 内部 hash)
    // V50.1.3 webview JSZip async('string') 返回 toString'd 字符串 (逗号分隔 ASCII)
    // 改用 async('uint8array') + TextDecoder 解码
    const decodeUint8Array = (raw: any): string => {
      if (raw instanceof Uint8Array) return new TextDecoder('utf-8').decode(raw);
      if (typeof raw === 'string') {
        if (raw.includes(',') && raw.length > 5) {
          try {
            const codes = raw.split(',').map(s => parseInt(s.trim(), 10));
            if (codes.every(c => !isNaN(c) && c >= 0 && c < 0x110000)) {
              return codes.map(c => String.fromCharCode(c)).join('');
            }
          } catch {}
        }
        return raw;
      }
      return String(raw);
    };
    const findExact = (path: string) => allFileObjs.find(o => o.decoded === path) || null;
    const findCaseInsensitive = (path: string) => {
      const target = path.toLowerCase();
      return allFileObjs.find(o => o.decoded.toLowerCase() === target) || null;
    };
    const findBySuffix = (suffix: string) => {
      const target = suffix.toLowerCase();
      return allFileObjs.filter(o => o.decoded.toLowerCase().endsWith(target));
    };
    const readText = async (path: string): Promise<string | undefined> => {
      const obj = findExact(path) || findCaseInsensitive(path);
      if (!obj) return undefined;
      const entry = (zip as any).file(obj.raw);
      if (!entry) return undefined;
      try {
        const bytes = await entry.async('uint8array');
        return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        const s = await entry.async('string');
        return decodeUint8Array(s);
      }
    };

    // 2) 找 container.xml
    let containerXml: string | undefined;
    const containerObj = findExact('META-INF/container.xml') || findCaseInsensitive('META-INF/container.xml');
    if (containerObj) {
      try {
        const bytes = await (zip as any).file(containerObj.raw)?.async('uint8array');
        containerXml = bytes ? new TextDecoder('utf-8').decode(bytes) : undefined;
      } catch (e) {
        const s = await (zip as any).file(containerObj.raw)?.async('string');
        containerXml = s ? decodeUint8Array(s) : undefined;
      }
    }
    if (!containerXml) {
      const cands = findBySuffix('META-INF/container.xml');
      if (cands.length > 0) {
        try {
          const bytes = await (zip as any).file(cands[0].raw)?.async('uint8array');
          containerXml = bytes ? new TextDecoder('utf-8').decode(bytes) : undefined;
        } catch (e) {
          const s = await (zip as any).file(cands[0].raw)?.async('string');
          containerXml = s ? decodeUint8Array(s) : undefined;
        }
      }
    }
    if (!containerXml) {
      console.warn('[file-opener] EPUB 没有 META-INF/container.xml, 不是合法 EPUB. 实际文件数:', allFileObjs.length);
      return;
    }

    // 3) 解析 container.xml 找 OPF path
    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    // EPUB container.xml 是 namespaced: <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    let rootfileEl: Element | null = containerDoc.querySelector('rootfile');
    if (!rootfileEl) {
      rootfileEl = containerDoc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:container', 'rootfile')[0] || null;
    }
    if (!rootfileEl) {
      const all = containerDoc.querySelectorAll('*');
      for (const el of Array.from(all)) {
        if (el.localName === 'rootfile') { rootfileEl = el; break; }
      }
    }
    const opfPath = rootfileEl?.getAttribute('full-path') || undefined;
    if (!opfPath) {
      console.warn('[file-opener] EPUB container.xml 没有 rootfile[full-path]');
      return;
    }

    // 4) 读 OPF
    let opfXml: string | undefined;
    let opfActualPath: string | undefined;
    const opfObj = findExact(opfPath) || findCaseInsensitive(opfPath);
    if (opfObj) {
      opfActualPath = opfObj.decoded;
      try {
        const bytes = await (zip as any).file(opfObj.raw)?.async('uint8array');
        opfXml = bytes ? new TextDecoder('utf-8').decode(bytes) : undefined;
      } catch (e) {
        const s = await (zip as any).file(opfObj.raw)?.async('string');
        opfXml = s ? decodeUint8Array(s) : undefined;
      }
    }
    if (!opfXml) {
      console.warn('[file-opener] EPUB 找不到 OPF:', opfPath);
      return;
    }
    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

    // 5) 解析 manifest + spine (OPF 也是 namespaced,加 fallback)
    const manifest = new Map<string, { href: string; mediaType: string }>();
    let itemEls = Array.from(opfDoc.querySelectorAll('manifest > item'));
    if (itemEls.length === 0) itemEls = Array.from(opfDoc.getElementsByTagNameNS('http://www.idpf.org/2007/opf', 'item'));
    if (itemEls.length === 0) itemEls = Array.from(opfDoc.getElementsByTagName('item'));
    itemEls.forEach(item => {
      const id = item.getAttribute('id') || '';
      const href = item.getAttribute('href') || '';
      const mediaType = item.getAttribute('media-type') || '';
      if (id && href) manifest.set(id, { href, mediaType });
    });
    let itemrefEls = Array.from(opfDoc.querySelectorAll('spine > itemref'));
    if (itemrefEls.length === 0) itemrefEls = Array.from(opfDoc.getElementsByTagNameNS('http://www.idpf.org/2007/opf', 'itemref'));
    if (itemrefEls.length === 0) itemrefEls = Array.from(opfDoc.getElementsByTagName('itemref'));
    const spineIds: string[] = itemrefEls.map(ir => ir.getAttribute('idref') || '').filter(Boolean);
    console.log('[file-opener] EPUB 共', allFileObjs.length, '文件,', spineIds.length, '章');

    // 6) OPF 路径作为 base, resolve 相对路径
    const opfBase = opfActualPath && opfActualPath.includes('/')
      ? opfActualPath.substring(0, opfActualPath.lastIndexOf('/') + 1)
      : '';

    // 7) 按 spine 顺序遍历,只取 XHTML/HTML 章节
    const chapterParts: string[] = [];
    let chaptersIndexed = 0;
    for (const id of spineIds) {
      const entry = manifest.get(id);
      if (!entry) continue;
      const mime = entry.mediaType.toLowerCase();
      // V50.1.9 修: application/xhtml+xml 末尾是 xml 不是 html,regex 改成子串匹配
      if (!/(xhtml|html)/.test(mime)) continue;
      const href = entry.href;
      const fullPath = href.startsWith('/') ? href.substring(1) : (opfBase + href);
      const zipPath = fullPath.replace(/\\/g, '/');
      try {
        const xhtml = await readText(zipPath);
        if (!xhtml) {
          console.warn('[file-opener] EPUB 章节 zip 读取失败:', zipPath);
          continue;
        }
        const xhtmlDoc = new DOMParser().parseFromString(xhtml, 'text/html');
        const title = xhtmlDoc.querySelector('title')?.textContent?.trim()
                    || xhtmlDoc.querySelector('h1, h2, h3')?.textContent?.trim()
                    || entry.href.replace(/\.[xX]?[hH][tT][mM][lL]?$/, '');
        const body = xhtmlDoc.body;
        const text = body?.textContent?.trim() || '';
        if (!text) continue;
        chapterParts.push(`\n\n## ${title}\n\n${text}`);
        chaptersIndexed++;
      } catch (chapterErr) {
        console.warn('[file-opener] EPUB 章节解析失败:', zipPath, chapterErr);
      }
    }
    console.log('[file-opener] EPUB 索引章节:', chaptersIndexed, '/', spineIds.length);

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

    // V51: 自动存一份 md 进 vault
    try {
      const { saveNote } = await import('./db');
      const now = Date.now();
      const notePath = `📘 ${name}.md`;
      const noteContent = `---\nlocal-file: epub\noriginal-name: ${name}\nchunks: ${chunks.length}\ntotal-chars: ${fullDoc.length}\n---\n\n# 📘 ${name}\n\n> 🤖 本地 EPUB 自动入库(v1.10+)\n> 共 ${spineIds.length} 章 / 索引 ${chaptersIndexed} 章 / ${fullDoc.length} 字 / ${chunks.length} chunks\n> 原文:${name}.epub\n\n${fullDoc}\n`;
      const { chunkHash } = await import('./chunker');
      const hash = chunkHash(noteContent);
      await saveNote(notePath, noteContent, now, hash);
      console.log('[file-opener] EPUB vault note 已存:', notePath);
    } catch (noteErr) {
      console.warn('[file-opener] EPUB vault note 失败:', noteErr);
    }
  } catch (e) {
    console.warn('[file-opener] indexLocalEpub 失败:', e);
  }
}
