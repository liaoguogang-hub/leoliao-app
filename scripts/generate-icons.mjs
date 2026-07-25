// 重做 Android 图标:完整保留中间圆角图标,整体缩小居中,系统蒙版只裁留白
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SRC = 'D:/leoliao-app/icons-preview/知识库.png';
const RES = 'D:/leoliao-app/android/app/src/main/res';
const BG = '#082858';                       // 自适应背景色(图标主色)
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const FG_SCALE = 0.72;                       // 图标在前景画布中占比(留 ~28% 边给蒙版)

// 以图标中心的固定正方形裁剪:完整含圆角图标 + 一点原图自然背景(无人工补色接缝)
// 图标经网格实测:水平 ~305..1750(中心 1027),垂直 ~425..1710(中心 1067)
async function detectBounds() {
  const cx = 1027, cy = 1067, side = 1470;
  return { left: Math.round(cx - side / 2), top: Math.round(cy - side / 2), width: side, height: side };
}

async function main() {
  const box = await detectBounds();
  console.log('检测到图标边界:', box);
  // 裁出完整图标,做成正方形(取较大边,居中补背景色以防非正方)
  const side = Math.max(box.width, box.height);
  const icon = await sharp(SRC).extract(box)
    .resize(side, side, { fit: 'contain', background: BG })
    .png().toBuffer();

  for (const [dpi, sz] of Object.entries(LAUNCHER)) {
    const dir = `${RES}/mipmap-${dpi}`;
    await mkdir(dir, { recursive: true });
    // legacy 方形:完整图标铺满(本身就是圆角图标)
    const square = await sharp(icon).resize(sz, sz).png().toBuffer();
    await sharp(square).toFile(`${dir}/ic_launcher.png`);
    // 圆形:蓝底 + 完整图标 76% 居中 → 圆形蒙版(图标完整不被切)
    const inner = Math.round(sz * 0.76);
    const roundBase = await sharp({ create: { width: sz, height: sz, channels: 4, background: BG } })
      .composite([{ input: await sharp(icon).resize(inner, inner).png().toBuffer(), gravity: 'center' }]).png().toBuffer();
    const circle = Buffer.from(`<svg width="${sz}" height="${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${sz / 2}" fill="#fff"/></svg>`);
    await sharp(roundBase).composite([{ input: circle, blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher_round.png`);
  }

  // 自适应前景:透明画布 + 完整图标 72% 居中(蒙版只裁四周留白/背景色)
  for (const [dpi, sz] of Object.entries(FOREGROUND)) {
    const dir = `${RES}/mipmap-${dpi}`;
    const inner = Math.round(sz * FG_SCALE);
    await sharp({ create: { width: sz, height: sz, channels: 4, background: '#00000000' } })
      .composite([{ input: await sharp(icon).resize(inner, inner).png().toBuffer(), gravity: 'center' }])
      .png().toFile(`${dir}/ic_launcher_foreground.png`);
  }
  console.log('✅ 图标重生成完成(完整保留 + 居中缩小),背景色', BG);
}
main().catch(e => { console.error(e); process.exit(1); });
