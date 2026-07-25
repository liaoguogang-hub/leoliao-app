/**
 * 共享类型定义
 */

export interface ManifestEntry {
  path: string;       // vault 相对路径,如 "01.公众号/README.md"
  size: number;       // 字节
  mtime: number;       // 最后修改时间戳 ms
  hash: string;        // MD5，用于增量同步
}

export interface NoteFile {
  path: string;
  content: string;     // 原始 MD 文本
  html: string;        // markdown-it 渲染后的 HTML
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];     // [[wikilinks]] 提取
  mtime: number;
}

export interface CategoryNode {
  name: string;         // "01.公众号"
  path: string;         // "01.公众号"
  children: (CategoryNode | NoteRef)[];
  noteCount: number;
}

export interface NoteRef {
  type: 'note';
  path: string;
  title: string;
  size: number;
}

export type SyncSource = 'oss' | 'local' | 'mock';

export interface SyncStatus {
  source: SyncSource;
  total: number;
  synced: number;
  errors: string[];
  lastSync: number;
}