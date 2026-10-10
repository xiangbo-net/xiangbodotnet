#!/usr/bin/env node
/**
 * shot2.cjs —— 汉字小侦探 v2 实机截图（供人工验收）
 * 前置：本地服务已启动（wrangler dev --port 8787 --local）
 * 产物：tools/shots2/*.png
 *
 * 脚本会先把本地进度归零，再在桌面端走完一整关，
 * 让家长端的分组标签卡能截到真实的数量与列表。
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const req = createRequire('/Users/xiangbo/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = req('playwright-core');

const EXEC = '/Users/xiangbo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const HOST = process.env.HOST || 'http://127.0.0.1:8787';
const API = HOST + '/api/baby';
const OUT = path.join(__dirname, 'shots2');
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 预置本地设置：跳过首次「怎么玩」引导层，否则它会挡住首页按钮
const SKIP_GUIDE = () => {
  try {
    localStorage.setItem('hzdet2.settings', JSON.stringify({ seenGuide: true, sound: false, speak: false }));
  } catch (e) { }
};

async function api(method, p, body, tk) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (tk) headers.Authorization = 'Bearer ' + tk;
  const r = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}

async function swipe(page, dir) {
  const el = await page.$('#card');
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;   // 一关刚好结束，卡片已被移除
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const dist = Math.max(box.width * 0.62, 160);
  const dx = dir === 'know' ? -dist : dist;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx + dx * i / 10, cy + Math.sin(i / 10 * Math.PI) * 6);
    await sleep(12);
  }
  await page.mouse.up();
  await sleep(320);
  return true;
}

(async () => {
  // 归零，保证截图可重现
  const tk = (await api('POST', '/admin/login', { password: 'momo2026' })).token;
  await api('POST', '/admin/reset', { keepSessions: false }, tk);

  const browser = await chromium.launch({ executablePath: EXEC });
  let n = 0;
  const shot = async (page, name) => {
    const f = path.join(OUT, String(++n).padStart(2, '0') + '-' + name + '.png');
    await page.screenshot({ path: f });
    console.log('  📷 ' + path.relative(process.cwd(), f));
  };

  /* ---------- 桌面 · 孩子端 ---------- */
  const desk = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await desk.addInitScript(SKIP_GUIDE);
  const d = await desk.newPage();

  await d.goto(HOST + '/', { waitUntil: 'networkidle' });
  await sleep(600);
  await shot(d, 'kid-home-desktop');

  await d.click('.action-card.primary');
  await d.waitForSelector('#card', { timeout: 8000 });
  await sleep(500);
  await shot(d, 'kid-play-collapsed');

  await d.click('#revealBtn');
  await sleep(500);
  await shot(d, 'kid-play-pinyin-words');

  // 点底部按钮 = 和手动滑动同一套飞出动画（抓飞出的瞬间）
  await d.click('#btnKnow');
  await sleep(0);
  await shot(d, 'kid-btn-fly');
  await sleep(600);

  // 拖到一半，展示光晕反馈
  const box = await (await d.$('#card')).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await d.mouse.move(cx, cy);
  await d.mouse.down();
  for (let i = 1; i <= 10; i++) await d.mouse.move(cx + (box.width * 0.22) * i / 10, cy);
  await sleep(260);
  await shot(d, 'kid-play-drag-glow');
  await d.mouse.move(cx, cy);
  await d.mouse.up();
  await sleep(400);

  // 走完这一关（顺便给家长端留下真实的分组数据）
  // 注意：每标记一张卡后有过渡锁，紧接着的第二次滑动会被吞掉，
  // 所以用「进度没变就再补一次」的自适应循环，而不是固定次数。
  let guard = 0;
  while (guard < 160) {
    if (await d.$('.res-wrap')) break;   // 最后一题答完就出结算页，别再空转
    guard++;
    const before = await d.textContent('#pgTxt');
    await swipe(d, guard % 3 === 0 ? 'know' : 'unk');
    if ((await d.textContent('#pgTxt')) === before) await sleep(320);
  }
  console.log('   · 一关走完：尝试 ' + guard + ' 次滑动，' + (await d.textContent('#pgTxt') || '已出关卡'));
  await d.waitForSelector('.res-wrap', { timeout: 12000 });
  await sleep(600);
  await shot(d, 'kid-result');

  await d.click('#libraryBtn');
  await sleep(700);
  await shot(d, 'kid-library');
  await d.click('#libBack');
  await sleep(600);

  await d.click('#gearBtn');
  await sleep(600);
  await shot(d, 'kid-settings-sheet');
  await d.click('#sheetClose');
  await sleep(300);

  await desk.close();

  /* ---------- 手机 · 孩子端 ---------- */
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  await mob.addInitScript(SKIP_GUIDE);
  const m = await mob.newPage();
  await m.goto(HOST + '/', { waitUntil: 'networkidle' });
  await sleep(600);
  await shot(m, 'kid-home-mobile');

  await m.click('.action-card.primary');
  await m.waitForSelector('#card', { timeout: 8000 });
  await sleep(500);
  await shot(m, 'kid-play-mobile');

  await m.click('#revealBtn');
  await sleep(500);
  await shot(m, 'kid-play-mobile-words');
  await mob.close();

  /* ---------- 玩法介绍（首次弹出，可关闭）---------- */
  const gctx = await browser.newContext({ viewport: { width: 900, height: 920 }, deviceScaleFactor: 2 });
  const g = await gctx.newPage();
  await g.goto(HOST + '/', { waitUntil: 'networkidle' });   // 全新 localStorage → 自动弹出
  await g.waitForSelector('.overlay', { timeout: 9000 });
  await sleep(500);
  await shot(g, 'kid-guide');
  await g.click('.overlay .x');
  await sleep(400);
  await gctx.close();

  /* ---------- 家长端 ---------- */
  const adm = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const a = await adm.newPage();
  await a.goto(HOST + '/admin', { waitUntil: 'networkidle' });
  await sleep(500);
  await shot(a, 'admin-login');

  await a.fill('#pw', 'momo2026');
  await a.click('#loginBtn');
  await a.waitForSelector('.chips .chip', { timeout: 8000 });
  await a.waitForSelector('.chr', { timeout: 8000 });
  await sleep(700);
  await shot(a, 'admin-chars-all');

  // 分组标签卡逐张切过去
  for (const [cls, name] of [['known', 'known'], ['unknown', 'unknown'], ['untested', 'untested']]) {
    await a.click('.chip.g-' + cls);
    await sleep(800);
    await shot(a, 'admin-chars-' + name);
  }

  // 新增两个字（都不在自带字库里 → 会以「家长添加」入库）
  await a.click('[data-tab="add"]');
  await a.waitForSelector('#hzInput', { timeout: 5000 });
  await a.fill('#hzInput', '辰');
  await sleep(900);
  await shot(a, 'admin-add-preview');
  await a.click('.state-opt[data-st="known"]');
  await a.click('#saveBtn');
  await sleep(800);

  await a.fill('#hzInput', '澜');
  await sleep(900);
  await a.click('.state-opt[data-st="unknown"]');
  await a.click('#saveBtn');
  await sleep(800);

  await a.click('[data-tab="chars"]');
  await a.waitForSelector('.chr', { timeout: 8000 });
  await a.click('.chip.g-parent');
  await sleep(900);
  await shot(a, 'admin-chars-parent');

  await a.click('.chip.g-all');
  await sleep(900);
  await shot(a, 'admin-final');

  await a.click('[data-tab="settings"]');
  await sleep(600);
  await shot(a, 'admin-settings');
  await adm.close();

  await browser.close();
  console.log('\n✅ 截图完成 → ' + path.relative(process.cwd(), OUT));
})().catch(e => { console.error('截图失败：', e); process.exit(1); });
