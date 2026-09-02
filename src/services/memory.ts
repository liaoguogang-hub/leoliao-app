/**
 * V46: 长期记忆引擎
 *
 * 作用:从对话中自动提取用户偏好 / 事实 / 引用,作为长期记忆
 * 下次对话时可被 system prompt 引用,让 LLM 知道"用户是谁"
 *
 * 触发:用户每次发问后,后台跑一次 extractFromConversation()
 * - 调 LLM 一次,问"这段对话里有没有用户偏好 / 个人事实可记忆?"
 * - 解析 JSON,创建 memory_topics + memory_items
 *
 * 配置:由 settings.memory.enabled 控制总开关
 */

import { chatOnce, type ChatMessage, type LLMSettings } from '../lib/llm';
import {
  listMemoryTopics, createMemoryTopic, getMemoryTopicWithItems,
  type MemoryTopicRow,
} from './db';

const EXTRACT_PROMPT = `你是记忆提取助手。分析下面这段用户和助手的对话,提取**值得长期记住**的内容。

返回 JSON(严格按格式,无废话):
{
  "topics": [
    {
      "title": "用户偏好:X",
      "summary": "用户习惯用 X 做 Y",
      "items": [
        { "kind": "pref", "content": "用户偏好具体描述" },
        { "kind": "fact", "content": "用户的某个事实" }
      ]
    }
  ]
}

规则:
- 只记**跨对话有价值**的内容(用户偏好、个人事实、长期目标)
- 不记临时问题答案("今天天气"、"2+2=几")
- 不记对话自身的元信息("用户问了 X 问题")
- topic 数量 ≤ 3,items 总数 ≤ 6
- 如果对话没值得记的,返回 {"topics": []}

对话:
{conversation}`;

/** 从单次对话提取记忆(LLM 调用 1 次) */
export async function extractFromConversation(
  messages: ChatMessage[],
  settings: LLMSettings,
  sessionId?: string
): Promise<MemoryTopicRow[]> {
  if (!settings.apiKey) return [];
  const conversation = messages
    .filter(m => m.role !== 'system')
    .slice(-6)   // 取最近 6 轮
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join('\n\n');
  const prompt = EXTRACT_PROMPT.replace('{conversation}', conversation);
  let responseText = '';
  try {
    responseText = await chatOnce([{ role: 'user', content: prompt }], {
      ...settings,
      maxTokens: 1024,
      temperature: 0.3,
    });
  } catch (e) {
    console.warn('[memory] extract failed', e);
    return [];
  }
  // 解析 JSON(可能包在 ```json ... ```)
  const m = responseText.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/);
  const json = m ? (m[1] || m[2]) : responseText;
  let parsed: { topics?: any[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('[memory] JSON parse failed', responseText.slice(0, 200));
    return [];
  }
  if (!parsed.topics || !Array.isArray(parsed.topics)) return [];
  const created: MemoryTopicRow[] = [];
  for (const t of parsed.topics.slice(0, 3)) {
    if (!t.title || !Array.isArray(t.items) || t.items.length === 0) continue;
    const items = t.items
      .filter((it: any) => it.content)
      .slice(0, 6)
      .map((it: any) => ({
        kind: it.kind || 'fact',
        content: String(it.content).slice(0, 200),
        source: sessionId,
      }));
    if (items.length === 0) continue;
    try {
      const topic = await createMemoryTopic(
        String(t.title).slice(0, 80),
        String(t.summary || '').slice(0, 500),
        items,
        sessionId
      );
      created.push(topic);
    } catch (e) {
      console.warn('[memory] createTopic failed', e);
    }
  }
  return created;
}

/** 把现有记忆格式化成 system prompt 片段 */
export async function buildMemoryPrompt(): Promise<string> {
  const topics = await listMemoryTopics();
  if (topics.length === 0) return '';
  const lines: string[] = ['## 长期记忆'];
  for (const t of topics.slice(0, 10)) {
    const { items } = (await getMemoryTopicWithItems(t.id))!;
    lines.push(`### ${t.title}`);
    lines.push(t.summary);
    for (const it of items.slice(0, 4)) {
      lines.push(`- [${it.kind}] ${it.content}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 导出全部记忆为 markdown */
export async function exportMemoryMarkdown(): Promise<string> {
  const { topics, items } = await (await import('./db')).exportAllMemory();
  if (topics.length === 0) return '# 长期记忆\n\n(暂无)\n';
  const lines: string[] = ['# 长期记忆', '', `导出时间: ${new Date().toISOString()}`, ''];
  for (const t of topics) {
    const tItems = items.filter(i => i.topicId === t.id);
    lines.push(`## ${t.title}`);
    lines.push(`*${t.summary}*`);
    lines.push('');
    for (const it of tItems) {
      lines.push(`- **${it.kind}**: ${it.content}${it.source ? ` _(source: ${it.source})_` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}