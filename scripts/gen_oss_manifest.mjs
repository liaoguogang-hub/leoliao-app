#!/usr/bin/env node
/**
 * gen_oss_manifest.mjs — 直接从 OSS 的 Obsidian/ 目录列出实际文件,重建 manifest.json
 *
 * 为什么需要它:
 *   md 文件由 Obsidian 插件直传到 OSS 的 Obsidian/ 目录,但插件不会生成 APK 需要的
 *   manifest.json。本脚本"以 OSS 实际内容为准"列出所有 .md,重建清单并上传回
 *   oss://liaoguogang/Obsidian/manifest.json。这样 APK 就能同步到所有(且仅)md。
 *
 * 前置:配置好 aliyun CLI 凭证(见文末),需要 oss:ListObjects + oss:PutObject 权限。
 *
 * 用法:
 *   node gen_oss_manifest.mjs --dry-run   # 只列举 + 本地写 manifest,不上传(先看数量)
 *   node gen_oss_manifest.mjs             # 列举 + 重建 + 上传到 OSS
 *
 * 凭证(任选一种,推荐 A,密钥不进命令行历史/不发给任何人):
 *   A) 在你自己的终端跑一次:  aliyun configure --profile leo-oss
 *      (依次输入 AccessKey ID / Secret / region=cn-shanghai / 输出格式 json)
 *      然后:  ALIYUN_PROFILE=leo-oss node gen_oss_manifest.mjs
 *   B) 临时环境变量:
 *      ALIYUN_ACCESS_KEY_ID=xxx ALIYUN_ACCESS_KEY_SECRET=yyy node gen_oss_manifest.mjs
 */

import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';

const BUCKET = 'oss://liaoguogang';
const PREFIX = (process.env.OSS_PREFIX || 'Obsidian').replace(/\/+$/, '');
const MANIFEST_KEY = `${PREFIX}/manifest.json`;
const REGION = process.env.ALIYUN_REGION || 'cn-shanghai';
const PROFILE = process.env.ALIYUN_PROFILE;
const AK_ID = process.env.ALIYUN_ACCESS_KEY_ID;
const AK_SECRET = process.env.ALIYUN_ACCESS_KEY_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!AK_ID && !AK_SECRET && !PROFILE) {
  console.error('💥 未配置凭证。请先 `aliyun configure --profile leo-oss` 再设 ALIYUN_PROFILE=leo-oss');
  console.error('   或用 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 环境变量。见脚本文件头注释。');
  process.exit(1);
}

function aliyun(args) {
  return new Promise((resolve, reject) => {
    const cred = [];
    if (AK_ID && AK_SECRET) cred.push('--access-key-id', AK_ID, '--access-key-secret', AK_SECRET, '--region', REGION);
    else if (PROFILE) cred.push('--profile', PROFILE);
    const child = spawn('aliyun', [...cred, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const outChunks = [], errChunks = [];
    child.stdout.on('data', d => outChunks.push(d));
    child.stderr.on('data', d => errChunks.push(d));
    child.on('error', e => reject(e));
    // 关键:收集 Buffer 后一次性按 UTF-8 解码。
    // 不能用 `out += d` —— 多字节汉字被切在 chunk 边界会解码成替换字符 �,损坏文件名。
    child.on('close', code => {
      const out = Buffer.concat(outChunks).toString('utf-8');
      const err = Buffer.concat(errChunks).toString('utf-8');
      return code === 0 ? resolve(out) : reject(new Error(`aliyun exit ${code}\n${err.slice(0, 600)}`));
    });
  });
}

/** 解析 `aliyun oss ls` 一行,提取 key/size/mtime/etag(以 oss:// 之后为对象名,前面倒数三列是 size/class/etag) */
function parseLine(line) {
  const i = line.indexOf(`${BUCKET}/`);
  if (i < 0) return null;
  const key = line.slice(i + BUCKET.length + 1).trim(); // 去掉 "oss://liaoguogang/"
  const cols = line.slice(0, i).trim().split(/\s+/);
  if (cols.length < 4) return null;
  const etag = cols[cols.length - 1];
  const size = parseInt(cols[cols.length - 3], 10);
  // datetime: 前面若干列拼成 "YYYY-MM-DD HH:MM:SS +0800"
  const dt = cols.slice(0, cols.length - 3);
  let mtime = 0;
  const m = dt.join(' ').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{4})?/);
  if (m) mtime = new Date(`${m[1]}T${m[2]}${m[3] || '+0800'}`).getTime();
  return { key, size: Number.isFinite(size) ? size : 0, mtime, etag };
}

function normHash(etag, size, mtime) {
  if (etag) {
    const h = etag.replace(/["']/g, '').toLowerCase();
    if (/^[0-9a-f]{32}(-\d+)?$/.test(h)) return h; // OSS ETag = 内容 MD5(单次上传)
  }
  return `s${size}-m${mtime}`; // 兜底:size+mtime 也能反映"变了没"
}

async function main() {
  console.log(`📡 列举 ${BUCKET}/${PREFIX}/ ...`);
  const raw = await aliyun(['oss', 'ls', `${BUCKET}/${PREFIX}/`]);
  const all = raw.split('\n').map(parseLine).filter(Boolean);

  const entries = [];
  for (const o of all) {
    if (o.key === MANIFEST_KEY) continue;               // 跳过 manifest 自己
    if (!o.key.toLowerCase().endsWith('.md')) continue; // 只要 md
    const rel = o.key.slice(PREFIX.length + 1);         // 去掉 "Obsidian/" 前缀 → APP 用的相对路径
    if (!rel) continue;
    entries.push({ path: rel, size: o.size, mtime: o.mtime, hash: normHash(o.etag, o.size, o.mtime) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  // 目录统计
  const byTop = {};
  for (const e of entries) {
    const top = e.path.includes('/') ? e.path.split('/')[0] : '(根)';
    byTop[top] = (byTop[top] || 0) + 1;
  }
  console.log(`\n✅ OSS 上共 ${all.length} 个对象,其中 md ${entries.length} 个`);
  console.log('顶层目录 → md 数:');
  for (const [k, v] of Object.entries(byTop).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);

  const tmp = `${process.env.TEMP || '/tmp'}/Obsidian-manifest-new.json`;
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  console.log(`\n📝 已写本地清单: ${tmp}`);

  if (DRY_RUN) {
    console.log('🔍 --dry-run:未上传。确认数量无误后去掉 --dry-run 再跑一次即可上传。');
    return;
  }

  console.log(`⬆️  上传到 ${BUCKET}/${MANIFEST_KEY} ...`);
  await aliyun(['oss', 'cp', tmp, `${BUCKET}/${MANIFEST_KEY}`, '-f']);
  try { await unlink(tmp); } catch {}
  console.log('✨ 完成!APK 里点"🔄 重新同步"即可拉到全部 md。');

  // 顺带重建开机欢迎图清单:列 welcome/ 下所有图片 → welcome/manifest.json
  // 这样你以后只需往 OSS welcome/ 丢图片,下次本脚本运行就会自动收录
  await regenWelcome();
}

/** 扫描 OSS welcome/ 下的图片,重建 welcome/manifest.json(供 APK 随机选开机图用) */
async function regenWelcome() {
  const WPREFIX = 'welcome';
  const WKEY = `${WPREFIX}/manifest.json`;
  try {
    const raw = await aliyun(['oss', 'ls', `${BUCKET}/${WPREFIX}/`]);
    const imgs = [];
    for (const line of raw.split('\n')) {
      const o = parseLine(line);
      if (!o) continue;
      if (o.key === WKEY) continue;                                  // 跳过清单自己
      if (!/\.(jpe?g|png|webp)$/i.test(o.key)) continue;             // 只要图片
      const name = o.key.slice(WPREFIX.length + 1);
      if (!name || name.includes('/')) continue;                     // 只收 welcome/ 直属文件
      imgs.push({ name, size: o.size, hash: normHash(o.etag, o.size, o.mtime) });
    }
    imgs.sort((a, b) => a.name.localeCompare(b.name));
    if (DRY_RUN) {
      console.log(`🖼️  welcome/ 图片 ${imgs.length} 张(dry-run 不上传)`);
      return;
    }
    const wtmp = `${process.env.TEMP || '/tmp'}/welcome-manifest-new.json`;
    await writeFile(wtmp, JSON.stringify(imgs, null, 2), 'utf-8');
    await aliyun(['oss', 'cp', wtmp, `${BUCKET}/${WKEY}`, '-f']);
    try { await unlink(wtmp); } catch {}
    console.log(`🖼️  已更新开机欢迎图清单:${imgs.length} 张`);
  } catch (e) {
    console.error('⚠️  重建 welcome 清单失败(不影响笔记同步):', e.message.split('\n')[0]);
  }
}

main().catch(e => { console.error('💥 失败:', e.message); process.exit(1); });
