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
    // 通过 Runtime.evaluate 在 webview 里 dump window 全局 + 找 JSZip 实例
    const r = await send('Runtime.evaluate', { expression: `(() => {
      // 试试从 import 拿 JSZip
      try {
        const allMods = Object.keys(window).filter(k => !k.startsWith('webkit') && !k.startsWith('chrome'));
        return JSON.stringify({ allWindowKeys: allMods.slice(0, 50) });
      } catch (e) { return JSON.stringify({err: String(e)}); }
    })()`, returnByValue: true });
    console.log('[WINDOW]', r.result?.value);
  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
