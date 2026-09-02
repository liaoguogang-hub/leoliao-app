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
    await new Promise(r => setTimeout(r, 5000));

    // 1. 看 window 全局有没有暴露 indexLocalEpub / openLocalFile
    const r1 = await send('Runtime.evaluate', { expression: `JSON.stringify({
      hasFileOpener: !!window.fileOpener,
      keys: Object.keys(window).filter(k => /file|local|epub|index/i.test(k)).slice(0, 20)
    })`, returnByValue: true });
    console.log('[WINDOW]', r1.result?.value);

    // 2. 用 Capacitor.Http 从 /sdcard 读(用 file:// 协议)
    const r2 = await send('Runtime.evaluate', { expression: `(async () => {
      try {
        // Capacitor.Http 不支持 file://
        // 改用 fetch with capacitor:// scheme
        const cap = window.Capacitor?.Plugins;
        if (!cap?.Filesystem) return JSON.stringify({err: 'no Filesystem'});
        // 试试不同 directory
        const dirs = ['EXTERNAL_STORAGE', 'EXTERNAL', 'DOCUMENTS', 'DATA'];
        const results = {};
        for (const d of dirs) {
          try {
            const r = await cap.Filesystem.readFile({ path: 'test.epub', directory: d });
            const data = r.data;
            const bytes = (typeof data === 'string') ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new Uint8Array(data);
            results[d] = { ok: true, byteLen: bytes.length };
            if (bytes.length > 0) {
              // 立刻拿 JSZip 探
              const mod = await import('/assets/' + [...document.scripts].map(s => s.src).find(s => s.includes('index-') && s.endsWith('.js')).split('/').pop());
              const JSZip = mod.JSZip || mod.default?.JSZip;
              if (JSZip) {
                const zip = await JSZip.loadAsync(bytes);
                const all = [];
                zip.forEach((p, e) => { if (!e.dir) all.push(p); });
                const cXml = await zip.file('META-INF/container.xml')?.async('string');
                results[d].totalFiles = all.length;
                results[d].first10 = all.slice(0, 10);
                results[d].hasContainer = !!cXml;
                results[d].containerLen = cXml?.length || 0;
              }
            }
            break;
          } catch (e) {
            results[d] = { err: e?.message };
          }
        }
        return JSON.stringify(results);
      } catch (e) {
        return JSON.stringify({err: String(e)});
      }
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[PROBE]', r2.result?.value);

    // 3. 看 consoleMsgs (file-opener 相关)
    console.log('[CONSOLE]', consoleMsgs.filter(m => /file-opener|EPUB|JSZip|zip|mimetype/.test(m)).slice(0, 20));

  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
