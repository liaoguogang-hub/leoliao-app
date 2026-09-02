import { execSync } from 'child_process';
import WS from 'ws';

const sock = execSync(`adb -s M4T0224612003168 shell cat /proc/net/unix`).toString()
  .split('\n').filter(l => l.includes('webview_devtools')).pop().trim().split('@')[1];
execSync(`adb -s M4T0224612003168 forward tcp:9222 localabstract:${sock}`).toString();
const json = execSync(`curl -s http://127.0.0.1:9222/json`).toString();
const pageId = JSON.parse(json)[0].id;
console.log('[pageId]', pageId);

const ws = new WS(`ws://127.0.0.1:9222/devtools/page/${pageId}`);
let id = 0; const p = new Map();
function send(method, params={}){return new Promise((r,j)=>{const i=++id;p.set(i,{r,j});ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(p.has(i)){p.delete(i);j(new Error('timeout'))}},10000);});}
ws.on('message', d=>{
  const m=JSON.parse(d.toString());
  if(m.id&&p.has(m.id)){const{r,j}=p.get(m.id);p.delete(m.id);if(m.error)j(new Error(m.error.message));else r(m.result);}
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r=>setTimeout(r,10000));

    // 1) 基础
    let r = await send('Runtime.evaluate', {expression: `JSON.stringify({chatPanel:!!customElements.get('ll-chat-panel')})`, returnByValue: true});
    console.log('[STATE]', r.result?.value);

    // 2) 打开 chat + 设置
    await send('Runtime.evaluate', {expression: `document.querySelector('.chat-fab')?.click()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,1500));
    await send('Runtime.evaluate', {expression: `(()=>{const b=[...document.querySelectorAll('.icon-btn')].find(x=>x.title==='设置');if(b)b.click();})()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,800));

    // 3) 看 "包含本地文件" checkbox
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({includeLocalLabel:!![...document.querySelectorAll('label')].find(l=>l.textContent.includes('本地文件')),includeLocalChecked:[...document.querySelectorAll('input[type=checkbox]')].some(c=>c.parentElement?.textContent.includes('本地文件'))})`, returnByValue: true});
    console.log('[INCLUDE-LOCAL]', r.result?.value);

  } catch(e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});