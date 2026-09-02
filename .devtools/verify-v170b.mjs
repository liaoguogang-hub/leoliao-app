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
    await new Promise(r=>setTimeout(r,3000));

    // 关掉可能打开的其他 modal
    await send('Runtime.evaluate', {expression: `(()=>{document.querySelectorAll('.modal-overlay').forEach(o=>o.remove());document.querySelector('.chat-overlay')?.remove();})()`, returnByValue: true});

    // 1) 找 Wiki 按钮 + 点击
    await send('Runtime.evaluate', {expression: `(()=>{const btn=[...document.querySelectorAll('.toolbar-btn')].find(b=>b.textContent==='📖'||b.title?.includes('Wiki'));if(btn){btn.click();return 'clicked';}return 'no-btn';})()`, returnByValue: true});
    console.log('[CLICK]');
    await new Promise(r=>setTimeout(r,4000));

    // 2) 看 wiki-panel 是否出现
    let r = await send('Runtime.evaluate', {expression: `(()=>{
      const wp = document.querySelector('ll-wiki-panel');
      return JSON.stringify({
        wikiPanelExists:!!wp,
        modal:!!document.querySelector('.modal-box h2'),
        h2:document.querySelector('.modal-box h2')?.textContent,
        allH2:Array.from(document.querySelectorAll('.modal-box h2')).map(h=>h.textContent),
        statCards:document.querySelectorAll('.stat-card').length,
        statValues:Array.from(document.querySelectorAll('.stat-num')).map(n=>n.textContent.trim()),
      });
    })()`, returnByValue: true});
    console.log('[WIKI]', r.result?.value);

    console.log('---CONSOLE---');
    consoleMsgs.slice(0, 15).forEach(m => console.log(m));

  } catch(e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});