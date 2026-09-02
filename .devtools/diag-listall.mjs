import { execSync } from 'child_process';
import WS from 'ws';
const DEVICE = 'M4T0224612003168';
const sock = execSync(`adb -s ${DEVICE} shell cat /proc/net/unix`).toString().split('\n').filter(l => l.includes('webview_devtools')).pop().trim().split('@')[1];
execSync(`adb -s ${DEVICE} forward tcp:9222 localabstract:${sock}`);
const json = execSync(`curl -s http://127.0.0.1:9222/json`).toString();
const pageId = JSON.parse(json)[0].id;
const ws = new WS(`ws://127.0.0.1:9222/devtools/page/${pageId}`);
let id = 0; const p = new Map();
const allMessages = [];
function send(method, params = {}) { return new Promise((r, j) => { const i = ++id; p.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (p.has(i)) { p.delete(i); j(new Error('timeout')); } }, 30000); }); }
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && p.has(m.id)) { const { r, j } = p.get(m.id); p.delete(m.id); if (m.error) j(new Error(m.error.message)); else r(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled') {
    m.params.args.forEach(a => allMessages.push(a.value || a.description || ''));
  }
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 2000));
    // 现在 bytes 已经释放,我们要重新触发一次 file-open
    // 用 FilePicker 直接选 test.epub (但 FilePicker 走 native UI,无法 CDP 触发)
    // 替代:在 file-opener 模块已加载情况下,导出 indexLocalEpub 到 window — 但 module 被 minify,导出名变了
    // 终极方案: 重新 install app + 重启 + 让 user 再开一次 test.epub
    console.log('Already-triggered messages:');
    allMessages.filter(m => /file-opener|zip|EPUB|mimetype|container/i.test(m)).forEach((m, i) => console.log(`[${i}]`, m.substring(0, 400)));
    console.log('=== END ===');
  } catch (e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});
