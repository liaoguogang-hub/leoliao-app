// 把"最近一次 openAndRead" 的 epub bytes 拿出来,看 zip 里有什么
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
    // 把 module JSZip 在 web 里加载,再用它探查样本 EPUB
    // 但我们没有 EPUB 字节可用——除非 file-opener 模块有缓存最近 bytes
    // 直接打印最近出错信息 + 全局 fileBytes 缓存
    const r = await send('Runtime.evaluate', { expression: `(async () => {
      // 检查 window 全局
      const keys = Object.keys(window).filter(k => /epub|file|bytes/i.test(k)).slice(0, 10);
      // 看看 IndexedDB 里是否存了最近 EPUB 字节(fileBytes/openedFiles 等)
      const allDBs = await indexedDB.databases();
      return JSON.stringify({ windowKeys: keys, allDBs: allDBs.map(d => d.name) });
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[INSPECT]', r.result?.value);

    // 关键测试:在 webview 里跑 JSZip,构造一个最小合法 EPUB(从 RFC 验证 JSZip 行为)
    const r2 = await send('Runtime.evaluate', { expression: `(async () => {
      // 用 dist 里的 JSZip (已通过 Vite 打包)
      const scriptSrcs = [...document.scripts].map(s => s.src);
      // 找含 jszip 的 chunk
      let jszipSrc = null;
      for (const s of scriptSrcs) {
        try {
          const r = await fetch(s);
          const t = await r.text();
          if (t.includes('JSZip')) { jszipSrc = s; break; }
        } catch (e) {}
      }
      return JSON.stringify({ jszipSrc, scriptCount: scriptSrcs.length });
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[JSZIP-CHUNK]', r2.result?.value);

  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
