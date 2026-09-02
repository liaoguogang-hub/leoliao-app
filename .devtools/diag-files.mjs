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
    await new Promise(r => setTimeout(r, 2000));
    // 让 webview 列举最近一次 EPUB 解析的全部文件名 (60 个) — 通过 Runtime.evaluate 直接调 JSZip
    // 但我们没保留 bytes,只能用 console message buffer 里的最近 60 个文件
    // 改思路: 触发一个全新的 file-open, 但用户已开过了
    // 替代: 我们重新调 FilePicker,选 test.epub
    // 太复杂,简化: 看 console message 全文(messages 不止 Array(10),而是真实字符串)
    const r = await send('Runtime.evaluate', { expression: `(() => {
      // 找 console message buffer 里的 EPUB 60 文件列表(通过 Runtime.queryObjects 拿不到)
      // 直接通过 webview DOM 看 file-viewer 当前 html
      const fv = document.querySelector('ll-file-viewer');
      const html = fv?.shadowRoot?.innerHTML || '';
      return JSON.stringify({ fileViewerHtmlLen: html.length });
    })()`, returnByValue: true });
    console.log('[FV]', r.result?.value);
    // 这次我们重新打开 EPUB:通过 FilePicker.pickFiles trigger (但需要 user 交互)
    // 简化: 我们让 webview 重新构造一个 test 触发 JSZip
    // 但 EPUB bytes 在 file-opener 完成后被释放...
    // 终极方案:在 webview 里 fetch test.epub bytes (Capacitor.Filesystem) 然后调 JSZip
    const r2 = await send('Runtime.evaluate', { expression: `(async () => {
      // 用 capacitor scheme: capacitor://localhost/_capacitor_file_/storage/emulated/0/test.epub?appid=com.leoliao.app
      // 或 file:///storage/emulated/0/test.epub
      try {
        const r = await fetch('file:///storage/emulated/0/test.epub');
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // JSZip 探
        const mod = await import('/assets/' + [...document.scripts].map(s => s.src).find(s => s.includes('index-') && s.endsWith('.js')).split('/').pop());
        const JSZip = mod.JSZip || mod.default?.JSZip;
        if (!JSZip) return JSON.stringify({err: 'no JSZip'});
        const zip = await JSZip.loadAsync(bytes);
        const all = [];
        zip.forEach((p, e) => { if (!e.dir) all.push(p); });
        // 检查各种路径变体
        const tests = {
          'META-INF/container.xml': !!zip.file('META-INF/container.xml'),
          'meta-inf/container.xml': !!zip.file('meta-inf/container.xml'),
          'Meta-Inf/container.xml': !!zip.file('Meta-Inf/container.xml'),
          'mimetype': !!zip.file('mimetype'),
          'MIME': !!zip.file('MIME'),
        };
        return JSON.stringify({
          ok: true,
          byteLen: bytes.length,
          totalFiles: all.length,
          first20: all.slice(0, 20),
          metaInfFiles: all.filter(p => /meta/i.test(p)),
          opfFiles: all.filter(p => /\.opf$/i.test(p)),
          tests
        });
      } catch (e) {
        return JSON.stringify({err: String(e), msg: e?.message});
      }
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[JSZIP-PROBE]', JSON.stringify(r2.result?.value, null, 2));
  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
