import { execSync } from 'child_process';
import WS from 'ws';

// 1) forward
execSync(`adb -s M4T0224612003168 forward tcp:9222 localabstract:webview_devtools_remote_22913`).toString();

// 2) 拿 pageId
const json = execSync(`curl -s http://127.0.0.1:9222/json`).toString();
const pageId = JSON.parse(json)[0].id;
console.log('[pageId]', pageId);

const ws = new WS(`ws://127.0.0.1:9222/devtools/page/${pageId}`);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const reqId = ++id;
    pending.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ id: reqId, method, params }));
    setTimeout(() => {
      if (pending.has(reqId)) {
        pending.delete(reqId);
        reject(new Error('CDP timeout: ' + method));
      }
    }, 5000);
  });
}

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});

ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 4000));

    // 1) FAB
    let r = await send('Runtime.evaluate', { expression: `document.querySelector('.chat-fab') ? 'yes' : 'no'`, returnByValue: true });
    console.log('[FAB]', r.result.value);

    // 2) 点 FAB
    r = await send('Runtime.evaluate', { expression: `(()=>{const f=document.querySelector('.chat-fab');if(f){f.click();return 'clicked';}return 'no';})()`, returnByValue: true });
    console.log('[CLICK-FAB]', r.result.value);
    await new Promise(r => setTimeout(r, 1500));

    // 3) modal UI
    r = await send('Runtime.evaluate', { expression: `JSON.stringify({
      modalExists:!!document.querySelector('.chat-modal'),
      sidebar:!!document.querySelector('.chat-sidebar'),
      sessionItems:document.querySelectorAll('.chat-session-item').length,
      firstTitle:document.querySelector('.chat-session-title')?.textContent?.trim(),
      newBtn:!!document.querySelector('.btn-new-session'),
      renameBtn:!!document.querySelector('.btn-rename'),
      deleteBtn:!!document.querySelector('.btn-delete-session'),
      sendBtn:!!document.querySelector('.btn-send'),
      textarea:!!document.querySelector('.chat-input textarea')
    })`, returnByValue: true });
    console.log('[MODAL-UI]', r.result.value);

    // 4) 新建会话
    r = await send('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector('.btn-new-session');if(b){b.click();return 'clicked';}return 'no';})()`, returnByValue: true });
    console.log('[CLICK-NEW]', r.result.value);
    await new Promise(r => setTimeout(r, 800));
    r = await send('Runtime.evaluate', { expression: `document.querySelectorAll('.chat-session-item').length`, returnByValue: true });
    console.log('[SESSIONS-AFTER-NEW]', r.result.value);

    // 5) 输入 + 发送
    r = await send('Runtime.evaluate', { expression: `(()=>{const ta=document.querySelector('.chat-input textarea');if(ta){ta.value='你好';ta.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';}return 'no';})()`, returnByValue: true });
    console.log('[INPUT]', r.result.value);
    await new Promise(r => setTimeout(r, 300));
    r = await send('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector('.btn-send');if(b&&!b.disabled){b.click();return 'sent';}return 'disabled';})()`, returnByValue: true });
    console.log('[SEND]', r.result.value);
    await new Promise(r => setTimeout(r, 2000));

    // 6) After send: stop btn + msg
    r = await send('Runtime.evaluate', { expression: `JSON.stringify({
      stopBtn:!!document.querySelector('.btn-stop'),
      msgCount:document.querySelectorAll('.chat-msg').length,
      streaming:!!document.querySelector('.chat-msg-streaming'),
      errMsg:document.querySelector('.err')?.textContent
    })`, returnByValue: true });
    console.log('[AFTER-SEND]', r.result.value);

  } catch (e) {
    console.error('[CDP ERR]', e.message);
  }
  ws.close();
  process.exit(0);
});