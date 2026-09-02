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
    await new Promise(r=>setTimeout(r,10000));  // 等 sync + chunk

    // 1) ll-wiki-panel 注册
    let r = await send('Runtime.evaluate', {expression: `JSON.stringify({wikiPanel:!!customElements.get('ll-wiki-panel'),allComponents:Array.from(customElements.keys()).filter(k=>k.startsWith('ll-'))})`, returnByValue: true});
    console.log('[COMPS]', r.result?.value);

    // 2) 点 Wiki 按钮
    r = await send('Runtime.evaluate', {expression: `(()=>{const btn=[...document.querySelectorAll('.toolbar-btn')].find(b=>b.title?.includes('Wiki')||b.title?.includes('主页'));if(btn){btn.click();return 'clicked';}return 'no-btn';})()`, returnByValue: true});
    console.log('[CLICK-WIKI]', r.result?.value);
    await new Promise(r=>setTimeout(r,2500));  // 等 wiki panel 加载 + stats 跑完

    // 3) Wiki panel 状态
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({modal:!!document.querySelector('.modal-box h2'),h2:document.querySelector('.modal-box h2')?.textContent,statCards:document.querySelectorAll('.stat-card').length,recentItems:document.querySelectorAll('.wiki-recent-item').length,tagDetails:document.querySelectorAll('.wiki-tag').length,searchInput:!!document.querySelector('.wiki-search-row input')})`, returnByValue: true});
    console.log('[WIKI-PANEL]', r.result?.value);

    // 4) 选笔记 → 看 backlinks
    await send('Runtime.evaluate', {expression: `(()=>{const f=document.querySelectorAll('.tree .file')[0];if(f){f.click();return 'clicked';}return 'no';})()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,2000));
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({noteTitle:document.querySelector('.note-title')?.textContent,backlinksFooter:!!document.querySelector('.backlinks-footer'),linkRefs:document.querySelectorAll('.link-ref').length,backLinkRefs:document.querySelectorAll('.backlink-ref').length})`, returnByValue: true});
    console.log('[NOTE-VIEW]', r.result?.value);

    // 看 console
    if (consoleMsgs.length) {
      console.log('---CONSOLE---');
      consoleMsgs.filter(m => m.toLowerCase().includes('wiki') || m.toLowerCase().includes('error') || m.includes('[EX]')).slice(0,8).forEach(m => console.log(m));
    }

  } catch(e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});