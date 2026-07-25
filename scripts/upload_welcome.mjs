#!/usr/bin/env node
/**
 * upload_welcome.mjs — 把开机欢迎图(已去水印)压缩上传到 OSS 的 welcome/ 目录
 *   - 源:D:/leoliao-app/开机欢迎图/去水印/*.png
 *   - 压成 1080 宽 JPEG(便于手机下载缓存)
 *   - 上传到 oss://liaoguogang/welcome/welcome-NN.jpg
 *   - 生成并上传 welcome/manifest.json(APK 靠它知道有哪些图)
 *
 * 用法:ALIYUN_PROFILE=leo-oss node upload_welcome.mjs
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const BUCKET = 'oss://liaoguogang';
const PREFIX = 'welcome';
const SRC_DIR = 'D:/leoliao-app/开机欢迎图/去水印';
const TMP = (process.env.TEMP || '/tmp') + '/welcome-upload';
const PROFILE = process.env.ALIYUN_PROFILE;
const AK_ID = process.env.ALIYUN_ACCESS_KEY_ID, AK_SECRET = process.env.ALIYUN_ACCESS_KEY_SECRET;
const REGION = process.env.ALIYUN_REGION || 'cn-shanghai';

function aliyun(args) {
  return new Promise((resolve, reject) => {
    const cred = [];
    if (AK_ID && AK_SECRET) cred.push('--access-key-id', AK_ID, '--access-key-secret', AK_SECRET, '--region', REGION);
    else if (PROFILE) cred.push('--profile', PROFILE);
    const child = spawn('aliyun', [...cred, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const o = [], e = [];
    child.stdout.on('data', d => o.push(d)); child.stderr.on('data', d => e.push(d));
    child.on('error', reject);
    child.on('close', c => c === 0 ? resolve(Buffer.concat(o).toString('utf-8'))
      : reject(new Error(`aliyun exit ${c}\n${Buffer.concat(e).toString('utf-8').slice(0, 500)}`)));
  });
}

async function main() {
  await mkdir(TMP, { recursive: true });
  const files = (await readdir(SRC_DIR)).filter(f => /\.png$/i.test(f)).sort();
  console.log(`发现 ${files.length} 张源图`);
  const manifest = [];
  let n = 0;
  for (const f of files) {
    n++;
    const name = `welcome-${String(n).padStart(2, '0')}.jpg`;
    const local = `${TMP}/${name}`;
    await sharp(`${SRC_DIR}/${f}`).resize({ width: 1080 }).jpeg({ quality: 82 }).toFile(local);
    const buf = await readFile(local);
    const hash = createHash('md5').update(buf).digest('hex');
    manifest.push({ name, size: buf.length, hash });
    await aliyun(['oss', 'cp', local, `${BUCKET}/${PREFIX}/${name}`, '-f']);
    console.log(`  ↑ ${name}  ${(buf.length / 1024).toFixed(0)}KB`);
  }
  const mfLocal = `${TMP}/manifest.json`;
  await writeFile(mfLocal, JSON.stringify(manifest, null, 2), 'utf-8');
  await aliyun(['oss', 'cp', mfLocal, `${BUCKET}/${PREFIX}/manifest.json`, '-f']);
  console.log(`✨ 完成:上传 ${manifest.length} 张 + welcome/manifest.json`);
}
main().catch(e => { console.error('💥', e.message); process.exit(1); });
