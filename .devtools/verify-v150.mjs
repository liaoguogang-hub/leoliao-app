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

    // 1) 基础状态
    let r = await send('Runtime.evaluate', {expression: `JSON.stringify({chatPanel:!!customElements.get('ll-chat-panel'),chatFabs:document.querySelectorAll('.chat-fab').length})`, returnByValue: true});
    console.log('[STATE]', r.result?.value);

    // 2) 打开 chat modal
    await send('Runtime.evaluate', {expression: `document.querySelector('.chat-fab')?.click()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,1500));

    // 3) 打开设置面板
    await send('Runtime.evaluate', {expression: `(()=>{const b=[...document.querySelectorAll('.icon-btn')].find(x=>x.title==='设置');if(b)b.click();})()`, returnByValue: true});
    await new Promise(r=>setTimeout(r,800));

    // 4) 看 Agent 工具 toggle
    r = await send('Runtime.evaluate', {expression: `JSON.stringify({agentToggles:document.querySelectorAll('.tool-toggle').length,toggleLabels:Array.from(document.querySelectorAll('.tool-toggle span')).map(s=>s.textContent.trim()),agentToggleChecked:Array.from(document.querySelectorAll('.tool-toggle input')).map(c=>c.checked)})`, returnByValue: true});
    console.log('[AGENT-TOGGLES]', r.result?.value);

    // 5) 测 ReAct 解析 — 动态 import + 测试 parseToolCall
    r = await send('Runtime.evaluate', {expression: `(async()=>{
      try {
        const mod = await import('/assets/'+([...document.querySelectorAll('script[src]')].find(s=>s.src.includes('index-')&&s.src.endsWith('.js'))||{src:''}).src.split('/').pop());
        // 找到 runAgentReAct 用的辅助函数 — 它们在 chat-panel bundle 里
        // 直接通过字符串测试解析逻辑(模拟 parseToolCall)
        const sample = '<think>需要查河流</think><tool_call>{"name":"kb_search","args":{"query":"长江"}}</tool_call>\n';
        const re = /<tool_call>([\\s\\S]*?)<\\/tool_call>/;
        const m = sample.match(re);
        if(!m) return 'no-match';
        const parsed = JSON.parse(m[1]);
        return JSON.stringify({parsed, hasThought: true});
      } catch(e) { return 'ERR:'+e.message; }
    })()`, returnByValue: true, awaitPromise: true});
    console.log('[PARSE]', r.result?.value);

    // 6) 模拟 agentSteps 数据 → 看 UI 渲染
    r = await send('Runtime.evaluate', {expression: `(()=>{
      // 直接构造一段 assistant 消息带 agentSteps,挂到 chat 组件
      const panel = document.querySelector('ll-chat-panel');
      if(!panel) return 'no-panel';
      // 修改 internal messages state 不直接可访问 — 改用 force-update 不行
      // 简单看: 模拟点一下 send 输入+发送 (但没 LLM key 走不通)
      // 这里只检查 enabledTools 状态
      const enabledList = panel.enabledTools;
      return JSON.stringify({enabledToolsCount: enabledList?.length, enabledTools: enabledList});
    })()`, returnByValue: true});
    console.log('[ENABLED]', r.result?.value);

    // 看 console
    if (consoleMsgs.length) {
      console.log('---CONSOLE---');
      consoleMsgs.filter(m => m.toLowerCase().includes('error') || m.toLowerCase().includes('agent') || m.includes('[EX]')).slice(0,8).forEach(m => console.log(m));
    }

  } catch(e) { console.error('ERR:', e.message); }
  ws.close(); process.exit(0);
});