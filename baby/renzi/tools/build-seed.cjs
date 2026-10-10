#!/usr/bin/env node
/**
 * build-seed.cjs —— 由 src/hanzi.json 生成 D1 种子数据 worker/seed.sql
 *
 * 产物包含：
 *   1) 1000 个内置字（含拼音 / 笔画 / 部首 / 结构 / 字频 / 难度分 / 组词）
 *   2) 家长端口令的初始哈希（仅首次写入，不覆盖已改过的口令）
 *
 * 幂等：内置字用 ON CONFLICT DO UPDATE（仅更新 source='seed' 的记录），
 *       家长自建的字与家长改过的数据都不会被覆盖。
 *
 * 用法：
 *   node tools/build-seed.cjs
 *   wrangler d1 execute hanzi-baby --local  --file=worker/schema.sql
 *   wrangler d1 execute hanzi-baby --local  --file=worker/seed.sql
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const IN_FILE = path.join(ROOT, 'src', 'hanzi.json');
const OUT_FILE = path.join(ROOT, 'worker', 'seed.sql');

const INITIAL_PASSWORD = 'momo2026';     // 家长端初始口令（可在 admin 页修改）
const FIXED_SALT = 'hzdet-seed-2026';    // 固定盐，保证重复生成结果一致

const q = s => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
const hashPassword = (pw, salt) => crypto.createHash('sha256').update(salt + '::' + pw).digest('hex');

// 带声调拼音 → 无声调（供搜索：搜 "mu" 也要能命中 "mù"）
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

const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
const flat = data.groups.flatMap(g => g.chars);
const now = Date.now();

const lines = [];
lines.push('-- ============================================================');
lines.push('--  自动生成，请勿手改 —— 由 tools/build-seed.cjs 产出');
lines.push('--  生成时间：' + new Date().toISOString());
lines.push('--  内置字：' + flat.length + ' 个');
lines.push('-- ============================================================');
lines.push('');

/* 1) 内置字（分批写，避免单条 SQL 超长触发 SQLITE_TOOBIG）---------------- */
const rows = flat.map(x => {
  const strokes = x.s || 0;
  const freq = x.f || 999999;
  const diff = strokes * 1000000 + freq;
  const words = JSON.stringify(Array.isArray(x.w) ? x.w : []);
  return `(${q(x.c)},${q(x.p)},${q(plainPinyin(x.p))},${strokes},${q(x.r)},${q(x.st)},${freq},${diff},${q(words)},'seed',${now},${now})`;
});

const BATCH = 150;
const COLS = 'INSERT INTO chars (hanzi,pinyin,pinyin_plain,strokes,radical,structure,freq_rank,difficulty,words,source,created_at,updated_at) VALUES';
const CONFLICT = [
  'ON CONFLICT(hanzi) DO UPDATE SET',
  '  pinyin=excluded.pinyin, pinyin_plain=excluded.pinyin_plain, strokes=excluded.strokes, radical=excluded.radical,',
  '  structure=excluded.structure, freq_rank=excluded.freq_rank, difficulty=excluded.difficulty,',
  '  words=excluded.words, updated_at=excluded.updated_at',
  "WHERE chars.source='seed';",
].join('\n');

for (let i = 0; i < rows.length; i += BATCH) {
  lines.push(COLS);
  lines.push(rows.slice(i, i + BATCH).join(',\n'));
  lines.push(CONFLICT);
  lines.push('');
}

/* 2) 家长口令（仅首次写入）-------------------------------------------- */
const hash = FIXED_SALT + ':' + hashPassword(INITIAL_PASSWORD, FIXED_SALT);
lines.push('-- 家长端口令：初始为 ' + INITIAL_PASSWORD + '（首次写入；已改过口令不会被覆盖）');
lines.push('INSERT OR IGNORE INTO settings (key,value,updated_at) VALUES');
lines.push(`('password_hash',${q(hash)},${now});`);
lines.push('');

fs.writeFileSync(OUT_FILE, lines.join('\n'));

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
const wordStats = flat.map(x => (x.w || []).length);
console.log('✅ 种子数据已写入 ' + OUT_FILE);
console.log('   内置字 ' + flat.length + ' 个，体积 ' + kb + ' KB');
console.log('   组词数：最少 ' + Math.min(...wordStats) + '，最多 ' + Math.max(...wordStats) +
  '，平均 ' + (wordStats.reduce((a, b) => a + b, 0) / flat.length).toFixed(2));
console.log('   口令哈希算法：sha256(salt::password)（与 worker/auth.js 一致）');
