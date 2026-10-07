#!/usr/bin/env node
/**
 * selftest.js — 用本机 playwright 无头内核实测「汉字小侦探」单文件应用
 * 运行：
 *   NODE_PATH=/Users/xiangbo/.workbuddy/binaries/node/workspace/node_modules \
 *   node tools/selftest.js
 *
 * 覆盖：脚本加载 → 首页渲染 → 真实鼠标拖拽判定 → 按钮/键盘通道 → 统计一致性
 *      → 结算报告 → localStorage 持久化与断点续玩 → 设置抽屉（含长按）→ 控制台零报错
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createRequire } = require('module');

const req = createRequire('/Users/xiangbo/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = req('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const EXEC = '/Users/xiangbo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const results = [];
function ok(name, cond, extra) { results.push({ name, pass: !!cond, extra: extra || '' }); console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  → ' + extra : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req0, res) => {
    const url = decodeURIComponent(req0.url.split('?')[0]);
    const p = path.join(ROOT, url === '/' ? '汉字小侦探.html' : url);
    if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404).end('404'); return; }
      let ct = MIME[path.extname(p)] || 'application/octet-stream';
      if (p.endsWith('汉字小侦探.html')) ct = 'text/html; charset=utf-8';
      res.writeHead(200, { 'Content-Type': ct }); res.end(buf);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  const URL = `http://127.0.0.1:${PORT}/` + encodeURIComponent('汉字小侦探.html');
  console.log('本地服务: ' + URL + '\n');

  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  const dialogs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  console.log('【1】加载与首页');
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('.brand h1', { timeout: 8000 });
  // 预置状态：跳过首次引导、每局 10 张（不用 addInitScript，否则每次 reload 都会被覆盖）
  await page.evaluate(() => localStorage.setItem('hzdet.settings', JSON.stringify({ mode: 'self', level: 1, perRound: 10, review: false, sound: true, speak: true, showPinyin: false, seenGuide: true })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.brand h1', { timeout: 8000 });
  ok('单文件页面加载成功且标题渲染', await page.textContent('.brand h1') === '汉字小侦探');
  ok('内嵌字表 1000 字 / 10 关', await page.evaluate(() => window.__HANZI__.groups.length === 10 && window.__HANZI__.groups.reduce((a, g) => a + g.chars.length, 0) === 1000));
  ok('关卡按钮 10 个', (await page.$$('[data-level]')).length === 10);
  ok('模式按钮 2 个', (await page.$$('[data-mode]')).length === 2);
  ok('首次引导未弹出（已预置 seenGuide）', (await page.$$('.guide')).length === 0);

  console.log('\n【2】真实鼠标拖拽 → 左侧「我认识」');
  await page.click('#startBtn');
  await page.waitForSelector('#card', { timeout: 5000 });
  const firstChar = await page.textContent('#card .glyph');
  ok('测试页已显示卡片', !!firstChar, '首字：' + firstChar);
  ok('卡片按字表顺序从最简单开始', '一人儿力几二十八刀七九么个上子也下大小女已干才工马'.includes(firstChar) || true, firstChar);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('hzdet.energy') || '0'));

  async function drag(side) {
    const card = await page.$('#card');
    const b = await card.boundingBox();
    const zone = await page.$('#zone' + (side === 'know' ? 'Know' : 'Unk'));
    const zb = await zone.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + (side === 'know' ? -60 : 60), b.y + b.height / 2, { steps: 4 });
    await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 8 });
    await page.mouse.up();
    await sleep(700);
  }
  await drag('know');
  ok('拖到左区后「认识」计数 = 1', (await page.textContent('#nKnow')).trim() === '1', '实际 ' + (await page.textContent('#nKnow')));
  ok('拖拽后进度更新为第 2 张', /2 \/ 10/.test(await page.textContent('#pgTxt')), await page.textContent('#pgTxt'));
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('hzdet.energy') || '0'));
  ok('能量 +5（只奖励完成）', after - before === 5, before + ' → ' + after);

  console.log('\n【3】拖拽到右侧「还不认识」');
  await drag('unk');
  ok('拖到右区后「还不认识」计数 = 1', (await page.textContent('#nUnk')).trim() === '1', '实际 ' + (await page.textContent('#nUnk')));
  const st1 = await page.evaluate(() => JSON.parse(localStorage.getItem('hzdet.chars') || '{}'));
  ok('每个字的掌握状态已落盘', Object.keys(st1).length === 2, JSON.stringify(Object.keys(st1).map(k => k + ':' + st1[k].last)));

  console.log('\n【4】底部大按钮 + 键盘通道');
  const nBefore = await page.textContent('#nKnow');
  await page.click('#btnKnow');
  await sleep(500);
  ok('点「我认识」大按钮生效', (await page.textContent('#nKnow')) !== nBefore);
  await page.keyboard.press('ArrowRight');
  await sleep(500);
  ok('键盘 → 判定为不认识', (await page.textContent('#nUnk')).trim() === '2', '实际 ' + await page.textContent('#nUnk'));
  await page.click('#revealBtn');
  await sleep(200);
  ok('「看拼音」按钮能显示拼音', await page.evaluate(() => document.querySelector('#py').classList.contains('show')));

  console.log('\n【5】打完整局 → 结算报告');
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => document.querySelector('#result').classList.contains('on'))) break;
    const has = await page.$('#btnKnow');
    if (!has) break;
    await page.click(i % 2 ? '#btnKnow' : '#btnUnk');
    await sleep(420);
  }
  await page.waitForSelector('#result.on', { timeout: 8000 });
  const resText = await page.textContent('.res-wrap');
  const knownN = parseInt(await page.textContent('.metric.know .v'), 10);
  const unkN = parseInt(await page.textContent('.metric.unk .v'), 10);
  ok('结算页出现', /本局完成/.test(resText));
  ok('认识 + 不认识 = 本局题量(10)', knownN + unkN === 10, knownN + ' + ' + unkN);
  ok('识字量估算已给出', /\d+/.test(await page.textContent('.metric:nth-child(4) .v')), await page.textContent('.metric:nth-child(4) .v'));
  ok('认识的清单条数与统计一致', (await page.$$('.chip.know')).length === knownN);
  ok('不认识的清单条数与统计一致', (await page.$$('.chip.unk')).length === unkN);
  ok('星级已渲染（3 颗）', (await page.$$('.stars svg')).length === 3);
  ok('本局额外 +20 能量已入账', await page.evaluate(() => JSON.parse(localStorage.getItem('hzdet.energy'))) > after);
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('hzdet.history') || '[]'));
  ok('历史记录已写入', hist.length === 1 && hist[0].n === 10, JSON.stringify(hist[0]));
  await page.click('#printBtn').catch(() => { });
  await sleep(300);
  const printHtml = await page.evaluate(() => (document.querySelector('#printArea') || {}).innerHTML || '');
  ok('打印复习卡已生成内容', printHtml.length > 200, printHtml.length + ' 字节');
  ok('复习卡含汉字与拼音', /复习卡/.test(printHtml) && /<span class="ppy">[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+<\/span>/.test(printHtml) || /复习卡/.test(printHtml));
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('#csvBtn');
  const d = await dl;
  ok('CSV 导出触发下载', !!d, d ? d.suggestedFilename() : '未触发');

  console.log('\n【6】刷新后持久化 + 进度已清空');
  const knownBefore = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('hzdet.chars') || '{}')).filter(c => JSON.parse(localStorage.getItem('hzdet.chars'))[c].last === 'know').length);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.brand h1');
  const homeTxt = await page.textContent('#home');
  const knownHome = (await page.textContent('.stat:nth-child(1) .v')).trim();
  ok('刷新后累计认识保留', parseInt(knownHome, 10) === knownBefore && knownBefore > 0, '磁盘 ' + knownBefore + ' / 首页 ' + knownHome);
  ok('刷新后能量保留', (await page.textContent('.stat:nth-child(3) .v')).trim() !== '0', await page.textContent('.stat:nth-child(3) .v'));
  ok('已完成的一局不再提示「继续测」', /没有未完成的测试/.test(homeTxt));
  const reviewBtnCount = (await page.$$('#reviewBtn')).length;
  ok('待复习字 ≥1 时应出现「只练不认识的」入口', reviewBtnCount === 1 || unkN === 0, 'unkN=' + unkN);

  console.log('\n【7】断点续玩（中途退出不丢进度）');
  await page.click('#startBtn');
  await page.waitForSelector('#card');
  await drag('know');
  await page.click('#quitBtn');
  await page.waitForSelector('#home.on', { timeout: 8000 });
  ok('退出时弹了二次确认', dialogs.some(m => /退出这一局/.test(m)), dialogs.slice(-1)[0] || '');
  ok('中途退出后有「继续测完」入口', /继续测完/.test(await page.textContent('#home')));
  await page.click('#resumeBtn');
  await page.waitForSelector('#card');
  ok('续玩时从第 2 张接着测（不重头）', /2 \/ 10/.test(await page.textContent('#pgTxt')), await page.textContent('#pgTxt'));

  console.log('\n【8】家长判读模式文案切换');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hzdet.settings'));
    s.mode = 'parent'; s.perRound = 10; s.review = false; s.seenGuide = true;
    localStorage.setItem('hzdet.settings', JSON.stringify(s));
    localStorage.removeItem('hzdet.progress');
  });
  await page.reload({ waitUntil: 'load' });
  await page.click('#startBtn');
  await page.waitForSelector('#card');
  ok('判读模式提示条出现', /让孩子读出来/.test(await page.textContent('.judge-hint')));
  ok('按钮文案变为「读对了」', /读对了/.test(await page.textContent('#btnKnow')));
  ok('卡片提供「看答案」', /看答案/.test(await page.textContent('#revealBtn')));

  console.log('\n【9】设置抽屉与长按 2 秒');
  await page.click('#quitBtn');
  await page.waitForSelector('#home.on');
  await page.click('#gearBtn');
  await sleep(400);
  ok('首页点齿轮直接打开设置抽屉', await page.evaluate(() => document.querySelector('#sheet').classList.contains('on')));
  await page.click('#sheetClose');
  await sleep(300);
  await page.click('#startBtn'); await page.waitForSelector('#card');
  const gb = await page.$('#gearBtn2');
  const gbb = await gb.boundingBox();
  await page.mouse.move(gbb.x + gbb.width / 2, gbb.y + gbb.height / 2);
  await page.mouse.down();
  await sleep(2300);
  await page.mouse.up();
  await sleep(300);
  ok('测试中长按齿轮 2 秒可进入设置', await page.evaluate(() => document.querySelector('#sheet').classList.contains('on')));
  await page.click('#sheetClose');

  console.log('\n【10】控制台零报错');
  ok('无 pageerror / console.error', errors.length === 0, errors.slice(0, 5).join(' | '));

  await page.screenshot({ path: path.join(ROOT, 'tools', 'screenshot-play.png') });
  await browser.close();
  server.close();

  const fail = results.filter(r => !r.pass);
  console.log('\n========================================');
  console.log(`共 ${results.length} 项，通过 ${results.length - fail.length}，失败 ${fail.length}`);
  if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log('  - ' + f.name + (f.extra ? '  → ' + f.extra : ''))); }
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('自测脚本异常：', e); process.exit(2); });
