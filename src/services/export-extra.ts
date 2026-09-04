/**
 * v1.22.0 Phase X.1 — 导出能力扩展
 *
 * 新增导出形式:
 *   - exportConversation():把整个 chat session 导出为 Markdown
 *   - exportBook(prefix):把某文件夹的所有笔记导出为一本"小书"
 *   - exportJsonLd(prefix):JSON-LD 格式的结构化导出(知识图谱互联数据)
 */

import { db } from './db';
import { getChatHistory, listSessions } from './db';

export interface ConversationExport {
  sessionId: string;
  title: string;
  messages: Array<{ role: string; content: string; ts: number }>;
  exportedAt: number;
}

/**
 * 导出整个 chat session 为 Markdown
 */
export async function exportConversation(sessionId: string): Promise<string> {
  const messages = await getChatHistory(sessionId);
  const sessions = await listSessions();
  const sess = sessions.find(s => s.id === sessionId);
  const title = sess?.title || 'Unknown Session';

  const lines: string[] = [];
  lines.push(`# 💬 ${title}`);
  lines.push('');
  lines.push(`> 导出于 ${new Date().toLocaleString('zh-CN')} · ${messages.length} 条消息`);
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const m of messages) {
    const roleIcon = m.role === 'user' ? '👤' : m.role === 'assistant' ? '🤖' : '⚙️';
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(`## ${roleIcon} ${role}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 导出"小书":某文件夹下所有笔记拼成一本
 */
export async function exportBook(prefix: string): Promise<string> {
  const allNotes = await db().notes.toArray();
  const filtered = prefix
    ? allNotes.filter(n => n.path.startsWith(prefix + '/') || n.path === prefix)
    : allNotes;

  const lines: string[] = [];
  lines.push(`# 📖 小书:${prefix || '(whole vault)'}`);
  lines.push('');
  lines.push(`> ${filtered.length} 篇笔记 · 导出于 ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 按目录分组
  const byFolder = new Map<string, typeof filtered>();
  for (const n of filtered) {
    const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : '(root)';
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder)!.push(n);
  }

  for (const [folder, notes] of byFolder) {
    lines.push(`# 📁 ${folder}`);
    lines.push('');
    for (const n of notes) {
      const title = n.path.split('/').pop()?.replace(/\.md$/, '') || n.path;
      lines.push(`## ${title}`);
      lines.push('');
      lines.push(`> 来源: [[${n.path}]] · ${(n.content.length / 1024).toFixed(1)} KB`);
      lines.push('');
      lines.push('```');
      lines.push(n.content);
      lines.push('```');
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * JSON-LD 结构化导出(知识图谱的语义网标准格式)
 */
export async function exportJsonLd(prefix: string): Promise<string> {
  const allNotes = await db().notes.toArray();
  const filtered = prefix
    ? allNotes.filter(n => n.path.startsWith(prefix + '/') || n.path === prefix)
    : allNotes;

  const WIKILINK_RE = /\[\[([^\]\|]+?)(?:\|[^\]]*)?\]\]/g;
  const context = {
    '@vocab': 'https://leoliao.app/schema/',
    'schema': 'http://schema.org/',
    'path': { '@id': 'schema:url', '@type': '@id' },
    'title': 'schema:name',
    'tags': { '@id': 'schema:keywords' },
    'mtime': { '@id': 'schema:dateModified', '@type': 'schema:Date' },
  };

  const docs = filtered.map((n) => {
    const title = n.path.split('/').pop()?.replace(/\.md$/, '') || n.path;
    // 提取 wikilink
    const links: string[] = [];
    let m;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(n.content)) !== null) {
      const target = m[1].trim();
      if (target && !target.startsWith('!')) {
        links.push(target.toLowerCase().endsWith('.md') ? target : `${target}.md`);
      }
    }
    return {
      '@id': `leoliao:///${n.path}`,
      '@type': 'schema:Article',
      'path': `leoliao:///${n.path}`,
      'title': title,
      'mtime': new Date(n.mtime).toISOString(),
      'references': [...new Set(links)].map(l => `leoliao:///${l}`),
      'size': n.content.length,
    };
  });

  const jsonLd = {
    '@context': context,
    '@graph': docs,
  };
  return JSON.stringify(jsonLd, null, 2);
}

/**
 * 触发浏览器下载(纯前端)
 */
export function downloadAsFile(content: string, filename: string, mimeType = 'text/markdown') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
