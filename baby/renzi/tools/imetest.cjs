#!/usr/bin/env node
/**
 * imetest.cjs —— 用 CDP 的 Input.imeSetComposition 模拟真实中文输入法，验证新增字输入框可输入。
 * 这是对「家长端新增汉字输入框打不进字」bug 最贴近真实场景的回归验证。
 */
const { createRequire } = require('module');
const req = createRequire('/Users/xiangbo/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = req('playwright-core');

const EXEC = '/Users/xiangbo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const HOST = 'http://127.0.0.1:8787';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x != null ? '  → ' + JSON.stringify(x) : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  await page.goto(HOST + '/admin', { waitUntil: 'load' });
  await page.fill('#pw', 'momo2026');
  await page.click('#loginBtn');
  await page.waitForSelector('#app', { state: 'visible', timeout: 8000 });
  await page.click('[data-tab="add"]');
  await page.waitForSelector('#hzInput', { timeout: 5000 });

  await page.focus('#hzInput');
  await page.evaluate(() => { document.querySelector('#hzInput').value = ''; });

  // 1) 一步一步「敲拼音」——真实输入法会持续派发 compositionupdate
  await cdp.send('Input.imeSetComposition', { text: 'h', selectionStart: 1, selectionEnd: 1 });
  const v1 = await page.inputValue('#hzInput');
  await cdp.send('Input.imeSetComposition', { text: 'hu', selectionStart: 2, selectionEnd: 2 });
  const v2 = await page.inputValue('#hzInput');
  await cdp.send('Input.imeSetComposition', { text: 'hua', selectionStart: 3, selectionEnd: 3 });
  const v3 = await page.inputValue('#hzInput');
  console.log('   拼字中间态：', JSON.stringify([v1, v2, v3]));
  ok('真实输入法拼字过程中输入框保留拼音串', v1 === 'h' && v2 === 'hu' && v3 === 'hua', { v1, v2, v3 });

  // 2) 上屏（候选词被选中）
  await cdp.send('Input.insertText', { text: '花' });
  await page.waitForTimeout(900);
  const committed = await page.inputValue('#hzInput');
  ok('真实输入法上屏后留下汉字', committed === '花', { committed });

  const pv = await page.textContent('#preview');
  ok('上屏后自动查出拼音/笔画/组词', pv.includes('huā') && pv.includes('7 画'), { pv: pv.slice(0, 60) });

  // 3) 连续输入第二个字（覆盖上一次）
  await cdp.send('Input.imeSetComposition', { text: 'hao', selectionStart: 3, selectionEnd: 3 });
  const w1 = await page.inputValue('#hzInput');
  await cdp.send('Input.insertText', { text: '好' });
  await page.waitForTimeout(900);
  const w2 = await page.inputValue('#hzInput');
  ok('可连续输入第二个字', w1 === 'hao' && w2 === '好', { w1, w2 });

  await browser.close();
  console.log('\n' + (fail ? '❌' : '✅') + ' 通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(2); });
