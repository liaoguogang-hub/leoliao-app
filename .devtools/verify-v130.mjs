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
function send(m, pa={}){return new Promise((r,j)=>{const i=++id;p.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:pa}));setTimeout(()=>{if(p.has(i)){p.delete(i);j(new Error('timeout'))}},8000);});}
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
    await new Promise(r=>setTimeout(r,8000)); // 等同步

    // 1) 基础
    let r = await send('Runtime.evaluate', {expression: `JSON.stringify({fileTree:!!document.querySelector('ll-file-tree'),noteView:!!document.querySelector('ll-note-view'),toolbarNewBtn:!![...document.querySelectorAll('.toolbar-btn')].find(b=>b.textContent.includes('➕')),files:document.querySelectorAll('.tree .file').length})`, returnByValue: true});
    console.log('[STATE]', r.result?.value);

    // 2) 模拟右键触发 ctx-menu(用 dispatchEvent)
    r = await send('Runtime.evaluate', {expression: `(()=>{const f=document.querySelector('.tree .file');if(!f)return 'no-file';const evt=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:50,clientY:200});f.dispatchEvent(evt);return 'dispatched';})()`, returnByValue: true});
    console.log('[CTX-DISPATCH]', r.result?.value);
    await new Promise(r=>setTimeout(r,500));

    // 3) 看 ctx-menu 是否出现
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({ctxMenu:!!document.querySelector('.ctx-menu'),menuItems:document.querySelectorAll('.ctx-menu-item').length,menuText:Array.from(document.querySelectorAll('.ctx-menu-item')).map(b=>b.textContent.trim())})`, returnByValue: true});
    console.log('[CTX-MENU]', r.result?.value);

    // 4) 关闭 ctx-menu(点空白)
    await send('Runtime.evaluate', {expression: `document.body.click()`, returnByValue: true});

    // 5) 选第一个文件 → 打开 → 看 edit 按钮
    r = await send('Runtime.evaluate', {expression: `(()=>{const f=document.querySelector('.tree .file');if(f){f.click();return 'clicked';}return 'no-file';})()`, returnByValue: true});
    console.log('[OPEN-NOTE]', r.result?.value);
    await new Promise(r=>setTimeout(r,2000));

    // 6) 看 edit 按钮
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({noteView:!!document.querySelector('ll-note-view'),editBtn:!!document.querySelector('.note-btn.edit'),title:document.querySelector('.note-title')?.textContent?.trim()})`, returnByValue: true});
    console.log('[NOTE-OPENED]', r.result?.value);

    // 7) 点 edit
    r = await send('Runtime.evaluate', {expression: `(()=>{const b=document.querySelector('.note-btn.edit');if(b){b.click();return 'clicked';}return 'no-btn';})()`, returnByValue: true});
    console.log('[EDIT]', r.result?.value);
    await new Promise(r=>setTimeout(r,1000));

    // 8) 看 textarea
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({editing:!!document.querySelector('.note.editing'),textarea:!!document.querySelector('.note-editor-textarea'),toolbar:document.querySelectorAll('.tb-btn').length,saveBtn:!!document.querySelector('.note-btn.save'),cancelBtn:!!document.querySelector('.note-btn.cancel'),preview:!!document.querySelector('.note-preview')})`, returnByValue: true});
    console.log('[EDIT-MODE]', r.result?.value);

    // 9) 在 textarea 输入
    r = await send('Runtime.evaluate', {expression: `(()=>{const ta=document.querySelector('.note-editor-textarea');if(ta){const v=ta.value+'\\n## V43 edit test';ta.value=v;ta.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';}return 'no';})()`, returnByValue: true});
    console.log('[INPUT]', r.result?.value);
    await new Promise(r=>setTimeout(r,500));

    // 10) 点 save
    r = await send('Runtime.evaluate', {expression: `(()=>{const b=document.querySelector('.note-btn.save');if(b&&!b.disabled){b.click();return 'clicked';}return 'disabled';})()`, returnByValue: true});
    console.log('[SAVE]', r.result?.value);
    await new Promise(r=>setTimeout(r,1500));

    // 11) 看保存结果
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({editing:!!document.querySelector('.note.editing'),notice:document.querySelector('.notice-msg')?.textContent,preview:!!document.querySelector('.note-preview')})`, returnByValue: true});
    console.log('[AFTER-SAVE]', r.result?.value);

    // 12) 看 + 新笔记按钮
    r = await send('Runtime.evaluate', {expression: `(()=>{const btns=[...document.querySelectorAll('.toolbar-btn')];const b=btns.find(x=>x.textContent.includes('➕'));if(b){b.click();return 'clicked';}return 'no-btn';})()`, returnByValue: true});
    console.log('[NEW-NOTE]', r.result?.value);
    await new Promise(r=>setTimeout(r,800));

    // 13) 看新建 modal
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({modal:!!document.querySelector('.modal-box'),title:document.querySelector('.modal-box h2')?.textContent,pathInput:!!document.querySelector('#v43-path-input'),templateSelect:!!document.querySelector('#v43-tpl-select')})`, returnByValue: true});
    console.log('[NEW-MODAL]', r.result?.value);

    // 看 console
    if (consoleMsgs.length) {
      console.log('---CONSOLE---');
      consoleMsgs.slice(0, 10).forEach(m => console.log(m));
    }

  } catch(e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});