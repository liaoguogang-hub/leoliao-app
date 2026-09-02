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
function send(method, params = {}) { return new Promise((r, j) => { const i = ++id; p.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (p.has(i)) { p.delete(i); j(new Error('timeout')); } }, 30000); }); }
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
    await new Promise(r => setTimeout(r, 3000));
    console.log('=== file-opener 相关 ===');
    consoleMsgs.filter(m => /file-opener|EPUB|zip|mimetype|chapter/i.test(m)).forEach((m, i) => {
      console.log(`[${i}]`, m.substring(0, 500));
    });
    console.log('=== 最近 5 条 ===');
    consoleMsgs.slice(-5).forEach((m, i) => console.log(`[${i}]`, m.substring(0, 300)));
  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
