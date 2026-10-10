#!/usr/bin/env node
/** shot.js — 出图做视觉验收：首页 / 测试页 / 结算页 / 竖屏 */
const fs = require('fs'), path = require('path'), http = require('http');
const { createRequire } = require('module');
const req = createRequire('/Users/xiangbo/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = req('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'shots');
const EXEC = '/Users/xiangbo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((q, res) => {
    const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, b) => e ? (res.writeHead(404).end()) : res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(b));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${server.address().port}/` + encodeURIComponent('汉字小侦探.html');
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });

  async function run(w, h, tag, opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'zh-CN', isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(URL, { waitUntil: 'load' });
    await page.evaluate((seenGuide) => {
      localStorage.clear();
      localStorage.setItem('hzdet.settings', JSON.stringify({ mode: 'self', level: 3, perRound: 20, review: false, sound: true, speak: false, showPinyin: false, seenGuide: seenGuide }));
      localStorage.setItem('hzdet.energy', '420');
      localStorage.setItem('hzdet.chars', JSON.stringify({ '一': { last: 'know', k: 3, u: 0 }, '丁': { last: 'unk', k: 0, u: 1 }, '七': { last: 'unk', k: 0, u: 2 }, '人': { last: 'know', k: 2, u: 0 } }));
      localStorage.setItem('hzdet.history', JSON.stringify([
        { ts: Date.now() - 86400000 * 3, level: 1, mode: 'self', review: false, n: 20, know: 12, unk: 8, estimate: 600, stars: 2 },
        { ts: Date.now() - 86400000 * 2, level: 2, mode: 'parent', review: false, n: 20, know: 14, unk: 6, estimate: 700, stars: 3 },
        { ts: Date.now() - 86400000, level: 3, mode: 'parent', review: false, n: 20, know: 15, unk: 5, estimate: 750, stars: 3 }
      ]));
    }, !opts.guide);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.brand h1');
    await sleep(400);
    if (opts.guide) {
      await page.waitForSelector('.guide', { timeout: 5000 });
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, `0-guide-${tag}.png`) });
      await page.click('#gOk');
      await sleep(300);
    }
    await page.screenshot({ path: path.join(OUT, `1-home-${tag}.png`) });

    await page.click('#startBtn');
    await page.waitForSelector('#card');
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `2-play-${tag}.png`) });

    // 拖到一半（悬停在左区，展示高亮态）
    const b = await (await page.$('#card')).boundingBox();
    const zb = await (await page.$('#zoneKnow')).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 10 });
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, `3-drag-${tag}.png`) });
    await page.mouse.up();
    await sleep(600);

    // 作答完一局
    for (let i = 0; i < 25; i++) {
      if (await page.evaluate(() => document.querySelector('#result').classList.contains('on'))) break;
      const btn = await page.$('#btnKnow');
      if (!btn) break;
      await page.click(i % 3 === 0 ? '#btnUnk' : '#btnKnow');
      await sleep(420);
    }
    await page.waitForSelector('#result.on', { timeout: 9000 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `4-result-${tag}.png`) });
    await page.screenshot({ path: path.join(OUT, `4-result-full-${tag}.png`), fullPage: true });

    // 设置抽屉
    await page.click('#homeBtn');
    await page.waitForSelector('#home.on');
    await page.click('#gearBtn');
    await sleep(450);
    await page.screenshot({ path: path.join(OUT, `5-settings-${tag}.png`) });

    await ctx.close();
  }

  await run(1280, 800, 'landscape');
  await run(820, 1180, 'portrait');
  await run(390, 844, 'phone', { mobile: true, guide: true });          // iPhone 常见尺寸
  await run(360, 640, 'phone-small', { mobile: true });                 // 小屏安卓下限
  await run(430, 932, 'phone-max', { mobile: true });                   // 大屏 iPhone
  await browser.close(); server.close();
  console.log('截图输出：' + OUT);
  fs.readdirSync(OUT).forEach(f => console.log('  ' + f + '  ' + (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + 'KB'));
})();
