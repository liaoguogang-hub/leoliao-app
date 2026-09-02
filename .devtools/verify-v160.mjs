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
  if(m.id&&p.has(m.id)){const{r,j}=p.get(m.id);p.delete(m.id);if(m.error)j(new Error(merror.message));else r(m.result);}
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r=>setTimeout(r,10000));  // 等 sync + chunk

    // 1) 状态
    let r = await send('Runtime.evaluate', {expression: `JSON.stringify({chatPanel:!!customElements.get('ll-chat-panel')})`, returnByValue: true});
    console.log('[STATE]', r.result?.value);

    // 2) 打开 chat
    await send('Runtime.evaluate', {expression: `document.querySelector('.chat-fab')?.click()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,1500));

    // 3) 打开设置
    await send('Runtime.evaluate', {expression: `(()=>{const b=[...document.querySelectorAll('.icon-btn')].find(x=>x.title==='设置');if(b)b.click();})()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,800));

    // 4) 看 memory 设置区
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({legend:document.querySelector('fieldset legend')?.textContent,enabledCheckbox:!!document.querySelector('fieldset input[type=checkbox]'),injectCheckbox:!!document.querySelectorAll('fieldset input[type=checkbox]')[1],viewBtn:!![...document.querySelectorAll('fieldset .modal-btn')].find(b=>b.textContent.includes('查看记忆')),exportBtn:!![...document.querySelectorAll('fieldset .modal-btn')].find(b=>b.textContent.includes('导出'))})`, returnByValue: true});
    console.log('[MEMORY-SETTINGS]', r.result?.value);

    // 5) 点 "查看记忆主题"
    await send('Runtime.evaluate', {expression: `(()=>{const btn=[...document.querySelectorAll('fieldset .modal-btn')].find(b=>b.textContent.includes('查看记忆'));if(btn){btn.click();return 'clicked';}return 'no';})()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,1500));

    // 6) 看 memory panel
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({panelExists:!!document.querySelector('.modal-box h2') && document.querySelector('.modal-box h2').textContent.includes('长期记忆'),topicCount:document.querySelectorAll('.memory-topic').length,emptyText:document.querySelector('.path-picker-empty')?.textContent?.trim()})`, returnByValue: true});
    console.log('[MEMORY-PANEL]', r.result?.value);

    // 7) 模拟插入一个 memory topic（直接调 Dexie）
    r = await send('Runtime.evaluate', {expression: `(async()=>{
      try {
        const dexie = (await import('/assets/'+([...document.querySelectorAll('script[src]')].find(s=>s.src.includes('index-')&&s.src.endsWith('.js'))||{src:''}).src.split('/').pop())).default;
        // Dexie is not directly accessible
        return 'no-direct-dexie';
      } catch(e) { return 'ERR:'+e.message; }
    })()`, returnByValue: true, awaitPromise: true});
    console.log('[DEXIE-CHECK]', r.result?.value);

  } catch(e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});