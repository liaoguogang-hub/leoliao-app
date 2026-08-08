/**
 * 本地文件打开服务 — V33
 * 支持:md / html / htm / txt / 图片(jpg/png/webp/gif) / docx
 *
 * 流程:
 *   1. FilePicker 调 Android SAF,返回 content:// URI
 *   2. CapacitorHttp.get({ url: uri, responseType: 'blob' }) 读字节
 *   3. 按扩展名分发到对应渲染器
 *
 * pptx 不做(无客户端方案)
 *
 * V39:新增 renderBytesToHtml(history 快照恢复)— 用历史里存的 Uint8Array 重新打开
 */

import { FilePicker, PickedFile } from '@capawesome/capacitor-file-picker';
import DOMPurify from 'dompurify';
import mammoth from 'mammoth';
import MarkdownIt from 'markdown-it';

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
        return makeFile(
          name, ext, mimeType, bytes, undefined,
          `<div class="file-warn">📕 PDF 渲染尚未支持,请用 WPS 打开</div>`,
          'local',
          'PDF 暂不支持'
        );
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
