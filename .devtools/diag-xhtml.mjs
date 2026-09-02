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
    const r = await send('Runtime.evaluate', { expression: `(async () => {
      const open = indexedDB.open('leoliao');
      await new Promise((res, rej) => { open.onsuccess = res; open.onerror = rej; });
      const db = open.result;
      const tx = db.transaction(['chunks'], 'readonly');
      const store = tx.objectStore('chunks');
      // 通过 OPF 看实际 epub
      // 改思路: 直接通过 webview evaluate 读取 Object.keys(zip.files) 但需要重新触发
      // 替代: 让 webview 自己跑 JSZip 重新解析 — 但需要新 EPUB bytes
      // 最快: 通过 CDP Runtime.queryObjects 拿 window 上最近的 zip 实例
      // 简化: 看 console 历史里 "[file-opener] EPUB 共 60 文件"的 ALL 内容
      // 让我直接 queryObjects IndexedDB store paths — 看是不是有 📘 开头的
      const all = [];
      await new Promise(res => {
        const req = store.openCursor();
        req.onsuccess = e => { const cur = e.target.result; if (cur) { all.push(cur.value.path); cur.continue(); } else res(); };
      });
      const epubPaths = all.filter(p => p.startsWith('📘'));
      return JSON.stringify({ epubChunkCount: epubChunksCount(epubPaths), uniquePaths: [...new Set(epubPaths)] });
      function epubChunksCount(arr) { return arr.length; }
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[DEXIE-EPUB]', r.result?.value);
  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
