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
function send(method, params = {}) { return new Promise((r, j) => { const i = ++id; p.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (p.has(i)) { p.delete(i); j(new Error('timeout')); } }, 20000); }); }
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && p.has(m.id)) { const { r, j } = p.get(m.id); p.delete(m.id); if (m.error) j(new Error(m.error.message)); else r(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value || a.description || '').join(' ');
    consoleMsgs.push({ type: m.params.type, text });
  }
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 5000));

    // 1. 当前 opened file 状态
    let r = await send('Runtime.evaluate', { expression: `(() => {
      const fv = document.querySelector('ll-file-viewer');
      const html = fv?.shadowRoot?.querySelector('.file-content')?.innerHTML || fv?.shadowRoot?.innerHTML || 'NO file-viewer';
      const allEpub = document.body.innerText.match(/📘[^\s]*/g) || [];
      return JSON.stringify({
        hasFileViewer: !!fv,
        fileViewerHtmlLen: html.length,
        fileViewerHtmlSnippet: html.substring(0, 500),
        epubMentions: allEpub.slice(0, 5)
      });
    })()`, returnByValue: true });
    console.log('[FILE-VIEWER]', r.result?.value);

    // 2. Dexie 里所有 📘 前缀 chunks
    r = await send('Runtime.evaluate', { expression: `(async () => {
      const open = indexedDB.open('leoliao');
      await new Promise((res, rej) => { open.onsuccess = res; open.onerror = rej; });
      const db = open.result;
      const tx = db.transaction(['chunks', 'chunkVectors'], 'readonly');
      const chunksStore = tx.objectStore('chunks');
      const vecsStore = tx.objectStore('chunkVectors');
      const epubChunks = await new Promise(res => {
        const out = [];
        const req = chunksStore.index('path').openCursor(IDBKeyRange.bound('📘', '📘\uffff'));
        req.onsuccess = e => { const cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); };
      });
      const epubVecs = await new Promise(res => {
        const out = [];
        const req = vecsStore.index('path').openCursor(IDBKeyRange.bound('📘', '📘\uffff'));
        req.onsuccess = e => { const cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); };
      });
      const paths = [...new Set(epubChunks.map(c => c.path))];
      return JSON.stringify({
        epubChunkCount: epubChunks.length,
        epubVecCount: epubVecs.length,
        uniquePaths: paths,
        sampleContent: epubChunks[0]?.content?.substring(0, 200) || ''
      });
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[DEXIE]', r.result?.value);

    // 3. 所有 Dexie chunks 路径(看 PDF + EPUB + vault)
    r = await send('Runtime.evaluate', { expression: `(async () => {
      const open = indexedDB.open('leoliao');
      await new Promise((res, rej) => { open.onsuccess = res; open.onerror = rej; });
      const db = open.result;
      const tx = db.transaction(['chunks'], 'readonly');
      const store = tx.objectStore('chunks');
      const all = await new Promise(res => {
        const out = [];
        const req = store.openCursor();
        req.onsuccess = e => { const cur = e.target.result; if (cur) { out.push(cur.value.path); cur.continue(); } else res(out); };
      });
      const pdfPaths = all.filter(p => p.startsWith('📕'));
      const epubPaths = all.filter(p => p.startsWith('📘'));
      const otherPaths = all.filter(p => !p.startsWith('📕') && !p.startsWith('📘'));
      return JSON.stringify({
        total: all.length,
        pdfCount: pdfPaths.length, pdfSamples: [...new Set(pdfPaths)].slice(0, 3),
        epubCount: epubPaths.length, epubSamples: [...new Set(epubPaths)].slice(0, 3),
        otherCount: otherPaths.length, otherSamples: [...new Set(otherPaths)].slice(0, 5)
      });
    })()`, returnByValue: true, awaitPromise: true });
    console.log('[ALL-CHUNKS]', r.result?.value);

    // 4. console 里 [file-opener] EPUB 相关日志
    console.log('[CONSOLE-MESSAGES]', consoleMsgs.length, 'total');
    consoleMsgs.filter(m => /file-opener|EPUB|indexLocal/.test(m.test.text)).forEach(m => {
      console.log('  [' + m.type + ']', m.text.substring(0, 200));
    });

  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
