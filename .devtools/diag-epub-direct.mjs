import { execSync } from 'child_process';
import WS from 'ws';
const DEVICE = 'M4T0224612003168';
const sock = execSync(`adb -s ${DEVICE} shell cat /proc/net/unix`).toString().split('\n').filter(l => l.includes('webview_devtools')).pop().trim().split('@')[1];
execSync(`adb -s ${DEVICE} forward tcp:9222 localabstract:${sock}`);
const json = execSync(`curl -s http://127.0.0.1:9222/json`).toString();
const pageId = JSON.parse(json)[0].id;
const ws = new WS(`ws://127.0.0.1:9222/devtools/page/${pageId}`);
let id = 0; const p = new Map();
const consoleMsgs = [];
function send(method, params = {}) { return new Promise((r, j) => { const i = ++id; p.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (p.has(i)) { p.delete(i); j(new Error('timeout')); } }, 60000); }); }
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && p.has(m.id)) { const { r, j } = p.get(m.id); p.delete(m.id); if (m.error) j(new Error(m.error.message)); else r(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value || a.description || '').join(' ');
    consoleMsgs.push(text);
  }
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 8000)); // app 重启 + 同步
    
    // 1. 检查 window 上有没有暴露 indexLocalEpub 或类似函数
    const r1 = await send('Runtime.evaluate', { expression: `JSON.stringify({
      hasFileOpener: !!window.fileOpener,
      fileOpenerKeys: window.fileOpener ? Object.keys(window.fileOpener) : [],
      hasIndexLocal: typeof window.indexLocalEpub
    })`, returnByValue: true });
    console.log('[WINDOW-EXPORTS]', r1.result?.value);
    
    // 2. 直接通过 Capacitor Filesystem 读 /sdcard/test.epub → Uint8Array → 调 JSZip 看 zip 内容
    const r2 = await send('Runtime.evaluate', { expression: `(async () => {
      const cap = window.Capacitor?.Plugins;
      if (!cap) return JSON.stringify({err: 'no Capacitor.Plugins'});
      // 1) Filesystem readFile
      try {
        const r = await cap.Filesystem.readFile({ path: 'test.epub', directory: 'EXTERNAL_STORAGE' });
        const data = r.data;
        const bytes = (typeof data === 'string') ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new Uint8Array(data);
        // 2) JSZip
        const mod = await import('/assets/' + [...document.scripts].map(s => s.src).find(s => s.includes('index-') && s.endsWith('.js')).split('/').pop());
        const JSZip = mod.JSZip || mod.default?.JSZip;
        if (!JSZip) return JSON.stringify({err: 'no JSZip', keys: Object.keys(mod).filter(k => /zip/i.test(k))});
        const zip = await JSZip.loadAsync(bytes);
        const all = [];
        zip.forEach((p, e) => { if (!e.dir) all.push(p); });
        const containerXml = await zip.file('META-INF/container.xml')?.async('string');
        const mimetype = await zip.file('mimetype')?.async('string');
        return JSON.stringify({
          ok: true,
          byteLen: bytes.length,
          totalFiles: all.length,
          first10: all.slice(0, 10),
          hasContainer: !!containerXml,
          containerLen: containerXml?.length || 0,
          mimetype: mimetype
        });
      } catch (e) {
        return JSON.stringify({err: String(e), msg: e?.message, stack: e?.stack?.substring(0, 500)});
      }
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[JSZIP-DIRECT]', r2.result?.value);

  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
