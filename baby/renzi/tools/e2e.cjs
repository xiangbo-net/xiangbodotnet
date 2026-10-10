#!/usr/bin/env node
/**
 * e2e.cjs —— 汉字小侦探 v2 前端无头实测（桌面 + 手机）
 *
 * 前置：本地服务已启动（wrangler dev --port 8787 --local）
 * 运行：
 *   NODE_PATH=/Users/xiangbo/.workbuddy/binaries/node/workspace/node_modules \
 *   node tools/e2e.cjs
 *
 * 覆盖：
 *   孩子端：首页 → 关卡 → 横滑(左认识/右不认识) → 按钮/键盘通道 → 返回按钮(自定义确认层)
 *          → 拼音组词展开 → 结算 → 云端同步 → 练习模式(10 个一组) → 我的字库
 *   家长端：登录 → 字库查询 → 新增字/更新状态 → 改状态
 *   两种视口：桌面 1280×800、手机 390×844（手势统一为左右滑）
 */
const path = require('path');
const { createRequire } = require('module');

const req = createRequire('/Users/xiangbo/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = req('playwright-core');

const EXEC = '/Users/xiangbo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const HOST = process.env.HOST || 'http://127.0.0.1:8787';
const API = HOST + '/api/baby';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 家长端口令：不硬编码进仓库。优先读环境变量，其次读本地文件 tools/.adminpw（已 gitignore）
const PW = process.env.ADMIN_PASSWORD || (() => {
  try { return require('fs').readFileSync(path.join(__dirname, '.adminpw'), 'utf8').trim(); } catch (e) { return ''; }
})();
if (!PW) {
  console.error('✘ 需要家长端口令：设环境变量 ADMIN_PASSWORD，或写入 tools/.adminpw');
  process.exit(1);
}

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (extra != null ? '  → ' + JSON.stringify(extra) : '')); }
}

async function apiCall(method, p, body, token) {
  const headers = { 'Accept': 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// 在卡片上用真实指针从中心向目标方向拖动
async function swipe(page, dir) {
  const box = await (await page.$('#card')).boundingBox();
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
  await page.waitForTimeout(360);
}

(async function () {
  // 清空进度，保证可重现
  const tk = (await apiCall('POST', '/admin/login', { password: PW })).body.token;
  await apiCall('POST', '/admin/reset', { keepSessions: false }, tk);
  console.log('本地服务：' + HOST + '\n');

  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const errors = [];

  /* =========================================================
     一、孩子端（桌面）
     ========================================================= */
  console.log('[一] 孩子端 · 桌面视口');
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  let page = await ctx.newPage();
  page.on('pageerror', e => errors.push('kid pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('kid console: ' + m.text()); });

  // 监听朗读调用：用于断言「不点小喇叭就不出声」
  await ctx.addInitScript(() => {
    window.__spoken = [];
    try {
      var ss = window.speechSynthesis;
      if (ss) {
        ss.speak = function (u) { window.__spoken.push(String(u && u.text || '')); };
        ss.cancel = function () { };
      }
    } catch (e) { }
  });

  await page.goto(HOST + '/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('hzdet2.settings', JSON.stringify({ mode: 'self', sound: false, speak: false, showPinyin: false, seenGuide: true })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.action-card', { timeout: 10000 });

  ok('首页渲染（品牌标题）', (await page.textContent('.brand h1')) === '汉字小侦探');
  ok('首页显示 4 个统计格', (await page.$$('.stat')).length === 4);
  ok('主行动区 3 个入口', (await page.$$('.action-card')).length === 3);
  ok('总字数为 1000', (await page.textContent('.brand p')).includes('1000'));
  ok('首页没有家长入口链接', (await page.$$('a[href*="admin"]')).length === 0);

  // ---- 进入第 1 关 ----
  await page.click('.action-card.primary');
  await page.waitForSelector('#card', { timeout: 6000 });
  ok('进入关卡后显示字卡', !!(await page.textContent('#card .glyph')));
  ok('关卡 HUD 显示「第 1 关」', (await page.textContent('#pgLeft')).includes('第 1 关'));
  ok('卡片默认收起拼音', !(await page.$eval('#py', e => e.classList.contains('show'))));
  ok('卡片有组词数据', (await page.$$('#words .wd')).length >= 1);

  // ---- 拖不到阈值就松手：这张卡必须还能继续拖 ----
  // 曾经的 bug：onUp 在「没到位」分支里调了 cleanup() 摘掉全部拖拽监听，
  // 却没有重新 bindDrag，于是这张卡从此再也拖不动，只能用底部按钮。
  const beforePartial = await page.textContent('#card .glyph');
  const pb = await (await page.$('#card')).boundingBox();
  const pcx = pb.x + pb.width / 2, pcy = pb.y + pb.height / 2;
  const partialDrag = async () => {
    await page.mouse.move(pcx, pcy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(pcx - (pb.width * 0.20) * i / 8, pcy);
    await page.waitForTimeout(60);
    const dragging = await page.$eval('#card', e => e.classList.contains('dragging'));
    const dragp = parseFloat(await page.$eval('#card', e => e.style.getPropertyValue('--dragp') || '0'));
    await page.mouse.up();
    await page.waitForTimeout(420);
    return { dragging, dragp };
  };
  const p1 = await partialDrag();
  ok('拖不到位时也有位移与光晕反馈', p1.dragging && p1.dragp > 0, p1);
  ok('拖不到位松手后弹回同一张卡、不计分',
    (await page.textContent('#card .glyph')) === beforePartial && (await page.textContent('#nKnow')) === '0');
  const p2 = await partialDrag();
  ok('拖不到位松手后，这张卡仍能再次拖动', p2.dragging && p2.dragp > 0, p2);

  // ---- 自动朗读回归：不点小喇叭就不该出声 ----
  await page.waitForTimeout(1000);   // 覆盖原先 320ms 的自动朗读延迟
  const spokenOnEnter = await page.evaluate(() => (window.__spoken || []).slice());
  ok('进入关卡后没有自动朗读', spokenOnEnter.length === 0, { spoken: spokenOnEnter });

  // 展开拼音和组词，也不应触发朗读
  const c1 = await page.textContent('#card .glyph');
  await page.click('#revealBtn');
  await page.waitForTimeout(300);
  ok('点「看拼音和组词」后拼音显示', await page.$eval('#py', e => e.classList.contains('show')));
  ok('组词区展开', await page.$eval('#words', e => e.classList.contains('show')));
  const spokenAfterReveal = await page.evaluate(() => (window.__spoken || []).slice());
  ok('点「看拼音和组词」不会朗读', spokenAfterReveal.length === 0, { spoken: spokenAfterReveal });

  // 主动点小喇叭才朗读
  const glyphNow = await page.textContent('#card .glyph');
  await page.click('#speakBtn');
  await page.waitForTimeout(250);
  const spokenManual = await page.evaluate(() => (window.__spoken || []).slice());
  ok('点小喇叭后朗读该字', spokenManual.length === 1 && spokenManual[0] === glyphNow,
    { spoken: spokenManual, glyph: glyphNow });

  // ---- 左滑 = 认识（同时验证换卡也不自动朗读）----
  await swipe(page, 'know');
  await page.waitForTimeout(800);
  ok('左滑后认识计数 +1', (await page.textContent('#nKnow')) === '1', { know: await page.textContent('#nKnow') });
  ok('左滑后换到下一张卡', (await page.textContent('#card .glyph')) !== c1);
  const spokenNext = await page.evaluate(() => (window.__spoken || []).slice());
  ok('换到下一张卡仍无自动朗读', spokenNext.length === 1, { spoken: spokenNext });

  // ---- 右滑 = 不认识 ----
  await swipe(page, 'unk');
  await page.waitForTimeout(400);
  ok('右滑后不认识计数 +1', (await page.textContent('#nUnk')) === '1', { unk: await page.textContent('#nUnk') });

  // ---- 按钮上的图标：绿色对勾 / 红色圆圈，不带动方向箭头 ----
  const bi = await page.evaluate(() => {
    const k = document.querySelector('#btnKnow'), u = document.querySelector('#btnUnk');
    const strokes = el => Array.from(el.querySelectorAll('svg *'))
      .map(n => (n.getAttribute('fill') || '') + '|' + (n.getAttribute('stroke') || ''));
    return {
      kText: k.textContent.trim(), uText: u.textContent.trim(),
      kStrokes: strokes(k), uStrokes: strokes(u),
      arrows: (k.textContent + u.textContent).match(/[←→►◄→←]/g) || [],
    };
  });
  ok('两个大按钮上没有方向箭头', bi.arrows.length === 0, bi);
  ok('「我认识」图标是绿色对勾', bi.kStrokes.join(' ').includes('#2E9E4F'), bi.kStrokes);
  ok('「还不认识」图标是红色圆圈', bi.uStrokes.join(' ').includes('#D64541'), bi.uStrokes);

  // ---- 按钮通道：点按钮时字卡要飞出（和手动滑动同一套动画）----
  await page.click('#btnKnow');
  await page.waitForTimeout(90);
  const flying = await page.$eval('#card', e => ({ t: e.style.transform, op: e.style.opacity }));
  ok('点「我认识」后字卡向左飞出（位移 + 旋转）',
    /translate3d\(-\d/.test(flying.t) && /rotate\(-\d/.test(flying.t), flying);
  ok('点按钮飞出时投放区同样高亮', !!(await page.$('.zone.flash-know')));
  await page.waitForTimeout(500);
  ok('按钮「我认识」生效', (await page.textContent('#nKnow')) === '2');

  // ---- 键盘通道（同一条 answer 通道，卡片也应飞出）----
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(90);
  const flyKb = await page.$eval('#card', e => e.style.transform);
  ok('键盘 → 判为不认识', (await page.textContent('#nUnk')) === '2');
  ok('键盘通道卡片同样向右飞出', /translate3d\(\d/.test(flyKb), { t: flyKb });
  await page.waitForTimeout(500);

  // ---- 返回按钮（重点回归） ----
  await page.click('#quitBtn');
  await page.waitForTimeout(200);
  ok('点返回弹出的是自定义确认层（不是原生 confirm）', (await page.$$('.overlay')).length === 1);
  ok('确认层文案包含「退出」', (await page.textContent('.overlay')).includes('退出'));
  await page.click('.overlay [data-x="0"]');   // 继续玩
  await page.waitForTimeout(200);
  ok('点「继续玩」后仍在关卡内', (await page.$$('.overlay')).length === 0 && !!(await page.$('#card')));

  await page.click('#quitBtn');
  await page.waitForTimeout(200);
  await page.click('.overlay [data-x="1"]');   // 退出
  await page.waitForTimeout(400);
  ok('点「退出」后回到首页', !!(await page.$('.action-card')));

  // ---- 云端同步校验 ----
  const b1 = (await apiCall('GET', '/bootstrap')).body;
  ok('已答的字已同步到云端（4 个字）', Object.keys(b1.progress).length === 4, { n: Object.keys(b1.progress).length });
  ok('云端统计：认识 2', b1.stats.known === 2, b1.stats);

  // ---- 打完整关（补足 20）----
  const testedBefore = b1.stats.tested;   // 中途退出那 4 字已提交，作为基准
  await page.click('.action-card.primary');
  await page.waitForSelector('#card', { timeout: 6000 });
  for (let i = 0; i < 40; i++) {
    const stage = await page.$('#card');
    if (!stage) break;
    await swipe(page, i % 3 === 0 ? 'know' : 'unk');
  }
  await page.waitForSelector('.res-wrap', { timeout: 8000 });
  ok('一关打完后进入结算页', !!(await page.$('.res-wrap')));
  ok('结算页有认识/不认识两张清单', (await page.$$('.res-cols .card')).length === 2);
  ok('结算页有星级', (await page.$$('.stars svg')).length === 3);

  const b2 = (await apiCall('GET', '/bootstrap')).body;
  ok('整关数据已上传（本轮新增 20 字）', b2.stats.tested === testedBefore + 20,
    { before: testedBefore, after: b2.stats.tested });
  ok('不认识的字进入练习库（>0）', b2.stats.unknown > 0, b2.stats);

  // ---- 练习模式：10 个一组 ----
  await page.click('#practiceBtn');
  await page.waitForSelector('#card', { timeout: 6000 });
  const total = await page.evaluate(() => document.querySelectorAll('#pgTxt')[0].textContent);
  ok('练习局为 10 个字一组', /\/ 10 张/.test(await page.textContent('#pgTxt')), { txt: total });
  ok('练习模式默认显示拼音（便于学习）', await page.$eval('#py', e => e.classList.contains('show')));
  await page.click('#quitBtn');
  await page.waitForTimeout(200);
  await page.click('.overlay [data-x="1"]');
  await page.waitForTimeout(300);

  // ---- 我的字库 ----
  await page.click('.action-card.library');
  await page.waitForTimeout(400);
  ok('字库页显示已认识的字', (await page.$$('.lib-card')).length > 0);
  ok('字库卡片带拼音', (await page.textContent('.lib-card .p')).length > 0);
  await page.click('#libBack');
  await page.waitForTimeout(300);

  // ---- 家长设置抽屉：不重复放「判定模式 / 当前进度」（首页已有）----
  await page.click('#gearBtn');
  await page.waitForTimeout(400);
  const rowLabs = await page.$$eval('#sheet .row .lab', els => els.map(e => e.textContent.trim()));
  ok('家长设置只剩 拼音 / 音效 / 重新同步 三项（不再重复判定模式与当前进度）',
    JSON.stringify(rowLabs) === JSON.stringify(['卡片直接显示拼音', '音效', '重新同步数据']), { rowLabs });
  ok('「判定模式」选择器已从设置里移除', !(await page.$('#sheet #setMode')));
  ok('家长设置保留 音效 / 拼音 开关',
    !!(await page.$('#sheet .row[data-toggle="sound"]')) && !!(await page.$('#sheet .row[data-toggle="showPinyin"]')));
  ok('首页仍然有「谁来判」的两个模式卡（判定没有丢）',
    (await page.$$('#home .mode')).length === 2);
  await page.click('#sheetClose');
  await page.waitForTimeout(300);

  await ctx.close();

  /* =========================================================
     二、孩子端（手机）—— 手势必须也是左右滑
     ========================================================= */
  console.log('\n[二] 孩子端 · 手机视口 (390×844)');
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push('mob pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('mob console: ' + m.text()); });

  await page.goto(HOST + '/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('hzdet2.settings', JSON.stringify({ mode: 'self', sound: false, speak: false, showPinyin: false, seenGuide: true })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.action-card', { timeout: 10000 });
  ok('手机端首页正常', (await page.textContent('.brand h1')) === '汉字小侦探');

  await page.click('.action-card.practice');   // 直接进练习（有字可练）
  await page.waitForSelector('#card', { timeout: 6000 });
  const mobTotal = await page.textContent('#pgTxt');
  ok('手机端进入对局', /\/ \d+ 张/.test(mobTotal), { txt: mobTotal });

  const beforeKnow = await page.textContent('#nKnow');
  const c2 = await page.textContent('#card .glyph');
  await swipe(page, 'know');       // 左滑
  await page.waitForTimeout(450);
  ok('手机端左滑 = 认识', (await page.textContent('#nKnow')) !== beforeKnow, { before: beforeKnow, after: await page.textContent('#nKnow') });
  ok('手机端左滑后换卡', (await page.textContent('#card .glyph')) !== c2);

  const beforeUnk = await page.textContent('#nUnk');
  await swipe(page, 'unk');        // 右滑
  await page.waitForTimeout(450);
  ok('手机端右滑 = 不认识', (await page.textContent('#nUnk')) !== beforeUnk);

  // 返回按钮（手机）
  await page.click('#quitBtn');
  await page.waitForTimeout(250);
  ok('手机端返回按钮同样弹自定义确认层', (await page.$$('.overlay')).length === 1);
  await page.click('.overlay [data-x="1"]');
  await page.waitForTimeout(400);
  ok('手机端退出回到首页', !!(await page.$('.action-card')));
  await ctx.close();

  /* =========================================================
     三、孩子端 · 玩法介绍弹层可以关闭
     ========================================================= */
  console.log('\n[三] 孩子端 · 玩法介绍可关闭');
  ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, locale: 'zh-CN' });
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push('guide pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('guide console: ' + m.text()); });

  await page.goto(HOST + '/', { waitUntil: 'load' });   // 全新 localStorage → 会自动弹一次
  await page.waitForSelector('.overlay', { timeout: 9000 });
  ok('首次打开自动弹出玩法介绍', (await page.textContent('.overlay h2')) === '怎么玩？');
  ok('玩法介绍有右上角关闭按钮（✕）', !!(await page.$('.overlay .x')));

  await page.click('.overlay .x');
  await page.waitForTimeout(320);
  ok('点 ✕ 能关掉玩法介绍', (await page.$$('.overlay')).length === 0);
  ok('关掉后首页可直接开始', !!(await page.$('.action-card.primary')));

  await page.click('#guideBtn');
  await page.waitForTimeout(320);
  ok('首页「怎么玩」可以随时再看', (await page.$$('.overlay')).length === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(320);
  ok('按 Esc 也能关掉玩法介绍', (await page.$$('.overlay')).length === 0);

  await page.click('#guideBtn');
  await page.waitForTimeout(320);
  await page.mouse.click(6, 6);   // 点遮罩空白处
  await page.waitForTimeout(320);
  ok('点弹层外的空白处也能关掉', (await page.$$('.overlay')).length === 0);

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.action-card', { timeout: 9000 });
  await page.waitForTimeout(1400);
  ok('关过之后刷新不再自动弹玩法介绍', (await page.$$('.overlay')).length === 0);
  await ctx.close();

  /* =========================================================
     四、家长端
     ========================================================= */
  console.log('\n[三] 家长端');
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push('admin pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('admin console: ' + m.text()); });

  await page.goto(HOST + '/admin.html', { waitUntil: 'load' });
  await page.waitForSelector('#loginBtn', { timeout: 8000 });
  ok('家长端显示登录框', !!(await page.$('#pw')));

  // 错误口令
  await page.fill('#pw', 'wrong-one');
  await page.click('#loginBtn');
  await page.waitForTimeout(600);
  ok('错误口令提示', (await page.textContent('#loginErr')).length > 0);

  // 正确口令
  await page.fill('#pw', PW);
  await page.click('#loginBtn');
  await page.waitForSelector('.tabs', { timeout: 8000 });
  ok('正确口令登录成功', (await page.$$('.tab')).length === 3);

  // ---- 识字总览看板：总数 / 已经认识 / 需要练习 / 尚未测试 ----
  await page.waitForSelector('#dashBox .dash-item', { timeout: 8000 });
  ok('页面顶部有识字总览看板（4 块）', (await page.$$('#dashBox .dash-item')).length === 4);
  const dashLabels = await page.$$eval('#dashBox .dash-item .k', els => els.map(e => e.textContent.trim()));
  ok('看板四块名称与顺序正确',
    JSON.stringify(dashLabels) === JSON.stringify(['字库总数', '已经认识', '需要练习', '尚未测试']),
    { dashLabels });
  const dashVals = await page.$$eval('#dashBox .dash-item .v', els => els.map(e => parseInt(e.textContent, 10)));
  ok('看板数量自洽（总数 = 认识 + 需要练习 + 尚未测试）',
    dashVals[0] === dashVals[1] + dashVals[2] + dashVals[3] && dashVals[0] > 0, { dashVals });
  ok('看板显示识字率', /\d+(\.\d+)?%/.test(await page.textContent('#dashBox .rate')));
  ok('顶栏不再重复放一份统计胶囊（只保留看板）', (await page.$$('.top .stats .pill')).length === 0);

  // 字库列表
  await page.waitForSelector('.chr', { timeout: 8000 });
  ok('字库列表渲染', (await page.$$('.chr')).length > 0);

  // ---- 分组标签卡：点一下直接看这一类，不用再手选筛选条件 ----
  await page.waitForSelector('.chips .chip', { timeout: 8000 });
  ok('字库顶部有 6 张分组标签卡', (await page.$$('.chips .chip')).length === 6);
  const chipLabels = await page.$$eval('.chips .chip .ct', els => els.map(e => e.textContent.trim()));
  ok('标签卡名称与顺序正确',
    JSON.stringify(chipLabels) === JSON.stringify(['全部', '认识', '不认识', '未测', '家长添加', '自带字库']),
    { chipLabels });
  ok('默认选中「全部」', await page.$eval('.chip.g-all', e => e.classList.contains('on')));
  const cn = await page.$$eval('.chips .chip .cn', els => els.map(e => +e.textContent));
  ok('标签卡数量合计自洽（全部 = 认识+不认识+未测 = 家长添加+自带）',
    cn[0] === cn[1] + cn[2] + cn[3] && cn[0] === cn[4] + cn[5] && cn[0] > 0, { nums: cn });

  // 点「不认识」——旧版要手选下拉框才发现是空的，现在一点就有结果
  await page.click('.chip.g-unknown');
  await page.waitForTimeout(800);
  ok('点「不认识」后该卡高亮', await page.$eval('.chip.g-unknown', e => e.classList.contains('on')));
  ok('切换分组后「全部」不再高亮', !(await page.$eval('.chip.g-all', e => e.classList.contains('on'))));
  let tags = await page.$$eval('.chr .tag', els => els.map(e => e.textContent.trim()));
  ok('「不认识」分组里全是「不认识」的字',
    tags.filter(t => t === '不认识').length > 0 && tags.filter(t => t === '认识').length === 0,
    { tags: tags.slice(0, 8) });

  // 点「认识」
  await page.click('.chip.g-known');
  await page.waitForTimeout(800);
  tags = await page.$$eval('.chr .tag', els => els.map(e => e.textContent.trim()));
  ok('「认识」分组里全是「认识」的字',
    tags.filter(t => t === '认识').length > 0 && tags.filter(t => t === '不认识').length === 0,
    { tags: tags.slice(0, 8) });

  // 点「自带字库」——不应混进家长添加的字
  await page.click('.chip.g-seed');
  await page.waitForTimeout(800);
  tags = await page.$$eval('.chr .tag', els => els.map(e => e.textContent.trim()));
  ok('「自带字库」分组里没有家长添加的字',
    tags.length > 0 && tags.filter(t => t === '家长添加').length === 0, { tags: tags.slice(0, 8) });

  // 点「家长添加」——此刻一个字都还没加，应给出针对性空提示而不是干巴巴一句「没有」
  await page.click('.chip.g-parent');
  await page.waitForTimeout(800);
  const parentEmpty = await page.textContent('#chrBox');
  ok('「家长添加」为空时给出针对性提示', parentEmpty.includes('新增汉字'), { t: parentEmpty.slice(0, 60) });

  // 分组内检索：选中「自带字库」后用拼音搜
  await page.click('.chip.g-seed');
  await page.waitForTimeout(700);
  await page.fill('#q', 'ming');
  await page.waitForTimeout(900);
  ok('选中分组内仍可检索（拼音 → 汉字）', (await page.$$('.chr')).length > 0, { n: (await page.$$('.chr')).length });

  // 在空的「家长添加」里搜不到时，给出「到全部里搜一搜」的出口
  await page.click('.chip.g-parent');
  await page.waitForTimeout(800);
  ok('当前分组搜不到时给出「到全部里搜一搜」出口', !!(await page.$('#searchAllBtn')),
    { t: (await page.textContent('#chrBox')).slice(0, 60) });
  await page.click('#searchAllBtn');
  await page.waitForTimeout(900);
  ok('点出口后自动切到「全部」并出结果',
    (await page.$eval('.chip.g-all', e => e.classList.contains('on'))) && (await page.$$('.chr')).length > 0);
  await page.fill('#q', '');
  await page.waitForTimeout(700);

  // 看板四块都能点，直接跳到字库对应分组
  await page.click('#dashBox .dash-item.d-known');
  await page.waitForTimeout(900);
  ok('点看板「已经认识」直接跳到该分组',
    (await page.$eval('.chip.g-known', e => e.classList.contains('on'))) && (await page.$$('.chr')).length > 0);
  await page.click('#dashBox .dash-item.d-untested');
  await page.waitForTimeout(900);
  ok('点看板「尚未测试」直接跳到该分组',
    await page.$eval('.chip.g-untested', e => e.classList.contains('on')));
  await page.click('.chip.g-all');
  await page.waitForTimeout(800);

  // 新增字
  await page.click('[data-tab="add"]');
  await page.waitForSelector('#hzInput', { timeout: 5000 });

  // ---- 中文输入法回归：拼字过程中输入框不能被清空 ----
  // 旧实现会在 composition 的 input 事件里把拼音串（如 "hua"）过滤成空串直接写回 value，
  // 等于打断输入法，表现为「输入框打不进字」。
  await page.focus('#hzInput');
  const ime = await page.evaluate(() => {
    const el = document.querySelector('#hzInput');
    el.value = '';
    const out = {};
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = 'hu';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'hu' }));
    out.afterFirst = el.value;
    el.value = 'hua';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'hua' }));
    out.afterMore = el.value;
    el.value = '花';
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '花' }));
    out.committed = el.value;
    return out;
  });
  ok('输入法拼字过程中输入框不被清空', ime.afterFirst === 'hu' && ime.afterMore === 'hua', ime);
  ok('输入法上屏后留下汉字', ime.committed === '花', ime);
  await page.waitForTimeout(800);
  ok('输入法上屏后自动出预览（带拼音）', (await page.textContent('#preview')).includes('huā'),
    { pv: (await page.textContent('#preview')).slice(0, 40) });

  // 非汉字字符仍应被过滤
  await page.click('#clearBtn');
  await page.type('#hzInput', 'a');
  await page.waitForTimeout(200);
  ok('纯字母输入被过滤（只收汉字）', (await page.inputValue('#hzInput')) === '');

  // 框里已有字时再输入，应当替换而不是拼接
  const replaced = await page.evaluate(() => {
    const el = document.querySelector('#hzInput');
    el.value = '花';
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const afterStart = el.value;
    el.value = 'hao';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'hao' }));
    el.value = '好';
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '好' }));
    return { afterStart, final: el.value };
  });
  ok('框内已有字时，打新字会替换旧字', replaced.afterStart === '', replaced);

  await page.fill('#hzInput', '皓');
  await page.waitForTimeout(800);
  ok('输入汉字后出预览（带拼音）', (await page.textContent('#preview')).includes('hào'), { pv: (await page.textContent('#preview')).slice(0, 40) });
  ok('提示「字库里还没有这个字」', (await page.textContent('#libInfo')).includes('还没有'));
  await page.click('.state-opt[data-st="known"]');
  await page.click('#saveBtn');
  await page.waitForTimeout(900);
  ok('新增后输入框清空', (await page.inputValue('#hzInput')) === '');

  // 再加一次同字 → 应走「更新状态」而非重复新增
  await page.fill('#hzInput', '皓');
  await page.waitForTimeout(800);
  ok('再次输入提示「已经有这个字」', (await page.textContent('#libInfo')).includes('已经有'));
  await page.click('.state-opt[data-st="unknown"]');
  await page.click('#saveBtn');
  await page.waitForTimeout(900);

  const lk = await apiCall('GET', '/admin/lookup?hanzi=' + encodeURIComponent('皓'), null, tk);
  ok('「皓」在字库中且状态为不认识', lk.body.inLibrary === true && lk.body.status === 'unknown', lk.body);
  ok('「皓」的拼音已自动补全', lk.body.libraryEntry && lk.body.libraryEntry.pinyin === 'hào', lk.body.libraryEntry);

  // 字库里改状态
  await page.click('[data-tab="chars"]');
  await page.waitForSelector('.chr', { timeout: 8000 });

  // 「家长添加」分组里应当直接列出刚加的「皓」，不用先搜
  await page.click('.chip.g-parent');
  await page.waitForTimeout(900);
  const pRows = await page.$$eval('.chr .hz', els => els.map(e => e.textContent.trim()));
  ok('「家长添加」分组直接列出刚添加的「皓」', pRows.includes('皓'), { rows: pRows });
  ok('该字带「家长添加」来源标记', (await page.$$('.chr .tag.parent')).length > 0);

  await page.fill('#q', '皓');
  await page.waitForTimeout(800);
  const row = await page.$('.chr');
  ok('搜到家长添加的「皓」', !!row);
  await page.click('.chr [data-act="know"]');
  await page.waitForTimeout(900);
  const lk2 = await apiCall('GET', '/admin/lookup?hanzi=' + encodeURIComponent('皓'), null, tk);
  ok('在字库里点勾后状态变为认识', lk2.body.status === 'known', lk2.body);

  // 改完状态，「认识」分组里应立刻能看到它（标签卡数量同步刷新）
  await page.click('.chip.g-known');
  await page.waitForTimeout(900);
  ok('改状态后「认识」分组里出现「皓」',
    (await page.$$eval('.chr .hz', els => els.map(e => e.textContent.trim()))).includes('皓'));
  await page.fill('#q', '');
  await page.waitForTimeout(700);

  // 设置页：进度只在顶部看板，这里不重复
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(400);
  ok('设置页有改口令入口', !!(await page.$('#pwSave')));
  ok('设置页不再重复显示进度（进度只在顶部看板）',
    !(await page.textContent('#view')).includes('总体进度'));
  ok('切到设置页时顶部看板仍然在', (await page.$$('#dashBox .dash-item')).length === 4);

  // 清理：删掉测试加的字
  await apiCall('DELETE', '/admin/chars/' + encodeURIComponent('皓'), null, tk);
  await apiCall('POST', '/admin/reset', { keepSessions: false }, tk);
  await ctx.close();

  /* ---------------- 收尾 ---------------- */
  await browser.close();

  console.log('\n[五] 控制台');
  // 过滤白名单：
  //   favicon / ResizeObserver —— 浏览器噪声
  //   Failed to load resource ... 401 —— 家长端故意用错口令登录的预期响应（验证 401 分支）
  const realErrors = errors.filter(e => !/favicon|ResizeObserver/i.test(e)
    && !/Failed to load resource.*401/i.test(e));
  ok('全流程零 JS 报错', realErrors.length === 0, realErrors.slice(0, 6));

  console.log('\n──────────────────────────────');
  console.log((fail ? '❌' : '✅') + ' 通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(2); });
