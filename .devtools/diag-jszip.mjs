import { execSync } from 'child_process';
import WS from 'ws';
const DEVICE = 'M4T0224612003168';
const sock = execSync(`adb -s ${DEVICE} shell cat /proc/net/unix`).toString().split('\n').filter(l => l.includes('webview_devtools')).pop().trim().split('@')[1];
execSync(`adb -s ${DEVICE} forward tcp:9222 localabstract:${sock}`);
const json = execSync(`curl -s http://127.0.0.1:9222/json`).toString();
const pageId = JSON.parse(json)[0].id;
const ws = new WS(`ws://127.0.0.1:9222/devtools/page/${pageId}`);
let id = 0; const p = new Map();
function send(method, params = {}) { return new Promise((r, j) => { const i = ++id; p.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (p.has(i)) { p.delete(i); j(new Error('timeout')); } }, 30000); }); }
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && p.has(m.id)) { const { r, j } = p.get(m.id); p.delete(m.id); if (m.error) j(new Error(m.error.message)); else r(m.result); }
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    // 1. fetch EPUB bytes (Capacitor 不会暴露 /sdcard 直接读取, 走 FileReader via input)
    // 替代:用 Capacitor.Filesystem 读 /sdcard/test.epub → base64
    const r = await send('Runtime.evaluate', { expression: `(async () => {
      try {
        const { Filesystem } = await import('/assets/' + [...document.scripts].map(s => s.src).find(s => s.includes('index-') && s.endsWith('.js')).split('/').pop());
        // 不对,filesystem plugin 是 web runtime 才有
      } catch (e) {}
      // 直接 fetch() Capacitor 静态资源不行—— /sdcard 需要 native bridge
      // 换思路:模拟一个文件选择 → bytes
      // 改用 Capacitor Filesystem.readFile
      const capFilesystem = window.Capacitor?.Plugins?.Filesystem;
      if (!capFilesystem) return JSON.stringify({err: 'no Capacitor Filesystem plugin'});
      try {
        const result = await capFilesystem.readFile({ path: 'file:///sdcard/test.epub' });
        const bytes = (typeof result.data === 'string') ? Uint8Array.from(atob(result.data), c => c.charCodeAt(0)) : new Uint8Array(result.data);
        return JSON.stringify({ ok: true, byteLen: bytes.length });
      } catch (e) {
        return JSON.stringify({ err: String(e), msg: e?.message });
      }
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[READ-FILE]', r.result?.value);

    // 2. 如果上面成功,用 JSZip 探测
    const r2 = await send('Runtime.evaluate', { expression: `(async () => {
      const capFilesystem = window.Capacitor?.Plugins?.Filesystem;
      if (!capFilesystem) return JSON.stringify({err: 'no FS plugin'});
      const result = await capFilesystem.readFile({ path: 'file:///sdcard/test.epub' });
      const bytes = (typeof result.data === 'string') ? Uint8Array.from(atob(result.data), c => c.charCodeAt(0)) : new Uint8Array(result.data);
      const JSZip = window.JSZip || (await import('/assets/' + [...document.scripts].map(s => s.src).find(s => s.includes('index-') && s.endsWith('.js')).split('/').pop())).JSZip || (await import('/assets/' + [...document.scripts].map(s => s.src).find(s => s.includes('index-') && s.endsWith('.js')).split('/').pop())).default?.JSZip;
      if (!JSZip) return JSON.stringify({err: 'no JSZip in window/module', keys: Object.keys(window).filter(k => /zip/i.test(k))});
      const zip = await JSZip.loadAsync(bytes);
      // 列出所有文件
      const allFiles = [];
      zip.forEach((path, entry) => {
        if (!entry.dir) allFiles.push(path);
      });
      // 检查关键文件
      const containerXml = await zip.file('META-INF/container.xml')?.async('string');
      const mimetype = await zip.file('mimetype')?.async('string');
      const caseInsensitive = allFiles.filter(p => p.toLowerCase().includes('container.xml') || p.toLowerCase().includes('mimetype'));
      return JSON.stringify({
        totalFiles: allFiles.length,
        first10: allFiles.slice(0, 10),
        hasContainer: !!containerXml,
        containerLen: containerXml?.length || 0,
        hasMimetype: !!mimetype,
        mimetypeContent: mimetype,
        caseInsensitiveMatches: caseInsensitive
      });
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[JSZIP-PROBE]', r2.result?.value);

  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
