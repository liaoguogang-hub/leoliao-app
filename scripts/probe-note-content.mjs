/**
 * V52.5 探测: dump IndexedDB notes 表里所有 📕*.md 的 content
 * 看 PDF.js 提取的文字本身就是否 mojibake
 */
import WebSocket from 'ws';
const [, , wsUrl] = process.argv;
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const myId = ++id; pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    // 用 indexedDB 直接读所有 notes 表
    const expr = `(async () => {
      // leoliao 用 Dexie,库名是 'leoliao-db' 或类似,先 list 所有 db
      const dbs = await indexedDB.databases();
      const dbsInfo = dbs.map(d => ({ name: d.name, version: d.version }));
      if (!dbs.length) return { error: 'no indexedDB databases', dbsInfo };

      // 找包含 notes 表的 db
      let dbName = null;
      for (const d of dbs) {
        try {
          const req = indexedDB.open(d.name);
          await new Promise((res, rej) => { req.onsuccess = () => res(); req.onerror = () => rej(); });
          const storeNames = Array.from(req.result.objectStoreNames);
          if (storeNames.includes('notes')) { dbName = d.name; req.result.close(); break; }
          req.result.close();
        } catch {}
      }
      if (!dbName) return { error: 'no db with notes store', dbsInfo };

      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(dbName);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const all = await new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();

      // 找 📕 惠民保 相关
      const filtered = all.filter(n => n.path?.includes('惠民保') || (n.path?.startsWith('📕 ') && n.content?.length > 100));
      return {
        dbName,
        totalNotes: all.length,
        filtered: filtered.map(n => ({
          path: n.path,
          contentLen: n.content?.length,
          hash: n.hash?.slice(0, 12),
          mtime: new Date(n.mtime).toISOString(),
          contentPreview: n.content?.slice(0, 400),
          contentHead200Hex: Array.from(n.content?.slice(0, 200) || '').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join(' '),
        })),
      };
    })()`;
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log(JSON.stringify(r.result.value, null, 2));
    ws.close();
  } catch (e) { console.error('err:', e.message); ws.close(); process.exit(1); }
});
ws.on('error', (e) => { console.error('ws err:', e.message); process.exit(1); });