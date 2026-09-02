/**
 * 本地 Mock LLM（OpenAI 兼容协议）— 真实端到端测试用
 *
 * 启动：node .devtools/mock-llm.mjs 9999
 * 配置：API URL = http://127.0.0.1:9999/v1  Model = mock-gpt  API Key = 任意
 *
 * 行为：
 *   - chat/completions (流式 + 非流式)
 *   - 自动注入 mock 回答（如果有 KB 检索内容，会回"KB 有 X 条参考"）
 *   - 自动 ping pong 一段对话
 */

import { createServer } from 'node:http';

const PORT = process.argv[2] || 9999;

const MOCK_RESPONSES = [
  {
    trigger: /(OpenAI|Claude|DeepSeek|MiniMax|GPT|API)/i,
    reply: '【mock】我看到你问了关于 LLM API 的问题。当前是 mock 模式，所以回答不会很准。\n\n实际配置步骤：\n1. 在 chat 设置里选 provider（OpenAI/DeepSeek/MiniMax/Anthropic）\n2. 填入对应 URL + API Key\n3. 测试连接 → 没问题就能对话了\n\n参考来源：[[#1]] [[#2]]',
  },
  {
    trigger: /(你好|hi|hello|在吗)/i,
    reply: '【mock】你好！我是个测试 LLM，对话链路通了。要测联网搜就把 v1-M2 开关打开。',
  },
];

function pickReply(messages) {
  const last = messages[messages.length - 1];
  const text = last?.content || '';
  for (const r of MOCK_RESPONSES) {
    if (r.trigger.test(text)) return r.reply;
  }
  return `【mock】收到你的问题：「${text.slice(0, 80)}${text.length > 80 ? '...' : ''}」\n\n这是一个 mock 响应，证明完整链路通：\n1) UI 发送\n2) RAG 检索（当前 vault 1216 篇笔记，正常）\n3) 流式响应渲染\n4) 引用卡片展示\n\n如果开了联网搜，会再加一段 Web#1 #2。\n参考来源：[[#1]] [[#2]]`;
}

function fakeChunks(reply, model) {
  //  按"句子/短语"切，模拟真实流式
  const tokens = [];
  const re = /([\s\S]{1,8})/g;
  let m;
  while ((m = re.exec(reply))) tokens.push(m[1]);
  return tokens;
}

const server = createServer((req, res) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${req.method} ${req.url}`);
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mock: 'llm', port: PORT }));
    return;
  }
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404); res.end('not found'); return;
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let req2;
    try { req2 = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const stream = req2.stream !== false;
    const reply = pickReply(req2.messages);
    const tokens = fakeChunks(reply);
    if (stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      const id = 'chatcmpl-' + Date.now();
      // 第一个 chunk 给 role
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: req2.model || 'mock', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
      // 内容 chunks
      let i = 0;
      const interval = setInterval(() => {
        if (i >= tokens.length) {
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: req2.model || 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write(`data: [DONE]\n\n`);
          res.end();
          clearInterval(interval);
          return;
        }
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: req2.model || 'mock', choices: [{ index: 0, delta: { content: tokens[i] }, finish_reason: null }] })}\n\n`);
        i++;
      }, 80);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now()/1000),
        model: req2.model || 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: reply.length, total_tokens: 200 },
      }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-llm] 监听 0.0.0.0:${PORT}`);
  console.log(`[mock-llm] 健康检查：http://127.0.0.1:${PORT}/health`);
  console.log(`[mock-llm] 端点：http://127.0.0.1:${PORT}/v1/chat/completions`);
});
