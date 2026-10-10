/**
 * api.js —— 汉字小侦探后端接口（挂在 /api/baby/* 下）
 *
 * 公开（孩子端）：
 *   GET  /bootstrap          一次性拉取：字表 + 进度 + 最近对局 + 统计
 *   POST /round              整局结束批量提交（认字状态 / 对局记录）
 *
 * 家长端（除 login 外都需要 Bearer token）：
 *   POST   /admin/login              口令登录 → token
 *   POST   /admin/logout
 *   GET    /admin/chars              字库查询（搜索 / 状态筛选 / 分页）
 *   POST   /admin/chars              新增或更新一个字（已存在则按「是否认识」更新）
 *   DELETE /admin/chars/:hanzi       删除家长自建字
 *   POST   /admin/chars/reset        把某个字重置为「未测」
 *   GET    /admin/lookup             查字：拼音 / 笔画 / 部首 / 结构 / 组词
 *   POST   /admin/password           修改口令
 *   GET    /admin/stats              统计看板
 *   POST   /admin/reset              清空全部进度
 */
import { verifyPassword, hashPassword, issueToken, revokeToken, checkToken, bearer } from './auth.js';
import DICT from './dict.json';

const JSON_CT = { 'Content-Type': 'application/json; charset=utf-8' };

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};

const ok = (data, status) => new Response(JSON.stringify(Object.assign({ ok: true }, data)), { status: status || 200, headers: JSON_CT });
const fail = (error, status) => new Response(JSON.stringify({ ok: false, error }), { status: status || 400, headers: JSON_CT });

const isHanzi = s => typeof s === 'string' && /^[\u4e00-\u9fa5]$/.test(s);
const PER_LEVEL = 20;      // 每关字数
const PER_PRACTICE = 10;   // 练习每组字数

// 带声调拼音 → 无声调（与 tools/build-seed.cjs 保持一致，供搜索使用）
const TONE_MAP = {
  'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
  'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
  'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
  'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
  'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
  'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
  'ń': 'n', 'ň': 'n', 'ǹ': 'n', 'ḿ': 'm'
};
const plainPinyin = p => String(p || '').split('').map(ch => TONE_MAP[ch] || ch).join('').toLowerCase();

function dictOf(hanzi) {
  const v = DICT[hanzi];
  if (!v) return null;
  return {
    pinyin: v[0] || '',
    strokes: v[1] || 0,
    radical: v[2] || '',
    structure: v[3] || '',
    words: v[4] ? v[4].split('|').filter(Boolean) : [],
  };
}

async function computeStats(db) {
  const [tot, kn, un, par] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM chars').first(),
    db.prepare("SELECT COUNT(*) AS n FROM progress WHERE status='known'").first(),
    db.prepare("SELECT COUNT(*) AS n FROM progress WHERE status='unknown'").first(),
    db.prepare("SELECT COUNT(*) AS n FROM chars WHERE source = 'parent'").first(),
  ]);
  const total = tot.n || 0, known = kn.n || 0, unknown = un.n || 0;
  const parent = par.n || 0, seed = Math.max(0, total - parent);
  const tested = known + unknown;
  return {
    total, known, unknown, parent, seed,
    untested: Math.max(0, total - tested),
    tested,
    levelNo: Math.floor(tested / PER_LEVEL) + 1,
    totalLevels: Math.max(1, Math.ceil(total / PER_LEVEL)),
    practiceGroups: Math.max(0, Math.ceil(unknown / PER_PRACTICE)),
  };
}

/* ------------------------------------------------------------------ *
 *  公开接口
 * ------------------------------------------------------------------ */

// GET /bootstrap —— 前端启动时一次性拉全量（字表 + 进度 + 最近对局 + 统计）
async function bootstrap(request, env) {
  const db = env.DB;
  const [charsRes, progRes, sessRes] = await Promise.all([
    db.prepare('SELECT hanzi,pinyin,strokes,difficulty,words,source FROM chars ORDER BY difficulty, hanzi').all(),
    db.prepare('SELECT hanzi,status,known_count,unknown_count,last_seen_at FROM progress').all(),
    db.prepare('SELECT id,kind,level_no,mode,total,known,unknown,stars,avg_dwell,ended_at FROM sessions ORDER BY id DESC LIMIT 60').all(),
  ]);

  const chars = (charsRes.results || []).map(r => {
    let w = [];
    try { w = JSON.parse(r.words || '[]'); } catch (e) { w = []; }
    return { c: r.hanzi, p: r.pinyin, s: r.strokes, d: r.difficulty, w, src: r.source };
  });

  const progress = {};
  (progRes.results || []).forEach(r => {
    progress[r.hanzi] = { st: r.status, k: r.known_count, u: r.unknown_count, t: r.last_seen_at };
  });

  const sessions = (sessRes.results || []).map(r => ({
    id: r.id, kind: r.kind, lv: r.level_no, mode: r.mode, n: r.total,
    know: r.known, unk: r.unknown, stars: r.stars, dwell: r.avg_dwell, ts: r.ended_at,
  }));

  return ok({
    chars, progress, sessions,
    stats: await computeStats(db),
    config: { perLevel: PER_LEVEL, perPractice: PER_PRACTICE },
  });
}

// POST /round —— 整局结束（或中途退出）时批量提交
async function submitRound(request, env) {
  const db = env.DB;
  let body;
  try { body = await request.json(); } catch (e) { return fail('请求体不是合法 JSON'); }
  const marks = body && body.marks ? body.marks : {};
  const keys = Object.keys(marks).filter(isHanzi);
  if (!keys.length) return fail('marks 为空');

  const now = Date.now();
  const stmts = [];
  let known = 0, unknown = 0;

  for (const c of keys) {
    const side = marks[c] === 'known' ? 'known' : 'unknown';
    const isK = side === 'known' ? 1 : 0;
    const isU = side === 'known' ? 0 : 1;
    if (isK) known++; else unknown++;
    stmts.push(
      db.prepare(
        `INSERT INTO progress (hanzi,status,known_count,unknown_count,round_count,first_seen_at,last_seen_at,updated_at)
         VALUES (?1,?2,?3,?4,1,?5,?5,?5)
         ON CONFLICT(hanzi) DO UPDATE SET
           status = ?2,
           known_count = known_count + ?3,
           unknown_count = unknown_count + ?4,
           round_count = round_count + 1,
           last_seen_at = ?5,
           updated_at = ?5`
      ).bind(c, side, isK, isU, now)
    );
  }

  stmts.push(
    db.prepare(
      `INSERT INTO sessions (kind,level_no,mode,total,known,unknown,stars,avg_dwell,device,started_at,ended_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      body.kind === 'practice' ? 'practice' : 'level',
      Number(body.levelNo) || 0,
      body.mode === 'parent' ? 'parent' : 'self',
      keys.length, known, unknown,
      Math.max(0, Math.min(3, Number(body.stars) || 0)),
      Math.max(0, Math.round(Number(body.avgDwell) || 0)),
      String(body.device || '').slice(0, 60),
      Number(body.startedAt) || now, Number(body.endedAt) || now, now
    )
  );

  await db.batch(stmts);

  const prog = await db.prepare('SELECT hanzi,status,known_count,unknown_count,last_seen_at FROM progress').all();
  const progress = {};
  (prog.results || []).forEach(r => {
    progress[r.hanzi] = { st: r.status, k: r.known_count, u: r.unknown_count, t: r.last_seen_at };
  });

  return ok({ progress, stats: await computeStats(db), saved: keys.length, known, unknown });
}

/* ------------------------------------------------------------------ *
 *  家长端
 * ------------------------------------------------------------------ */

async function requireAuth(request, env) {
  const t = bearer(request);
  return (await checkToken(env.DB, t)) ? t : null;
}

async function adminLogin(request, env) {
  const db = env.DB;
  let body;
  try { body = await request.json(); } catch (e) { return fail('请求体不是合法 JSON'); }
  const row = await db.prepare("SELECT value FROM settings WHERE key='password_hash'").first();
  if (!row || !row.value) return fail('后端尚未初始化口令（请先执行 seed）', 500);
  if (!(await verifyPassword(String(body.password || ''), row.value))) return fail('口令不正确', 401);
  const t = await issueToken(db);
  return ok({ token: t.token, expiresAt: t.expiresAt });
}

async function adminLogout(request, env) {
  await revokeToken(env.DB, bearer(request));
  return ok({});
}

async function adminListChars(request, env, url) {
  const db = env.DB;
  const q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || 'all';   // all|known|unknown|untested
  const source = url.searchParams.get('source') || 'all';   // all|seed|parent
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const size = Math.min(200, Math.max(10, parseInt(url.searchParams.get('size') || '60', 10) || 60));

  const where = [], binds = [];
  if (q) {
    if (isHanzi(q)) { where.push('c.hanzi = ?'); binds.push(q); }
    else { where.push('(c.pinyin_plain LIKE ? OR c.pinyin LIKE ? OR c.hanzi LIKE ?)'); binds.push('%' + q.toLowerCase() + '%', '%' + q + '%', '%' + q + '%'); }
  }
  if (status === 'known') where.push("p.status = 'known'");
  else if (status === 'unknown') where.push("p.status = 'unknown'");
  else if (status === 'untested') where.push('p.hanzi IS NULL');
  if (source === 'seed' || source === 'parent') { where.push('c.source = ?'); binds.push(source); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const base = `FROM chars c LEFT JOIN progress p ON p.hanzi = c.hanzi ${whereSql}`;

  const cnt = await db.prepare('SELECT COUNT(*) AS n ' + base).bind(...binds).first();
  const rows = await db.prepare(
    `SELECT c.hanzi,c.pinyin,c.strokes,c.radical,c.words,c.source,c.difficulty,
            p.status,p.known_count,p.unknown_count,p.last_seen_at
     ${base} ORDER BY c.difficulty, c.hanzi LIMIT ? OFFSET ?`
  ).bind(...binds, size, (page - 1) * size).all();

  const list = (rows.results || []).map(r => {
    let w = [];
    try { w = JSON.parse(r.words || '[]'); } catch (e) { w = []; }
    return {
      hanzi: r.hanzi, pinyin: r.pinyin, strokes: r.strokes, radical: r.radical, words: w,
      source: r.source, difficulty: r.difficulty,
      status: r.status || null, knownCount: r.known_count || 0, unknownCount: r.unknown_count || 0,
      lastSeenAt: r.last_seen_at || 0,
    };
  });

  return ok({ total: cnt.n || 0, page, size, list, stats: await computeStats(db) });
}

// POST /admin/chars —— 新增或更新
// body: { hanzi, known?（true/false/null）, pinyin?, words?, strokes? }
async function adminUpsertChar(request, env) {
  const db = env.DB;
  let body;
  try { body = await request.json(); } catch (e) { return fail('请求体不是合法 JSON'); }
  const hanzi = String(body.hanzi || '').trim();
  if (!isHanzi(hanzi)) return fail('请提供单个汉字');

  const existing = await db.prepare('SELECT hanzi, source FROM chars WHERE hanzi = ?').bind(hanzi).first();
  const info = dictOf(hanzi);
  const now = Date.now();
  let created = false;

  if (!existing) {
    const py = String(body.pinyin || (info ? info.pinyin : '')).trim();
    const st = Number(body.strokes) || (info ? info.strokes : 0);
    const rad = info ? info.radical : '';
    const str = info ? info.structure : '';
    let ws = [];
    if (Array.isArray(body.words) && body.words.length) ws = body.words.slice(0, 6);
    else if (info && info.words.length) ws = info.words;
    const diff = st * 1000000 + 999999;   // 新字的字频未知，排在同笔画字的末尾

    await db.prepare(
      `INSERT INTO chars (hanzi,pinyin,pinyin_plain,strokes,radical,structure,freq_rank,difficulty,words,source,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(hanzi, py, plainPinyin(py), st, rad, str, 999999, diff, JSON.stringify(ws), 'parent', now, now).run();
    created = true;
  } else if (body.pinyin || body.strokes || Array.isArray(body.words)) {
    // 家长显式提供了补充信息 → 更新字条
    const cur = await db.prepare('SELECT * FROM chars WHERE hanzi = ?').bind(hanzi).first();
    const py = body.pinyin != null ? String(body.pinyin) : cur.pinyin;
    const st = Number(body.strokes) || cur.strokes;
    let ws = cur.words;
    if (Array.isArray(body.words) && body.words.length) ws = JSON.stringify(body.words.slice(0, 6));
    const diff = st * 1000000 + (cur.freq_rank || 999999);
    await db.prepare('UPDATE chars SET pinyin=?,pinyin_plain=?,strokes=?,difficulty=?,words=?,updated_at=? WHERE hanzi=?')
      .bind(py, plainPinyin(py), st, diff, ws, now, hanzi).run();
  }

  // 状态更新：known === true/false 时写 progress
  let status = null;
  if (body.known === true || body.known === false) {
    status = body.known ? 'known' : 'unknown';
    const isK = body.known ? 1 : 0;
    const isU = body.known ? 0 : 1;
    await db.prepare(
      `INSERT INTO progress (hanzi,status,known_count,unknown_count,round_count,first_seen_at,last_seen_at,updated_at)
       VALUES (?1,?2,?3,?4,1,?5,?5,?5)
       ON CONFLICT(hanzi) DO UPDATE SET status=?2, known_count=known_count+?3, unknown_count=unknown_count+?4, last_seen_at=?5, updated_at=?5`
    ).bind(hanzi, status, isK, isU, now).run();
  }

  return ok({
    hanzi, created, status,
    autoFilled: info ? { pinyin: info.pinyin, strokes: info.strokes, radical: info.radical, structure: info.structure, words: info.words } : null,
    stats: await computeStats(db),
  });
}

// DELETE /admin/chars/:hanzi —— 仅允许删家长自建字
async function adminDeleteChar(request, env, hanzi) {
  const db = env.DB;
  if (!isHanzi(hanzi)) return fail('非法的汉字');
  const row = await db.prepare('SELECT source FROM chars WHERE hanzi = ?').bind(hanzi).first();
  if (!row) return fail('字库中没有这个字', 404);
  if (row.source !== 'parent') return fail('内置字不可删除（可在字库里把它重置为「未测」）', 403);
  await db.batch([
    db.prepare('DELETE FROM progress WHERE hanzi = ?').bind(hanzi),
    db.prepare('DELETE FROM chars WHERE hanzi = ?').bind(hanzi),
  ]);
  return ok({ hanzi, stats: await computeStats(db) });
}

// POST /admin/chars/reset —— 把某个字重置为未测（内置字也可用）
async function adminResetChar(request, env) {
  const db = env.DB;
  let body;
  try { body = await request.json(); } catch (e) { return fail('请求体不是合法 JSON'); }
  const hanzi = String(body.hanzi || '').trim();
  if (!isHanzi(hanzi)) return fail('请提供单个汉字');
  await db.prepare('DELETE FROM progress WHERE hanzi = ?').bind(hanzi).run();
  return ok({ hanzi, stats: await computeStats(db) });
}

// GET /admin/lookup?hanzi=X
async function adminLookup(request, env, url) {
  const db = env.DB;
  const hanzi = (url.searchParams.get('hanzi') || '').trim();
  if (!isHanzi(hanzi)) return fail('请提供单个汉字');
  const info = dictOf(hanzi);
  const inLib = await db.prepare('SELECT hanzi,pinyin,strokes,words,source FROM chars WHERE hanzi = ?').bind(hanzi).first();
  const prog = await db.prepare('SELECT status,known_count,unknown_count FROM progress WHERE hanzi = ?').bind(hanzi).first();
  return ok({
    hanzi,
    dict: info,
    inLibrary: !!inLib,
    libraryEntry: inLib ? { pinyin: inLib.pinyin, strokes: inLib.strokes, words: (() => { try { return JSON.parse(inLib.words || '[]'); } catch (e) { return []; } })(), source: inLib.source } : null,
    status: prog ? prog.status : null,
    knownCount: prog ? prog.known_count : 0,
    unknownCount: prog ? prog.unknown_count : 0,
  });
}

async function adminChangePassword(request, env) {
  const db = env.DB;
  let body;
  try { body = await request.json(); } catch (e) { return fail('请求体不是合法 JSON'); }
  const cur = await db.prepare("SELECT value FROM settings WHERE key='password_hash'").first();
  if (!cur || !(await verifyPassword(String(body.oldPassword || ''), cur.value))) return fail('原口令不正确', 401);
  const np = String(body.newPassword || '');
  if (np.length < 4) return fail('新口令至少 4 位');
  const hashed = await hashPassword(np);
  await db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('password_hash',?,?)").bind(hashed, Date.now()).run();
  // 改密后清掉所有已签发令牌，强制重新登录
  await db.prepare("DELETE FROM settings WHERE key LIKE 'token:%'").run();
  return ok({});
}

async function adminStats(request, env) {
  const db = env.DB;
  const stats = await computeStats(db);
  const recent = await db.prepare(
    `SELECT kind,level_no,mode,total,known,unknown,stars,avg_dwell,ended_at
     FROM sessions ORDER BY id DESC LIMIT 20`
  ).all();
  const byDay = await db.prepare(
    `SELECT date(ended_at/1000,'unixepoch','localtime') AS d, COUNT(*) AS n,
            SUM(known) AS k, SUM(unknown) AS u
     FROM sessions GROUP BY d ORDER BY d DESC LIMIT 14`
  ).all();
  let parentCnt = { n: 0 };
  try { parentCnt = await db.prepare("SELECT COUNT(*) AS n FROM chars WHERE source='parent'").first(); } catch (e) {}
  return ok({ stats, parentChars: parentCnt.n || 0, recent: recent.results || [], byDay: byDay.results || [] });
}

async function adminReset(request, env) {
  const db = env.DB;
  let body = {};
  try { body = await request.json(); } catch (e) {}
  await db.prepare('DELETE FROM progress').run();
  if (body.keepSessions !== true) await db.prepare('DELETE FROM sessions').run();
  return ok({ stats: await computeStats(db) });
}

/* ------------------------------------------------------------------ *
 *  路由
 * ------------------------------------------------------------------ */

const ROUTES = [
  ['GET', /^\/bootstrap$/, (req, env, url) => bootstrap(req, env, url)],
  ['POST', /^\/round$/, (req, env) => submitRound(req, env)],
  ['POST', /^\/admin\/login$/, (req, env) => adminLogin(req, env)],
  ['POST', /^\/admin\/logout$/, (req, env) => adminLogout(req, env)],
  ['GET', /^\/admin\/chars$/, (req, env, url) => adminListChars(req, env, url)],
  ['POST', /^\/admin\/chars$/, (req, env) => adminUpsertChar(req, env)],
  ['POST', /^\/admin\/chars\/reset$/, (req, env) => adminResetChar(req, env)],
  ['DELETE', /^\/admin\/chars\/(.+)$/, (req, env, url, m) => adminDeleteChar(req, env, decodeURIComponent(m[1]))],
  ['GET', /^\/admin\/lookup$/, (req, env, url) => adminLookup(req, env, url)],
  ['POST', /^\/admin\/password$/, (req, env) => adminChangePassword(req, env)],
  ['GET', /^\/admin\/stats$/, (req, env) => adminStats(req, env)],
  ['POST', /^\/admin\/reset$/, (req, env) => adminReset(req, env)],
];

export async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api\/baby/, '') || '/';

  if (!env.DB) return fail('后端未绑定数据库（缺少 D1 绑定 DB）', 500);

  for (const [method, re, fn] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    if (request.method !== method) continue;
    // 家长端（login 除外）需要令牌
    const needAuth = path.indexOf('/admin/') === 0 && path.indexOf('/admin/login') !== 0;
    if (needAuth && !(await requireAuth(request, env))) return fail('登录已过期，请重新登录', 401);
    try {
      return await fn(request, env, url, m);
    } catch (e) {
      return fail('服务端错误：' + (e && e.message ? e.message : String(e)), 500);
    }
  }

  // 路径匹配但方法不对
  for (const [method, re] of ROUTES) {
    if (path.match(re)) return fail('不支持的请求方法 ' + request.method, 405);
  }
  return fail('接口不存在：' + path, 404);
}
