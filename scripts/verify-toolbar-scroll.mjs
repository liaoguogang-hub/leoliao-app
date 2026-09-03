/**
 * V52.1 自动化验证:窄屏 WebView 工具栏 + 本地参考库文件名可滚动
 *
 * 跑法:
 *   1. cd D:\leoliao-app && npm run build
 *   2. node scripts/verify-toolbar-scroll.mjs
 *
 * 过程:
 *   - 起 http server 服 dist/
 *   - Playwright 用 iPhone SE (375x667) viewport 加载
 *   - 验证 toolbar-actions 可横向滚动露出 9 个按钮
 *   - 注入几条 fake 📕/📘 file 到 local-files-panel 验证长文件名可横向滑动
 *   - 失败时输出截图到 test-results/
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// 1) 起静态 server
const server = createServer(async (req, res) => {
  try {
    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';
    const filePath = join(DIST, url);
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found: ' + req.url);
  }
});

await new Promise(r => server.listen(0, r));
const port = server.address().port;
const baseUrl = `http://localhost:${port}`;
console.log('[verify] server up at', baseUrl);

// 2) Playwright 跑 iPhone SE viewport
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone SE'],
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
page.on('console', msg => console.log('[page]', msg.type(), msg.text()));
page.on('pageerror', e => console.log('[page-error]', e.message));

const fail = (msg) => { console.error('❌', msg); process.exit(1); };
const pass = (msg) => console.log('✅', msg);

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  // 等 <ll-app> 渲染
  await page.waitForSelector('ll-app', { timeout: 10000 });
  await page.waitForTimeout(500);

  // ====== TEST 1: 工具栏 9 个按钮都在 ======
  const btnCount = await page.locator('.toolbar-actions .toolbar-btn').count();
  console.log('[test1] toolbar-btn count =', btnCount);
  if (btnCount !== 9) fail(`期望 9 个按钮,实际 ${btnCount}`);
  pass('TEST 1: 9 个顶栏按钮存在');

  // 截图 BEFORE scroll
  await page.screenshot({ path: join(OUT, '1-toolbar-before.png'), fullPage: false });

  // ====== TEST 2: 整个 toolbar 可横向滚 + 部分按钮被裁 ======
  const scrollMetrics = await page.evaluate(() => {
    const tb = document.querySelector('.toolbar');
    const btns = Array.from(document.querySelectorAll('.toolbar-btn'));
    const tbRect = tb.getBoundingClientRect();
    const visibleBtns = btns.filter(b => {
      const r = b.getBoundingClientRect();
      return r.right > tbRect.left && r.left < tbRect.right;
    }).length;
    return {
      toolbarClientWidth: tb.clientWidth,
      toolbarScrollWidth: tb.scrollWidth,
      toolbarOverflowX: getComputedStyle(tb).overflowX,
      toolbarTouchAction: getComputedStyle(tb).touchAction,
      btnCount: btns.length,
      visibleBtnCount: visibleBtns,
    };
  });
  console.log('[test2] toolbar metrics:', scrollMetrics);
  if (!scrollMetrics) fail('找不到 .toolbar');
  if (!['auto', 'scroll'].includes(scrollMetrics.toolbarOverflowX)) {
    fail(`.toolbar overflow-x 应为 auto/scroll,实际 ${scrollMetrics.toolbarOverflowX}`);
  }
  if (!scrollMetrics.toolbarTouchAction.includes('pan-x')) {
    fail(`.toolbar touch-action 应包含 pan-x,实际 ${scrollMetrics.toolbarTouchAction}`);
  }
  if (scrollMetrics.visibleBtnCount >= scrollMetrics.btnCount) {
    fail(`应该部分按钮被裁 (visible=${scrollMetrics.visibleBtnCount} / total=${scrollMetrics.btnCount}),说明 overflow 没生效`);
  }
  pass(`TEST 2: 整个工具栏可横向滚 (${scrollMetrics.visibleBtnCount}/${scrollMetrics.btnCount} 按钮可见, scrollWidth=${scrollMetrics.toolbarScrollWidth} > clientWidth=${scrollMetrics.toolbarClientWidth})`);

  // ====== TEST 3: 真实触摸 swipe (CDP Input.dispatchTouchEvent) ======
  const beforeRects = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.toolbar-btn'));
    return btns.map(b => Math.round(b.getBoundingClientRect().x));
  });
  const tbBox = await page.locator('.toolbar').boundingBox();
  if (!tbBox) fail('找不到 .toolbar boundingBox');
  const startX = tbBox.x + tbBox.width - 20;
  const midY = tbBox.y + tbBox.height / 2;
  const endX = tbBox.x + 20;

  // 用 CDP 注入真 touch events
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = (x, y) => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(startX, midY) });
  for (let i = 1; i <= 20; i++) {
    const x = startX - (startX - endX) * i / 20;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(x, midY) });
    await page.waitForTimeout(15);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);

  const afterScroll = await page.evaluate(() => {
    const tb = document.querySelector('.toolbar');
    return { scrollLeft: tb.scrollLeft, scrollWidth: tb.scrollWidth, clientWidth: tb.clientWidth };
  });
  const afterRects = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.toolbar-btn'));
    return btns.map(b => Math.round(b.getBoundingClientRect().x));
  });
  console.log('[test3] before rects:', beforeRects);
  console.log('[test3] after swipe rects:', afterRects);
  console.log('[test3] after swipe scrollLeft=', afterScroll);
  if (afterScroll.scrollLeft <= 0) {
    fail(`CDP 触摸 swipe 后 toolbar.scrollLeft 应 > 0,实际 ${afterScroll.scrollLeft}`);
  }
  if (afterRects[afterRects.length - 1] >= beforeRects[beforeRects.length - 1]) {
    fail(`swipe 后最右按钮 x 应左移,但 before[last]=${beforeRects[beforeRects.length - 1]} after[last]=${afterRects[afterRects.length - 1]}`);
  }
  pass(`TEST 3: CDP 触摸 swipe 后 toolbar.scrollLeft=${afterScroll.scrollLeft} (last btn x: ${beforeRects[beforeRects.length - 1]} → ${afterRects[afterRects.length - 1]})`);

  // 滚回去
  await page.evaluate(() => { document.querySelector('.toolbar').scrollLeft = 0; });
  await page.waitForTimeout(200);

  // ====== TEST 4: 本地参考库 — 长文件名可滑动 ======
  // 点 📚 按钮打开 local-files-panel
  await page.locator('.toolbar-btn[title*="本地参考库"]').click();
  await page.waitForTimeout(500);
  await page.waitForSelector('ll-local-files-panel', { timeout: 3000 });

  // 注入 fake 长文件名
  await page.evaluate(() => {
    const panel = document.querySelector('ll-local-files-panel');
    if (!panel) return;
    panel.files = [
      { path: '📕 一个非常非常长的 PDF 文件名 — 中文测试用例 — super-long-filename.pdf',
        type: 'pdf', chunkCount: 42, totalChars: 123456, lastIndexed: Date.now(), sampleHeadings: ['第一章'] },
      { path: '📘 another-long-epub-filename-that-should-overflow-the-container.epub',
        type: 'epub', chunkCount: 17, totalChars: 98765, lastIndexed: Date.now(), sampleHeadings: ['Prologue'] },
    ];
    panel.loading = false;
    panel.requestUpdate();
  });
  await page.waitForTimeout(500);
  await page.waitForSelector('.local-file-name', { timeout: 3000 });
  await page.screenshot({ path: join(OUT, '2-localfiles-open.png'), fullPage: false });

  const nameMetrics = await page.evaluate(() => {
    const el = document.querySelector('.local-file-name');
    if (!el) return null;
    const aRect = el.getBoundingClientRect();
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      overflowX: getComputedStyle(el).overflowX,
      touchAction: getComputedStyle(el).touchAction,
      text: el.textContent?.slice(0, 60),
      canScroll: el.scrollWidth > el.clientWidth + 1,
    };
  });
  console.log('[test4] local-file-name metrics:', nameMetrics);
  if (!nameMetrics) fail('找不到 .local-file-name');
  if (!['auto', 'scroll'].includes(nameMetrics.overflowX)) fail(`local-file-name overflow-x 应为 auto/scroll,实际 ${nameMetrics.overflowX}`);
  if (!nameMetrics.touchAction.includes('pan-x')) fail(`local-file-name touch-action 应包含 pan-x,实际 ${nameMetrics.touchAction}`);
  if (!nameMetrics.canScroll) fail(`scrollWidth (${nameMetrics.scrollWidth}) 应 > clientWidth (${nameMetrics.clientWidth}) — 长名应被裁`);
  pass(`TEST 4: 本地参考库文件名可横向滚动 (scrollWidth=${nameMetrics.scrollWidth} > clientWidth=${nameMetrics.clientWidth})`);

  // ====== TEST 5: 真实触摸 swipe 测文件名 ======
  const nameBox = await page.locator('.local-file-name').first().boundingBox();
  if (!nameBox) fail('找不到 .local-file-name 的 boundingBox');
  console.log('[test5] nameBox:', nameBox);
  // 起点必须在 viewport 内(viewport 宽 320,name 右端可能超出)
  const vp = page.viewportSize();
  const safeEnd = Math.min(nameBox.x + nameBox.width - 5, vp.width - 5);
  const safeStart = Math.max(nameBox.x + 30, vp.width - 30);
  const nameStartX = Math.min(safeStart, safeEnd - 20);
  const nameEndX = nameBox.x + 10;
  const nameMidY = nameBox.y + nameBox.height / 2;
  console.log('[test5] swipe from', nameStartX, '→', nameEndX, 'at y=', nameMidY);
  // CDP 触摸 swipe
  const cdp2 = await page.context().newCDPSession(page);
  const tp = (x, y) => [{ x, y, id: 2, radiusX: 3, radiusY: 3, force: 1 }];
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(nameStartX, nameMidY) });
  for (let i = 1; i <= 25; i++) {
    const x = nameStartX - (nameStartX - nameEndX) * i / 25;
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x, nameMidY) });
    await page.waitForTimeout(20);
  }
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  const nameScroll = await page.evaluate(() => {
    const el = document.querySelector('.local-file-name');
    return { scrollLeft: el.scrollLeft };
  });
  console.log('[test5] local-file-name scrollLeft after CDP swipe =', nameScroll);
  if (nameScroll.scrollLeft <= 0) fail(`CDP 触摸 swipe 后文件名 scrollLeft 应 > 0,实际 ${nameScroll.scrollLeft}`);
  pass(`TEST 5: 真实触摸 swipe 后文件名 scrollLeft=${nameScroll.scrollLeft}`);

  // 最终 PASS 截图
  await page.screenshot({ path: join(OUT, '3-final.png'), fullPage: false });
  console.log('\n🎉 全部测试通过');
  console.log('截图:', OUT);
} catch (e) {
  console.error('💥 测试异常:', e);
  await page.screenshot({ path: join(OUT, 'fail.png'), fullPage: false });
  process.exit(1);
} finally {
  await browser.close();
  server.close();
}
