#!/usr/bin/env node
/**
 * verify-md-count.mjs — 一次性深度统计 OSS Obsidian/ 下到底有多少 md
 *
 * 对比 gen_oss_manifest.mjs 的口径,找出差异:
 *   - .md  (lowercase)        ← manifest 只数这个
 *   - .markdown               ← manifest 漏数!
 *   - .MD / .Md 等大小写      ← manifest 已 toLowerCase 应该都覆盖
 *   - 没有扩展名但内容像 md 的 ← 暂不深查
 *   - 多层子目录递归          ← manifest 已递归
 *
 * 输出到 stdout(一次性,不入 log)
 */

import { spawn } from 'node:child_process';

const BUCKET = 'oss://liaoguogang';
const PREFIX = 'Obsidian';
const PROFILE = process.env.ALIYUN_PROFILE || 'leo-oss';

function aliyun(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('aliyun', ['--profile', PROFILE, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [], err = [];
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    child.on('error', e => reject(e));
    child.on('close', code => {
      const o = Buffer.concat(out).toString('utf-8');
      const e = Buffer.concat(err).toString('utf-8');
      return code === 0 ? resolve(o) : reject(new Error(`exit ${code}\n${e.slice(0, 600)}`));
    });
  });
}

function parseLine(line, bucket) {
  const i = line.indexOf(`${bucket}/`);
  if (i < 0) return null;
  const key = line.slice(i + bucket.length + 1).trim();
  const cols = line.slice(0, i).trim().split(/\s+/);
  if (cols.length < 4) return null;
  const size = parseInt(cols[cols.length - 3], 10);
  return { key, size };
}

async function main() {
  console.log(`📡 列举 ${BUCKET}/${PREFIX}/ (ossutil 自动递归,无 -r flag)...`);
  // ossutil ls 默认递归
  const raw = await aliyun(['oss', 'ls', `${BUCKET}/${PREFIX}/`]);
  const all = raw.split('\n').map(l => parseLine(l, BUCKET)).filter(Boolean);
  console.log(`\n[总数] Obsidian/ 下对象: ${all.length}`);

  // 按扩展名分类
  const byExt = {};
  let noExt = 0;
  for (const o of all) {
    const m = o.key.match(/\.([^./]+)$/);
    if (m) {
      const ext = m[1].toLowerCase();
      byExt[ext] = (byExt[ext] || 0) + 1;
    } else {
      noExt++;
    }
  }
  console.log('\n[扩展名分布] (case-insensitive)');
  Object.entries(byExt).sort((a, b) => b[1] - a[1]).forEach(([ext, n]) => {
    console.log(`  .${ext.padEnd(10)} ${n}`);
  });
  console.log(`  (无扩展名)   ${noExt}`);

  // .md 详细分类
  const mdFiles = all.filter(o => o.key.toLowerCase().endsWith('.md'));
  const markdownFiles = all.filter(o => o.key.toLowerCase().endsWith('.markdown'));
  const uppercaseMd = all.filter(o => /\.MD$|\.Md$|\.mD$/.test(o.key));
  console.log('\n[md 详情]');
  console.log(`  .md        (manifest 口径):   ${mdFiles.length}`);
  console.log(`  .markdown  (manifest 漏数!):  ${markdownFiles.length}`);
  console.log(`  .MD/.Md/.mD (大小写奇怪):    ${uppercaseMd.length}`);

  // 按顶层目录
  console.log('\n[顶层目录 → md 数]');
  const mdByTop = {};
  for (const o of mdFiles) {
    const top = o.key.includes('/') ? o.key.split('/')[0] : '(根)';
    mdByTop[top] = (mdByTop[top] || 0) + 1;
  }
  Object.entries(mdByTop).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  });

  // 列出 manifest.json 里的数量(对比)
  try {
    const manifestRaw = await aliyun(['oss', 'cat', `${BUCKET}/${PREFIX}/manifest.json`]);
    const manifest = JSON.parse(manifestRaw);
    console.log(`\n[OSS manifest.json 里登记的 md 数]: ${manifest.length}`);
    console.log(`[本次直接列举 .md 数]:              ${mdFiles.length}`);
    console.log(`[差]: ${manifest.length - mdFiles.length} ${manifest.length === mdFiles.length ? '✅ 一致' : '⚠️  不一致!'}`);
  } catch (e) {
    console.log(`\n[读取 manifest.json 失败]: ${e.message.split('\n')[0]}`);
  }

  // 看 Obsidian/ 之外有没有 md(检查根 bucket)
  console.log('\n📡 列举 bucket 根目录...');
  const rootRaw = await aliyun(['oss', 'ls', `${BUCKET}/`]);
  const rootAll = rootRaw.split('\n').map(l => parseLine(l, BUCKET)).filter(Boolean);
  console.log(`[bucket 根目录] 对象数: ${rootAll.length}`);
  const rootDirs = rootAll.filter(o => o.key.endsWith('/')).map(o => o.key);
  console.log('[bucket 根目录的子目录]:');
  rootDirs.forEach(d => console.log(`  ${d}`));

  // 检查每个根目录子目录里有没有 md
  console.log('\n📡 检查每个根目录子目录的 md 数(找出 manifest 漏数的)...');
  const summary = [];
  for (const dir of rootDirs.filter(d => !d.startsWith(PREFIX + '/'))) {
    try {
      const r = await aliyun(['oss', 'ls', `${BUCKET}/${dir}`]);
      const items = r.split('\n').map(l => parseLine(l, BUCKET)).filter(Boolean);
      const md = items.filter(o => o.key.toLowerCase().endsWith('.md'));
      const md2 = items.filter(o => o.key.toLowerCase().endsWith('.markdown'));
      summary.push({ dir, total: items.length, md: md.length, markdown: md2.length });
    } catch (e) {
      summary.push({ dir, total: -1, md: -1, error: e.message.split('\n')[0] });
    }
  }
  summary.sort((a, b) => b.md - a.md);
  summary.forEach(s => {
    if (s.md > 0 || s.markdown > 0) {
      console.log(`  ${s.dir.padEnd(20)} 总 ${String(s.total).padStart(5)} | .md ${String(s.md).padStart(4)} | .markdown ${String(s.markdown).padStart(4)}`);
    }
  });
}

main().catch(e => { console.error('💥 失败:', e.message); process.exit(1); });
