#!/usr/bin/env node
/**
 * build-dict.cjs — 生成「查字字典」，供家长端新增汉字时自动补全
 *
 * 产出：worker/dict.json
 *   紧凑格式：{ "字": ["拼音", 笔画, "部首", "结构", "词1|词2|词3"] }
 *   覆盖 SUBTLEX-CH 真实字频榜前列常用字（默认 6000 字），含拼音 / 笔画 / 部首 / 结构 / 2–4 组词。
 *
 * 数据来源与主字表一致：
 *   pinyin-pro（拼音主源，声调准确） / cnchar-all（笔画 / 部首 / 结构） / subtlex-ch-wf（组词）
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const req = createRequire('/Users/xiangbo/.workbuddy/binaries/node/workspace/package.json');
const C = req('cnchar-all');
const pp = req('pinyin-pro');
const CHR = req('subtlex-ch-chr').default.data;
const WF = req('subtlex-ch-wf').default.data;

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'worker', 'dict.json');

const MAX_CHARS = 6000;          // 覆盖范围：字频榜前 N 个汉字
const MIN_STROKE = 1, MAX_STROKE = 24;

// 多音字校准（与 build-hanzi.cjs 保持同一份，4 岁场景下最可能先学会的读音）
const POLYPHONE = {
  长: 'cháng', 乐: 'lè', 和: 'hé', 了: 'le', 的: 'de', 着: 'zhe', 得: 'de',
  地: 'dì', 只: 'zhī', 数: 'shù', 觉: 'jué', 少: 'shǎo', 好: 'hǎo', 行: 'xíng',
  会: 'huì', 为: 'wèi', 应: 'yīng', 干: 'gān', 处: 'chù', 种: 'zhǒng', 发: 'fā',
  空: 'kōng', 相: 'xiāng', 都: 'dōu', 还: 'hái', 分: 'fēn', 中: 'zhōng',
  曲: 'qǔ', 兴: 'xìng', 降: 'jiàng', 系: 'xì', 似: 'sì', 调: 'tiáo', 重: 'zhòng',
  角: 'jiǎo', 便: 'biàn', 呀: 'ya', 哪: 'nǎ', 埋: 'mái', 落: 'luò', 挑: 'tiāo',
  转: 'zhuǎn', 结: 'jié', 藏: 'cáng', 强: 'qiáng', 扇: 'shàn', 血: 'xuè',
  露: 'lù', 曾: 'céng', 待: 'dài', 磨: 'mó', 铺: 'pū', 涨: 'zhǎng', 圈: 'quān',
  散: 'sàn', 尽: 'jìn', 卷: 'juǎn', 吐: 'tǔ', 爪: 'zhuǎ', 薄: 'báo', 尾: 'wěi',
  教: 'jiào', 脏: 'zāng', 背: 'bèi', 冲: 'chōng', 倒: 'dào', 弹: 'tán', 漂: 'piāo',
  撒: 'sǎ', 华: 'huá', 号: 'hào', 更: 'gèng', 假: 'jiǎ', 间: 'jiān', 累: 'lèi',
  难: 'nán', 舍: 'shě', 盛: 'shèng', 暑: 'shǔ', 缩: 'suō', 塔: 'tǎ', 趟: 'tàng',
  鲜: 'xiān', 削: 'xiāo', 要: 'yào', 载: 'zài', 择: 'zé', 折: 'zhé', 子: 'zǐ',
  扎: 'zhā', 钻: 'zuān', 切: 'qiē'
};

// 组词黑名单：人名 / 音译 / 不适宜
const WORD_BLACKLIST = new Set([
  '老婆', '妻子', '情人', '恋爱', '结婚', '离婚', '凶手', '骗子', '犯罪', '监狱',
  '坟墓', '私情', '怀孕', '死亡', '自杀', '醉酒', '疯子', '妓女', '魔鬼', '妖怪',
  '赌博', '毒品', '枪支', '尸体', '女朋友', '男朋友', '血迹', '遗弃', '粗话', '家伙',
  '托比', '汤姆', '杰克', '玛丽', '约翰', '露西', '大卫', '彼得', '保罗', '蒂姆'
]);

const isHanzi = ch => /^[\u4e00-\u9fa5]$/.test(ch);

function pinyinOf(ch) {
  if (POLYPHONE[ch]) return POLYPHONE[ch];
  try { const r = pp.pinyin(ch, { toneType: 'symbol', type: 'array' }); return (r && r[0]) || ''; } catch (e) { return ''; }
}
function strokesOf(ch) { try { const s = C.stroke(ch); return typeof s === 'number' ? s : 0; } catch (e) { return 0; } }
function radicalOf(ch) {
  try { const r = C.radical(ch); if (Array.isArray(r) && r[0]) return { radical: r[0].radical || '', struct: r[0].struct || '' }; } catch (e) {}
  return { radical: '', struct: '' };
}

// ---------- 1. 选定覆盖范围 ----------
const freqRank = new Map();
CHR.forEach((row, i) => { if (!freqRank.has(row.Character)) freqRank.set(row.Character, i + 1); });

const scope = [];
for (const [ch, rank] of freqRank) {
  if (!isHanzi(ch)) continue;
  const st = strokesOf(ch);
  if (st < MIN_STROKE || st > MAX_STROKE) continue;
  scope.push(ch);
  if (scope.length >= MAX_CHARS) break;
}
console.log(`[覆盖范围] 字频榜前 ${scope.length} 个汉字`);
const scopeSet = new Set(scope);

// ---------- 2. 组词索引（只保留与范围内字相关的双字词）----------
const wordIndex = new Map();
for (const w of WF) {
  if (w.Word.length !== 2 || !/^[\u4e00-\u9fa5]+$/.test(w.Word)) continue;
  if (WORD_BLACKLIST.has(w.Word)) continue;
  if (w.Word[0] === w.Word[1]) continue;            // 去掉叠词
  const cnt = w.WCount || 0;
  if (cnt < 5) continue;
  for (const ch of new Set(w.Word.split(''))) {
    if (!scopeSet.has(ch)) continue;
    if (!wordIndex.has(ch)) wordIndex.set(ch, []);
    wordIndex.get(ch).push({ word: w.Word, count: cnt });
  }
}

function wordsOf(ch, n) {
  const cands = (wordIndex.get(ch) || []).slice().sort((a, b) => b.count - a.count);
  const inScope = cands.filter(c => [...c.word].every(x => scopeSet.has(x)));
  const picked = [];
  const push = w => { if (w && !picked.includes(w) && picked.length < n) picked.push(w); };
  inScope.forEach(c => push(c.word));
  if (picked.length < Math.min(2, n)) cands.forEach(c => push(c.word));
  // 词频表没覆盖到的字，用 cnchar 的组词兜底
  if (picked.length < 2) {
    try {
      const ws = (C.words(ch, ch, 'first') || []).filter(w => w.length === 2);
      [...ws.filter(w => [...w].every(x => scopeSet.has(x))), ...ws].forEach(w => push(w));
    } catch (e) { }
  }
  return picked;
}

// ---------- 3. 组装紧凑字典 ----------
const dict = {};
let withWords = 0, noWords = [];
for (const ch of scope) {
  const py = pinyinOf(ch);
  const st = strokesOf(ch);
  const r = radicalOf(ch);
  const ws = wordsOf(ch, 4);
  if (ws.length) withWords++; else noWords.push(ch);
  dict[ch] = [py, st, r.radical, r.struct, ws.join('|')];
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(dict));

const bytes = fs.statSync(OUT_FILE).size;
console.log(`[输出] ${OUT_FILE}`);
console.log(`  字数 ${Object.keys(dict).length}   体积 ${(bytes / 1024).toFixed(1)} KB`);
console.log(`  有组词 ${withWords}（${(withWords / scope.length * 100).toFixed(1)}%）  无组词 ${noWords.length}`);
console.log(`  读音校准生效 ${Object.keys(POLYPHONE).filter(c => scopeSet.has(c)).length} 字`);
console.log('  抽样：');
scope.filter((_, i) => i % 397 === 0).slice(0, 8).forEach(c => {
  const v = dict[c];
  console.log(`    ${c}  ${String(v[0]).padEnd(8)} ${String(v[1]).padStart(2)}画  ${v[2] || '-'} ${v[3] || '-'}  ${v[4] || '（无）'}`);
});
