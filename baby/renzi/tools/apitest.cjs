#!/usr/bin/env node
/**
 * apitest.cjs —— 本地/线上后端接口全链路自测
 *   node tools/apitest.cjs [baseUrl]
 *   默认 http://127.0.0.1:8787/api/baby
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8787/api/baby';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

async function call(method, path, body, token) {
  const headers = { 'Accept': 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch (e) { j = { parseError: true }; }
  return { status: r.status, body: j };
}

(async function () {
  console.log('测试目标：' + BASE + '\n');

  /* 1. 公开接口 */
  console.log('[1] 公开接口');
  let r = await call('GET', '/bootstrap');
  ok('bootstrap 200', r.status === 200, r);
  const chars = r.body.chars || [];
  ok('字表 1000 字', chars.length === 1000, { n: chars.length });
  ok('字表按难度升序', chars.every((c, i) => i === 0 || c.d >= chars[i - 1].d));
  ok('每个字都有拼音', chars.every(c => c.p && c.p.length));
  const withWords = chars.filter(c => (c.w || []).length >= 3).length;
  ok('组词 ≥3 的字 ≥ 90%', withWords >= 900, { withWords });
  ok('含 config.perLevel', r.body.config && r.body.config.perLevel === 20, r.body.config);
  ok('含 stats', !!r.body.stats && r.body.stats.total === 1000, r.body.stats);

  /* 2. 家长登录 */
  console.log('\n[2] 家长登录');
  r = await call('POST', '/admin/login', { password: 'wrong-password' });
  ok('错误口令被拒 401', r.status === 401, r);

  r = await call('POST', '/admin/login', { password: 'momo2026' });
  ok('正确口令登录成功', r.status === 200 && !!r.body.token, r);
  const token = r.body.token;

  /* 3. 鉴权 */
  console.log('\n[3] 鉴权');
  r = await call('GET', '/admin/chars');
  ok('无令牌被拒 401', r.status === 401, r);
  r = await call('GET', '/admin/chars', null, 'bogus-token');
  ok('假令牌被拒 401', r.status === 401, r);

  /* 4. 字库查询 */
  console.log('\n[4] 字库查询');
  r = await call('GET', '/admin/chars?size=10', null, token);
  ok('列表返回 10 条', r.body.list && r.body.list.length === 10, { n: r.body.list && r.body.list.length });
  ok('总数为 1000', r.body.total === 1000, { total: r.body.total });
  r = await call('GET', '/admin/chars?q=ming&size=50', null, token);
  ok('按无声调拼音搜索有结果', r.body.total > 0, { total: r.body.total });
  r = await call('GET', '/admin/chars?q=明&size=5', null, token);
  ok('按汉字搜索命中', r.body.total === 1, { total: r.body.total });
  r = await call('GET', '/admin/chars?status=untested&size=5', null, token);
  ok('按未测筛选', r.status === 200, r);

  /* 5. 查字补全 */
  console.log('\n[5] 查字补全');
  r = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('皓'), null, token);
  ok('lookup 皓 成功', r.status === 200 && r.body.dict, r);
  ok('皓 有拼音', r.body.dict && !!r.body.dict.pinyin, r.body.dict);
  ok('皓 有笔画', r.body.dict && r.body.dict.strokes > 0, r.body.dict);
  ok('皓 未在字库中', r.body.inLibrary === false, r.body);
  r = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('明'), null, token);
  ok('明 有组词', r.body.dict && r.body.dict.words && r.body.dict.words.length >= 3, r.body.dict);
  r = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('木'), null, token);
  ok('木 已在字库中', r.body.inLibrary === true, r.body);

  /* 6. 新增 / 更新字（核心需求） */
  console.log('\n[6] 新增与更新字');
  r = await call('POST', '/admin/chars', { hanzi: '皓', known: true }, token);
  ok('新增「皓」+标认识', r.status === 200 && r.body.created === true, r);
  ok('新增后统计已认识 ≥1', r.body.stats.known >= 1, r.body.stats);

  let r2 = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('皓'), null, token);
  ok('「皓」已进入字库', r2.body.inLibrary === true, r2.body);
  ok('「皓」状态为 known', r2.body.status === 'known', r2.body);

  // 已有字 → 按「是否认识」更新状态（不新增）
  r = await call('POST', '/admin/chars', { hanzi: '皓', known: false }, token);
  ok('已有字不重复新增', r.body.created === false, r);
  r2 = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('皓'), null, token);
  ok('「皓」状态更新为 unknown', r2.body.status === 'unknown', r2.body);

  // 内置字改状态
  r = await call('POST', '/admin/chars', { hanzi: '木', known: true }, token);
  ok('内置字「木」标为认识', r.status === 200 && r.body.created === false, r);
  r = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('木'), null, token);
  ok('「木」状态为 known', r.body.status === 'known', r.body);

  /* 7. 对局提交（整局结束上传） */
  console.log('\n[7] 对局提交');
  const before = (await call('GET', '/bootstrap')).body.stats;
  r = await call('POST', '/round', {
    kind: 'level', levelNo: 1, mode: 'self',
    marks: { '口': 'known', '手': 'unknown', '大': 'known', '小': 'unknown' },
    avgDwell: 1500, stars: 3, device: 'apitest', startedAt: Date.now() - 60000, endedAt: Date.now()
  });
  ok('提交对局成功', r.status === 200 && r.body.saved === 4, r);
  ok('返回更新后的进度', !!r.body.progress, r.body);
  ok('统计已测 +4', r.body.stats.tested === before.tested + 4, { before: before.tested, after: r.body.stats.tested });
  ok('认识数 +2', r.body.stats.known === before.known + 2, { before: before.known, after: r.body.stats.known });
  ok('口 已记为认识', r.body.progress['口'] && r.body.progress['口'].st === 'known', r.body.progress['口']);

  // 同一字再答一次「不认识」→ 状态翻转、累计计数增加
  r = await call('POST', '/round', { kind: 'level', levelNo: 1, marks: { '口': 'unknown' } });
  ok('重复提交可翻转状态', r.body.progress['口'].st === 'unknown', r.body.progress['口']);
  ok('累计计数 > 1', r.body.progress['口'].k >= 1 && r.body.progress['口'].u >= 1, r.body.progress['口']);

  /* 8. 统计 */
  console.log('\n[8] 统计');
  r = await call('GET', '/admin/stats', null, token);
  ok('stats 返回结构完整', r.body.stats && !!r.body.recent && !!r.body.byDay, Object.keys(r.body));
  ok('家长添加字计数 ≥1', r.body.parentChars >= 1, { parentChars: r.body.parentChars });

  /* 9. 重置某个字 */
  console.log('\n[9] 重置与删除');
  r = await call('POST', '/admin/chars/reset', { hanzi: '手' }, token);
  ok('重置「手」为未测', r.status === 200, r);
  const rr = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('手'), null, token);
  ok('「手」状态已清空', rr.body.status === null, rr.body);

  r = await call('DELETE', '/admin/chars/' + encodeURIComponent('木'), null, token);
  ok('内置字不可删除 403', r.status === 403, r);

  r = await call('DELETE', '/admin/chars/' + encodeURIComponent('皓'), null, token);
  ok('家长添加字可删除', r.status === 200, r);
  const r3 = await call('GET', '/admin/lookup?hanzi=' + encodeURIComponent('皓'), null, token);
  ok('「皓」已从字库移除', r3.body.inLibrary === false, r3.body);

  /* 10. 改口令 + 复原 */
  console.log('\n[10] 改口令');
  r = await call('POST', '/admin/password', { oldPassword: 'bad', newPassword: 'aaaa' }, token);
  ok('原口令错误被拒 401', r.status === 401, r);
  r = await call('POST', '/admin/password', { oldPassword: 'momo2026', newPassword: 'test1234' }, token);
  ok('改口令成功', r.status === 200, r);
  r = await call('GET', '/admin/chars', null, token);
  ok('改口令后旧令牌失效 401', r.status === 401, r);
  let r4 = await call('POST', '/admin/login', { password: 'test1234' });
  ok('新口令可登录', r4.status === 200 && !!r4.body.token, r4);
  // 改回去
  r = await call('POST', '/admin/password', { oldPassword: 'test1234', newPassword: 'momo2026' }, r4.body.token);
  ok('口令复原成功', r.status === 200, r);

  /* 11. 收尾：清空测试进度 */
  console.log('\n[11] 复原测试数据');
  const tk = (await call('POST', '/admin/login', { password: 'momo2026' })).body.token;
  r = await call('POST', '/admin/reset', { keepSessions: false }, tk);
  ok('清空进度成功', r.status === 200 && r.body.stats.known === 0, r.body.stats);

  console.log('\n──────────────────────────────');
  console.log((fail ? '❌' : '✅') + ' 通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(2); });
