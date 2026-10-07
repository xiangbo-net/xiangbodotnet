#!/usr/bin/env node
/**
 * selftest-mobile.js — 手机版（≤640px 竖排 + 上下滑动）专项实测
 * 运行：
 *   NODE_PATH=/Users/xiangbo/.workbuddy/binaries/node/workspace/node_modules \
 *   node tools/selftest-mobile.js
 *
 * 覆盖：竖排布局正确性 → 真实触摸上下滑动判定 → 短距离滑动也命中 → 底部按钮兜底
 *      → 不允许出现横向滚动 → 结算页/设置抽屉在手机上的版式 → 旋转后自动切回左右拖动
 *      → 触摸薄弱容错（斜着滑、横向滑不算）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createRequire } = require('module');

const req = createRequire('/Users/xiangbo/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = req('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const EXEC = '/Users/xiangbo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const results = [];
function ok(name, cond, extra) { results.push({ name, pass: !!cond, extra: extra || '' }); console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  → ' + extra : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req0, res) => {
    const p = path.join(ROOT, decodeURIComponent(req0.url.split('?')[0]) === '/' ? '汉字小侦探.html' : decodeURIComponent(req0.url.split('?')[0]));
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404).end('404'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(buf);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${server.address().port}/` + encodeURIComponent('汉字小侦探.html');

  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, locale: 'zh-CN'
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('dialog', async d => { await d.accept(); });
  const cdp = await ctx.newCDPSession(page);

  async function touch(type, x, y) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1 }]
    });
  }
  // 真实触摸滑动（不是鼠标事件）
  async function swipe(fx, fy, tx, ty, steps) {
    steps = steps || 12;
    await touch('touchStart', fx, fy);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', fx + (tx - fx) * i / steps, fy + (ty - fy) * i / steps);
      await sleep(14);
    }
    await touch('touchEnd', tx, ty);
  }

  console.log('【1】手机竖屏加载（iPhone 390×844）');
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('.brand h1', { timeout: 8000 });
  await page.evaluate(() => localStorage.setItem('hzdet.settings', JSON.stringify({ mode: 'self', level: 1, perRound: 10, review: false, sound: true, speak: false, showPinyin: false, seenGuide: true })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.brand h1', { timeout: 8000 });
  ok('首页在手机宽度下正常渲染', await page.textContent('.brand h1') === '汉字小侦探');
  const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('首页无横向溢出', homeOverflow <= 0, '溢出 ' + homeOverflow + 'px');
  ok('首页文案已改成「往上滑 / 往下滑」', /往上滑/.test(await page.textContent('.mode .d')), (await page.textContent('.mode .d')).slice(0, 30));
  const statCols = await page.evaluate(() => getComputedStyle(document.querySelector('.stat-strip')).gridTemplateColumns.split(' ').length);
  ok('统计条在手机上排成 2×2', statCols === 2, statCols + ' 列');

  console.log('\n【2】测试页：三区竖排');
  await page.click('#startBtn');
  await page.waitForSelector('#card', { timeout: 5000 });
  // 等卡片入场动画真正落定（headless 下 rAF 会被节流，用轮询而不是 time-based sleep）
  await page.waitForFunction(() => {
    var c = document.querySelector('#card');
    if (!c) return false;
    var s = getComputedStyle(c);
    return s.opacity === '1' && (s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)');
  }, null, { timeout: 5000, polling: 100 });
  const geo = await page.evaluate(() => {
    const zk = document.querySelector('#zoneKnow').getBoundingClientRect();
    const zu = document.querySelector('#zoneUnk').getBoundingClientRect();
    const cd = document.querySelector('#card').getBoundingClientRect();
    const st = document.querySelector('#stage').getBoundingClientRect();
    const bd = document.querySelector('.board').getBoundingClientRect();
    return {
      zk: { t: zk.top, b: zk.bottom, l: zk.left, w: zk.width },
      zu: { t: zu.top, b: zu.bottom, l: zu.left, w: zu.width },
      card: { t: cd.top, b: cd.bottom, h: cd.height },
      stage: { t: st.top, b: st.bottom, h: st.height },
      boardBottom: bd.bottom, vh: window.innerHeight,
      vert: document.querySelector('.board').classList.contains('vert')
    };
  });
  ok('「我认识」区在上方、「还不认识」在下方', geo.zk.b <= geo.zu.t, 'know.bottom=' + Math.round(geo.zk.b) + ' unk.top=' + Math.round(geo.zu.t));
  ok('两个投放区都占满整宽', Math.round(geo.zk.w) === Math.round(geo.zu.w) && geo.zk.w > 300, Math.round(geo.zk.w) + 'px');
  ok('大卡夹在两区中间且不重叠', geo.card.t >= geo.zk.b - 1 && geo.card.b <= geo.zu.t + 1, '卡 ' + Math.round(geo.card.t) + '–' + Math.round(geo.card.b) + '，上区底 ' + Math.round(geo.zk.b) + '，下区顶 ' + Math.round(geo.zu.t));
  ok('大卡没有超出卡片区', Math.abs(geo.card.h - geo.stage.h) <= 1, '卡高 ' + Math.round(geo.card.h) + ' / 区高 ' + Math.round(geo.stage.h));
  ok('卡片足够大（≥ 屏幕高度 35%，保证字够一眼看清）', geo.card.h >= geo.vh * 0.35, Math.round(geo.card.h) + 'px / ' + geo.vh);
  ok('board 未见溢出（底部区未被挤出屏幕）', geo.zu.b <= geo.vh + 1, Math.round(geo.zu.b) + ' / ' + geo.vh);
  ok('已自动切换到竖排模式（vert）', geo.vert);
  ok('区域提示文案为「往上滑 / 往下滑」', /往上滑/.test(await page.textContent('[data-hint="know"]')) && /往下滑/.test(await page.textContent('[data-hint="unk"]')));
  ok('底部按钮键值提示为 ↑ / ↓', (await page.textContent('[data-key="know"]')).trim() === '↑' && (await page.textContent('[data-key="unk"]')).trim() === '↓');
  const arrowShown = await page.evaluate(() => getComputedStyle(document.querySelector('#zoneKnow .z-arrow')).display);
  ok('区域标题显示向上箭头', arrowShown !== 'none', arrowShown);

  console.log('\n【3】真实触摸：上滑 = 认识');
  await sleep(450); // 让停留时间超过 400ms，确保正常计分
  let b = await (await page.$('#card')).boundingBox();
  const eBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('hzdet.energy') || '0'));
  await swipe(b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2, b.y + b.height / 2 - 200);
  await sleep(700);
  ok('上滑后「认识」计数 = 1', (await page.textContent('#nKnow')).trim() === '1', '实际 ' + (await page.textContent('#nKnow')));
  const eAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('hzdet.energy') || '0'));
  ok('上滑正常计分 +5', eAfter - eBefore === 5, eBefore + ' → ' + eAfter);
  ok('进度前进到第 2 张', /2 \/ 10/.test(await page.textContent('#pgTxt')), await page.textContent('#pgTxt'));

  console.log('\n【4】真实触摸：下滑 = 不认识');
  await sleep(450);
  b = await (await page.$('#card')).boundingBox();
  await swipe(b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2, b.y + b.height / 2 + 200);
  await sleep(700);
  ok('下滑后「还不认识」计数 = 1', (await page.textContent('#nUnk')).trim() === '1', '实际 ' + (await page.textContent('#nUnk')));

  console.log('\n【5】滑动容错：拖到区域里 / 斜着滑 / 横向小幅移动');
  await sleep(450);
  b = await (await page.$('#card')).boundingBox();
  let zb = await (await page.$('#zoneKnow')).boundingBox();
  await swipe(b.x + b.width / 2, b.y + b.height / 2, zb.x + zb.width / 2, zb.y + zb.height / 2);
  await sleep(700);
  ok('拖进「认识」区松手也算认识', (await page.textContent('#nKnow')).trim() === '2', '实际 ' + (await page.textContent('#nKnow')));

  await sleep(450);
  b = await (await page.$('#card')).boundingBox();
  const before2 = await page.evaluate(() => document.querySelector('#nKnow').textContent + '/' + document.querySelector('#nUnk').textContent);
  await swipe(b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2 + 60, b.y + b.height / 2 - 30);
  await sleep(600);
  const hasCard = await page.$('#card');
  const after2 = await page.evaluate(() => document.querySelector('#nKnow').textContent + '/' + document.querySelector('#nUnk').textContent);
  ok('横向小幅滑动不误判（卡片弹回原位）', !!hasCard && before2 === after2, before2 + ' → ' + after2);

  await sleep(450);
  b = await (await page.$('#card')).boundingBox();
  await swipe(b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2 + 45, b.y + b.height / 2 - 170);
  await sleep(700);
  ok('略微斜着往上滑仍判为「认识」', (await page.textContent('#nKnow')).trim() === '3', '实际 ' + (await page.textContent('#nKnow')));

  console.log('\n【6】底部大按钮兜底仍然可用');
  const before3 = await page.textContent('#nUnk');
  await page.evaluate(() => document.querySelector('#btnUnk').click());
  await sleep(600);
  ok('点「还不认识」按钮生效', (await page.textContent('#nUnk')).trim() !== before3.trim(), before3 + ' → ' + await page.textContent('#nUnk'));

  console.log('\n【7】打完整局 → 手机结算页');
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => document.querySelector('#result').classList.contains('on'))) break;
    if (!await page.$('#btnKnow')) break;
    await page.evaluate(() => document.querySelector('#btnKnow').click());
    await sleep(420);
  }
  await page.waitForSelector('#result.on', { timeout: 8000 });
  const rOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('结算页无横向溢出', rOverflow <= 0, '溢出 ' + rOverflow + 'px');
  const metricCols = await page.evaluate(() => getComputedStyle(document.querySelector('.metrics')).gridTemplateColumns.split(' ').length);
  ok('指标卡在手机上两列', metricCols === 2, metricCols + ' 列');
  ok('清单区在手机上改为单列堆叠', (await page.evaluate(() => getComputedStyle(document.querySelector('.res-cols')).gridTemplateColumns.split(' ').length)) === 1);
  ok('结算页已渲染', /本局完成/.test(await page.textContent('.res-wrap')));

  console.log('\n【8】设置抽屉在手机上为底部弹出');
  await page.evaluate(() => document.querySelector('#homeBtn').click());
  await page.waitForSelector('#home.on');
  await page.evaluate(() => document.querySelector('#gearBtn').click());
  await sleep(450);
  const sheetGeo = await page.evaluate(() => {
    const s = document.querySelector('#sheet').getBoundingClientRect();
    return { left: s.left, width: s.width, bottom: s.bottom, height: s.height, vw: window.innerWidth, vh: window.innerHeight };
  });
  ok('抽屉贴底且撑满宽度', Math.round(sheetGeo.left) === 0 && Math.round(sheetGeo.width) === sheetGeo.vw, JSON.stringify(sheetGeo));
  ok('抽屉贴住屏幕底部', Math.round(sheetGeo.bottom) === sheetGeo.vh, 'bottom=' + Math.round(sheetGeo.bottom) + ' vh=' + sheetGeo.vh);
  ok('抽屉高度不超过屏幕 86%', sheetGeo.height <= sheetGeo.vh * 0.86 + 1, Math.round(sheetGeo.height) + ' / ' + Math.round(sheetGeo.vh * 0.86));
  await page.evaluate(() => document.querySelector('#sheetClose').click());

  console.log('\n【9】旋转到横屏 → 自动切回左右两栏 + 左右拖动');
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  await page.evaluate(() => document.querySelector('#startBtn').click());
  await page.waitForSelector('#card', { timeout: 5000 });
  const land = await page.evaluate(() => {
    const zk = document.querySelector('#zoneKnow').getBoundingClientRect();
    const zu = document.querySelector('#zoneUnk').getBoundingClientRect();
    return { vert: document.querySelector('.board').classList.contains('vert'), sideBySide: zk.right <= zu.left };
  });
  ok('横屏后回到左右两栏', !land.vert && land.sideBySide, JSON.stringify(land));
  ok('提示文案改回「拖过来松手」', /拖过来松手/.test(await page.textContent('[data-hint="know"]')), await page.textContent('[data-hint="know"]'));
  ok('按钮键值提示改回 ← / →', (await page.textContent('[data-key="know"]')).trim() === '←');
  const lOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('横屏无横向溢出', lOverflow <= 0, '溢出 ' + lOverflow + 'px');

  console.log('\n【10】控制台零报错');
  ok('无 pageerror / console.error', errors.length === 0, errors.slice(0, 5).join(' | '));

  await page.screenshot({ path: path.join(ROOT, 'tools', 'screenshot-mobile-play.png') });
  await browser.close();
  server.close();

  const fail = results.filter(r => !r.pass);
  console.log('\n========================================');
  console.log(`共 ${results.length} 项，通过 ${results.length - fail.length}，失败 ${fail.length}`);
  if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log('  - ' + f.name + (f.extra ? '  → ' + f.extra : ''))); }
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('手机自测脚本异常：', e); process.exit(2); });
