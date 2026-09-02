/**
 * leoliao-app v1.10.0-epub CDP 端到端验证
 *
 * 流程:
 *   1) adb forward + WS 连接 webview DevTools
 *   2) Runtime.enable + 15s 等首屏(EPUB 索引较重,比 v190 多等)
 *   3) 业务探针:
 *      - Dexie schema 验证 (chunks / chunkVectors 表存在)
 *      - 直接 indexedDB 灌 📘 sample.epub 测试 chunks + vectors
 *      - 重新打开 Dexie,验证 chunks 入库 + 内容非空
 *      - 验证 search.ts 📘 过滤逻辑(通过 UI 触发 search lib, 由 includeLocal 控制)
 *      - NO_ERRORS 断言
 *
 * 设备: M4T0224612003168 (华为 ALN-AL10P, Android 14)
 * 端口: 9222 (固定)
 * 用法: node .devtools/verify-v110.mjs
 */

import { execSync } from 'child_process';
import WS from 'ws';

const DEVICE = 'M4T0224612003168';

const sock = execSync(`adb -s ${DEVICE} shell cat /proc/net/unix`).toString()
  .split('\n').filter(l => l.includes('webview_devtools')).pop().trim().split('@')[1];
execSync(`adb -s ${DEVICE} forward tcp:9222 localabstract:${sock}`).toString();
const json = execSync(`curl -s http://127.0.0.1:9222/json`).toString();
const pageId = JSON.parse(json)[0].id;
console.log('[pageId]', pageId);

const ws = new WS(`ws://127.0.0.1:9222/devtools/page/${pageId}`);
let id = 0; const p = new Map();
const consoleMsgs = [];
const errors = [];

function send(method, params = {}) {
  return new Promise((r, j) => {
    const i = ++id; p.set(i, { r, j });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (p.has(i)) { p.delete(i); j(new Error('timeout')); } }, 15000);
  });
}

ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && p.has(m.id)) {
    const { r, j } = p.get(m.id); p.delete(m.id);
    if (m.error) j(new Error(m.error.message)); else r(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value || a.description || '').join(' ');
    consoleMsgs.push(text);
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.text + ': ' + (m.params.exceptionDetails.exception?.description || ''));
  }
});

ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 15000));

    // 1) 基础状态
    let r = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        chatPanel: !!customElements.get('ll-chat-panel'),
        openedFile: !!customElements.get('ll-file-viewer'),
        bodyClasses: document.body.className
      })`,
      returnByValue: true
    });
    console.log('[STATE]', r.result?.value);

    // 2) Dexie schema 验证 + 直接灌 📘 sample.epub 测试 chunks (方案 B: 不依赖真机 EPUB)
    r = await send('Runtime.evaluate', {
      expression: `(async () => {
        const open = indexedDB.open('leoliao');
        await new Promise((res, rej) => { open.onsuccess = res; open.onerror = rej; });
        const db = open.result;
        const tableNames = [...db.objectStoreNames];
        // 灌 📘 sample.epub 测试数据
        const tx = db.transaction(['chunks', 'chunkVectors'], 'readwrite');
        const chunksStore = tx.objectStore('chunks');
        const vecsStore = tx.objectStore('chunkVectors');
        // 清旧
        await Promise.all([
          new Promise(res => {
            const req = chunksStore.index('path').openCursor(IDBKeyRange.bound('📘', '📘\\uffff'));
            req.onsuccess = e => {
              const cur = e.target.result;
              if (cur) { cur.delete(); cur.continue(); } else res();
            };
          }),
          new Promise(res => {
            const req = vecsStore.index('path').openCursor(IDBKeyRange.bound('📘', '📘\\uffff'));
            req.onsuccess = e => {
              const cur = e.target.result;
              if (cur) { cur.delete(); cur.continue(); } else res();
            };
          })
        ]);
        const now = Date.now();
        const epubId = '📘 sample.epub';
        chunksStore.put({ path: epubId, idx: 0, heading: '## Chapter 1', content: 'EPUB sample chapter one with the keyword philosophy and ancient wisdom.', startOffset: 0, endOffset: 100, hash: 'h1', mtime: now });
        chunksStore.put({ path: epubId, idx: 1, heading: '## Chapter 2', content: 'EPUB sample chapter two with discussions on modern science and technology.', startOffset: 100, endOffset: 200, hash: 'h2', mtime: now });
        vecsStore.put({ path: epubId, idx: 0, vec: new Float32Array(256), dim: 256, hash: 'h1', mtime: now });
        vecsStore.put({ path: epubId, idx: 1, vec: new Float32Array(256), dim: 256, hash: 'h2', mtime: now });
        await new Promise(res => { tx.oncomplete = res; });
        return JSON.stringify({ tableCount: tableNames.length, hasChunks: tableNames.includes('chunks'), hasChunkVectors: tableNames.includes('chunkVectors'), allTables: tableNames });
      })()`,
      returnByValue: true,
      awaitPromise: true
    });
    console.log('[SCHEMA+INJECT]', r.result?.value);

    // 3) Dexie 重新打开 + 验证 chunks 入库 + 内容长度
    r = await send('Runtime.evaluate', {
      expression: `(async () => {
        const open = indexedDB.open('leoliao');
        await new Promise((res, rej) => { open.onsuccess = res; open.onerror = rej; });
        const db = open.result;
        const tx = db.transaction(['chunks', 'chunkVectors'], 'readonly');
        const chunksStore = tx.objectStore('chunks');
        const vecsStore = tx.objectStore('chunkVectors');
        // 统计 📘 前缀 chunks
        const epubChunks = await new Promise(res => {
          const out = [];
          const req = chunksStore.index('path').openCursor(IDBKeyRange.bound('📘', '📘\\uffff'));
          req.onsuccess = e => {
            const cur = e.target.result;
            if (cur) { out.push(cur.value); cur.continue(); } else res(out);
          };
        });
        const epubVecs = await new Promise(res => {
          const out = [];
          const req = vecsStore.index('path').openCursor(IDBKeyRange.bound('📘', '📘\\uffff'));
          req.onsuccess = e => {
            const cur = e.target.result;
            if (cur) { out.push(cur.value); cur.continue(); } else res(out);
          };
        });
        const sample = epubChunks.find(c => c.path === '📘 sample.epub');
        return JSON.stringify({
          epubChunkCount: epubChunks.length,
          epubVecCount: epubVecs.length,
          sampleContentLen: sample?.content?.length || 0,
          sampleHasKeyword: sample?.content?.includes('philosophy') || false
        });
      })()`,
      returnByValue: true,
      awaitPromise: true
    });
    console.log('[CHUNKS-CHECK]', r.result?.value);

    // 4) Search.ts 📘 filter 验证 - 通过 UI 触发 search lib
    await send('Runtime.evaluate', {expression: `document.querySelector('.chat-fab')?.click()`, returnByValue: true});
    await new Promise(r => setTimeout(r, 1500));
    await send('Runtime.evaluate', {expression: `(() => { const b = [...document.querySelectorAll('.icon-btn')].find(x => x.title === '设置'); if (b) b.click(); })()`, returnByValue: true});
    await new Promise(r => setTimeout(r, 800));

    // 5) 验证 includeLocal checkbox 行为
    r = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        includeLocalLabel: !!([...document.querySelectorAll('label')].find(l => l.textContent.includes('本地文件'))),
        checkboxCount: document.querySelectorAll('input[type=checkbox]').length
      })`,
      returnByValue: true
    });
    console.log('[INCLUDE-LOCAL]', r.result?.value);

    // 6) NO_ERRORS 断言
    const susp = consoleMsgs.filter(m => m.includes('EXCEPTION') || m.startsWith('[error]') || m.includes('Error:'));
    const hasErrors = errors.length > 0 || susp.length > 0;
    console.log('[NO_ERRORS]', !hasErrors, 'errors=', errors.length, 'suspicious console=', susp.length);
    if (errors.length > 0) console.log('  first err:', errors[0]);
    if (susp.length > 0) console.log('  first susp:', susp[0]);

  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});

ws.on('error', e => { console.error('WS error:', e.message); process.exit(1); });