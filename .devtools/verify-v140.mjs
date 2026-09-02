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
const consoleMsgs = [];
ws.on('message', d=>{
  const m=JSON.parse(d.toString());
  if(m.id&&p.has(m.id)){const{r,j}=p.get(m.id);p.delete(m.id);if(m.error)j(new Error(m.error.message));else r(m.result);}
  else if(m.method==='Runtime.consoleAPICalled'){const args=(m.params.args||[]).map(a=>a.value||a.description||'');consoleMsgs.push(`[${m.params.type}] ${args.join(' ')}`);}
  else if(m.method==='Runtime.exceptionThrown'){consoleMsgs.push(`[EX] ${m.params.exceptionDetails.text}`);}
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r=>setTimeout(r,10000));  // 等 sync + chunking

    // 1) 看 Dexie chunks
    let r = await send('Runtime.evaluate', {expression: `(async()=>{
      try {
        // @ts-ignore
        const Dexie = window.Dexie;
        const db = new Dexie('leoliao');
        db.version(6).stores({ chunks: '[path+idx], path' });
        await db.open();
        const count = await db.chunks.count();
        // 抽 1 个看看结构
        const sample = await db.chunks.limit(1).first();
        return JSON.stringify({ count, sample });
      } catch(e) { return 'ERR:'+e.message; }
    })()`, returnByValue: true, awaitPromise: true});
    console.log('[CHUNKS]', r.result?.value);

    // 2) 状态
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({llApp:!!document.querySelector('ll-app'),chatPanel:!!customElements.get('ll-chat-panel'),treeFiles:document.querySelectorAll('.tree .file').length})`, returnByValue: true});
    console.log('[STATE]', r.result?.value);

    // 3) 打开 chat
    await send('Runtime.evaluate', {expression: `document.querySelector('.chat-fab')?.click()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,1500));

    // 4) 打开设置面板
    await send('Runtime.evaluate', {expression: `(()=>{const b=[...document.querySelectorAll('.icon-btn')].find(x=>x.title==='设置');if(b)b.click();})()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,800));

    // 5) 看 KB 检索范围按钮
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({pathBtn:!!document.querySelector('.btn-path-pick'),pathBtnText:document.querySelector('.btn-path-pick')?.textContent?.trim()})`, returnByValue: true});
    console.log('[PATH-BTN]', r.result?.value);

    // 6) 点 path picker
    r = await send('Runtime.evaluate', {expression: `(()=>{const b=document.querySelector('.btn-path-pick');if(b){b.click();return 'clicked';}return 'no';})()`, returnByValue: true});
    console.log('[CLICK-PICKER]', r.result?.value);
    await new Promise(r=>setTimeout(r,800));

    // 7) 看 picker
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({modal:!!document.querySelector('.path-picker-list'),items:document.querySelectorAll('.path-picker-item').length,firstItem:document.querySelector('.path-picker-item span')?.textContent?.trim()})`, returnByValue: true});
    console.log('[PICKER]', r.result?.value);

    // 8) 选第一个 + 完成
    await send('Runtime.evaluate', {expression: `(()=>{const cb=document.querySelector('.path-picker-item input[type=checkbox]');if(cb)cb.click();})()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,300));
    r = await send('Runtime.evaluate', {expression: `(()=>{const btns=[...document.querySelectorAll('.modal-btn.primary')];const b=btns.find(x=>x.textContent.includes('完成'));if(b){b.click();return 'clicked';}return 'no';})()`, returnByValue: true});
    console.log('[PICKER-DONE]', r.result?.value);
    await new Promise(r=>setTimeout(r,800));

    // 9) 看范围是否更新
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({pathBtnText:document.querySelector('.btn-path-pick')?.textContent?.trim(),hintText:document.querySelector('.setting-hint')?.textContent?.trim().substring(0, 100)})`, returnByValue: true});
    console.log('[AFTER-PICK]', r.result?.value);

    // 异常
    console.log('---CONSOLE---');
    consoleMsgs.filter(m => m.toLowerCase().includes('chunk') || m.toLowerCase().includes('error') || m.includes('[EX]')).slice(0,10).forEach(m => console.log(m));

  } catch(e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});