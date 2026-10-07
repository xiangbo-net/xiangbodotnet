#!/usr/bin/env node
/**
 * build-hanzi.cjs — 生成 1000 字汉字表（纯离线，无网络依赖）
 *
 * 选字与排序规则：
 *   1) 基础字 300 字：人工圈定（4 岁儿童概念最简单 + 小学低年级最常用），保证入选
 *   2) 补足 700 字：取 SUBTLEX-CH 真实字频榜前列，过滤掉黑名单（文言虚词/天干/语气词/
 *      成人或暴力字/音译名用字）与 16 画以上，并要求在常用词中真实出现
 *   3) 统一排序：笔画数由少到多 → 同笔画按真实使用频率由高到低
 *      （即「由简单到复杂」，同一难度内高频字优先）
 *   4) 切分为 10 关 × 100 字
 *   5) 字段：汉字 / 拼音（带声调）/ 笔画数 / 部首 / 结构 / 常用词 / 字频排名
 *
 * 数据来源（均来自 npm 包，已本地安装）：
 *   - pinyin-pro         拼音（主，声调准确）
 *   - cnchar-all         笔画数 / 部首 / 结构 / 组词兜底
 *   - subtlex-ch-chr     字频（46.8M 影视字幕语料）
 *   - subtlex-ch-wf      词频（用于挑选「常用词」）
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
const BASE_FILE = path.join(ROOT, 'src', 'base-chars.json');
const OUT_FILE = path.join(ROOT, 'src', 'hanzi.json');
const REPORT_FILE = path.join(ROOT, 'tools', 'hanzi-qa-report.txt');

const TOTAL = 1000;
const GROUPS = 10;
const PER_GROUP = TOTAL / GROUPS;

// 排除字：文言虚词 / 天干 / 语气词 / 成人或暴力含义 / 音译外来名用字
const BLACKLIST = new Set((
  '之与而则乃矣焉乎者亦且其以于曰兮哉夫' +
  '甲乙丙丁戊己庚辛壬癸' +
  '哦嗯呗嘛啦唔嗨哼哎咦呐嗷嘿呦嘞咯咧啰噢喔唷' +
  '尸凶亡丧葬坟赌毒枪炮妓娼妖鬼魔疯醉囚狱刑死杀骗毁暴傻仇恨' +
  '蒂鲁奥瑞娜莎妮迪耶稣佛玛勒姆诺' +
  '尔俺咱兹廿卅兀乜弋亓仃阝卩' +
  '屎尿屁怂怼屌艾斗纳莱搞克秀俩丈' +
  '尼弗兰伊犯伦乔罗杰凯莉咖波哈帝洛哇威萨曼啡恋恶谎婚婆斯誓酷摩罪某' +
  '妃妖姆妞妮妃'
).split(''));

// 排除词：不适宜出现在儿童测试材料里的常用词
const WORD_BLACKLIST = new Set([
  '老婆', '妻子', '情人', '恋爱', '结婚', '离婚', '凶手', '骗子', '犯罪', '监狱',
  '坟墓', '私情', '怀孕', '死亡', '自杀', '醉酒', '疯子', '妓女', '魔鬼', '妖怪',
  '情人', '老婆', '傻', '赌博', '毒品', '枪支', '尸体',
  '女朋友', '男朋友', '血迹', '遗弃', '粗话', '家伙'
]);

// 虚词不做组词（本身无实义，硬配词只会很怪）
const FUNCTION_CHARS = new Set('的了呢吧吗呀'.split(''));

// 多音字常用读音人工校准（4 岁测试场景下孩子最可能先学会的读音）
// ⚠️ 必须保证 key 不重复（JS 对象重复 key 会后值覆盖前值，曾因此把「重」标成 chóng）
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

const isHanzi = ch => /^[\u4e00-\u9fa5]$/.test(ch);

function pinyinOf(ch) {
  if (POLYPHONE[ch]) return { value: POLYPHONE[ch], src: 'override', other: '' };
  let pPro = '';
  try { const r = pp.pinyin(ch, { toneType: 'symbol', type: 'array' }); pPro = r && r[0] ? r[0] : ''; } catch (e) {}
  let cn = '';
  try { cn = String(C.spell(ch, 'low', 'tone')); } catch (e) {}
  // pinyin-pro 声调数据明显更准（cnchar 大量字声调有误），故以其为主
  const value = pPro || cn;
  return { value, src: pPro ? 'pinyin-pro' : 'cnchar', other: pPro ? cn : '' };
}
function strokesOf(ch) { try { const s = C.stroke(ch); return typeof s === 'number' ? s : 0; } catch (e) { return 0; } }
function radicalOf(ch) {
  try { const r = C.radical(ch); if (Array.isArray(r) && r[0]) return { radical: r[0].radical, struct: r[0].struct }; } catch (e) {}
  return { radical: '', struct: '' };
}

// ---------- 1. 基础字 300 ----------
const baseRaw = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
const baseChars = [];
const baseIssues = [];
for (const [key, g] of Object.entries(baseRaw.groups)) {
  const chars = [...g.chars.replace(/\s/g, '')];
  if (chars.length !== 100) baseIssues.push(`${key} 长度 ${chars.length}（应为 100）`);
  chars.forEach((ch, i) => {
    if (!isHanzi(ch)) baseIssues.push(`非汉字「${ch}」(${key} 第 ${i + 1} 位)`);
    else if (baseChars.includes(ch)) baseIssues.push(`重复字「${ch}」(${key})`);
    else baseChars.push(ch);
  });
  console.log(`[基础字] ${key} → ${chars.length} 字  ${g.name}`);
}
if (baseIssues.length) { console.log('\n⚠️ 基础字表问题：'); baseIssues.forEach(s => console.log('   - ' + s)); }
console.log(`[基础字] 合计去重 ${baseChars.length} 字`);

// ---------- 2. 字频榜 + 词证据 ----------
const freqRank = new Map();
CHR.forEach((row, i) => { if (!freqRank.has(row.Character)) freqRank.set(row.Character, i + 1); });

const setSoFar = new Set(baseChars);
const pool = [];
for (const [ch, rank] of freqRank) {
  if (setSoFar.has(ch) || BLACKLIST.has(ch) || !isHanzi(ch)) continue;
  const st = strokesOf(ch);
  if (st < 1 || st > 16) continue;
  pool.push({ ch, rank, stroke: st });
}
pool.sort((a, b) => a.rank - b.rank);
const poolSet = new Set(pool.map(p => p.ch));

const wordCount = new Map();
for (const w of WF) {
  if (w.Word.length < 2 || w.Word.length > 4 || !/^[\u4e00-\u9fa5]+$/.test(w.Word)) continue;
  for (const ch of new Set(w.Word.split(''))) {
    if (!poolSet.has(ch)) continue;
    wordCount.set(ch, (wordCount.get(ch) || 0) + (w.WCount || 0));
  }
}
const extra = [];
const need = TOTAL - baseChars.length;
for (const p of pool) {
  if ((wordCount.get(p.ch) || 0) >= 200) { extra.push(p); if (extra.length >= need) break; }
}
if (extra.length < need) {
  console.log(`⚠️ 常用词证据筛选后仅 ${extra.length} 个，放宽阈值补足`);
  for (const p of pool) {
    if (extra.find(e => e.ch === p.ch)) continue;
    extra.push(p);
    if (extra.length >= need) break;
  }
}
console.log(`[补字] 候选 ${pool.length} → 入选 ${extra.length}（需要 ${need}）`);

// ---------- 3. 统一排序 + 切关 ----------
const all = [...baseChars.map(ch => ({ ch, from: 'base' })), ...extra.map(p => ({ ch: p.ch, from: 'freq' }))];
for (const it of all) { it.stroke = strokesOf(it.ch); it.rank = freqRank.get(it.ch) || 999999; }
all.sort((a, b) => (a.stroke - b.stroke) || (a.rank - b.rank) || a.ch.codePointAt(0) - b.ch.codePointAt(0));

const list = all.slice(0, TOTAL);
const set = new Set(list.map(x => x.ch));
const droppedBase = baseChars.filter(c => !set.has(c));

// ---------- 4. 组词：优先「整词都在字表内」的常用双字词 ----------
const wordIndex = new Map();
const wordIndexLow = new Map();
for (const w of WF) {
  if (w.Word.length < 2 || w.Word.length > 3 || !/^[\u4e00-\u9fa5]+$/.test(w.Word)) continue;
  if (WORD_BLACKLIST.has(w.Word)) continue;
  if (w.Word[0] === w.Word[1] && !'舅姑姨叔爸妈哥姐弟妹爷奶婆娃'.includes(w.Word[0])) continue;
  const cnt = w.WCount || 0;
  if (cnt < 1) continue;
  for (const ch of new Set(w.Word.split(''))) {
    if (!set.has(ch)) continue;
    if (cnt >= 20) { (wordIndex.get(ch) || wordIndex.set(ch, []).get(ch)).push({ word: w.Word, count: cnt }); }
    (wordIndexLow.get(ch) || wordIndexLow.set(ch, []).get(ch)).push({ word: w.Word, count: cnt });
  }
}
function pickWords(ch) {
  if (FUNCTION_CHARS.has(ch)) return [];
  const cands = (wordIndex.get(ch) || wordIndexLow.get(ch) || [])
    .filter(c => c.word.length === 2)                       // 只要双字词，避免「高君禾」这类专名
    .slice().sort((a, b) => b.count - a.count);
  const inSet = cands.filter(c => [...c.word].every(x => set.has(x)));
  const picked = [];
  const push = w => { if (w && !picked.includes(w)) picked.push(w); };
  push(inSet[0] && inSet[0].word);
  push(inSet[1] && inSet[1].word);
  push(cands[0] && cands[0].word);
  if (picked.length < 2) {
    try {
      const ws = (C.words(ch, ch, 'first') || []).filter(w => w.length === 2);
      [...ws.filter(w => [...w].every(x => set.has(x))), ...ws].forEach(w => push(w));
    } catch (e) {}
  }
  return picked.slice(0, 2);
}

// ---------- 5. 组装关卡 ----------
const pinyinReview = [];
const groups = [];
for (let g = 0; g < GROUPS; g++) {
  const items = list.slice(g * PER_GROUP, (g + 1) * PER_GROUP).map(it => {
    const py = pinyinOf(it.ch);
    if (py.src !== 'override' && py.other && py.other !== py.value) {
      pinyinReview.push(`${it.ch}  采用 ${py.value}(pinyin-pro)  另一库给 ${py.other}(cnchar)`);
    }
    const r = radicalOf(it.ch);
    return { c: it.ch, p: py.value, s: it.stroke, r: r.radical, st: r.struct, f: it.rank, w: pickWords(it.ch) };
  });
  const strokes = items.map(i => i.s);
  groups.push({
    id: g + 1,
    avgStroke: +(strokes.reduce((a, b) => a + b, 0) / strokes.length).toFixed(1),
    minStroke: Math.min(...strokes),
    maxStroke: Math.max(...strokes),
    chars: items
  });
}

// ---------- 6. 输出 ----------
const flat = groups.flatMap(g => g.chars);
const out = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    total: flat.length,
    groups: GROUPS,
    perGroup: PER_GROUP,
    source: '小学低年级基础字(300, 人工圈定) + SUBTLEX-CH 真实字频榜常用字(700, 过滤生僻/不适宜字)',
    order: '关卡内：笔画数由少到多；同笔画按真实使用频率由高到低',
    frequency: 'SUBTLEX-CH 影视字幕语料 46.8M 字',
    pinyin: 'pinyin-pro 为主 + 多音字人工校准 ' + Object.keys(POLYPHONE).length + ' 字'
  },
  groups
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out));

const dupCheck = flat.length - new Set(flat.map(x => x.c)).size;
const missing = flat.filter(x => !x.c || !x.p || !x.s || x.s < 1);
const monotonic = groups.every((g, i) => i === 0 || g.avgStroke >= groups[i - 1].avgStroke);

const rep = [];
rep.push('=========== 汉字表 QA 报告 ===========');
rep.push(`生成时间：${out.meta.generatedAt}`);
rep.push(`总字数 ${flat.length}（目标 ${TOTAL}）| 重复 ${dupCheck} | 字段缺失 ${missing.length} | 基础字命中 ${flat.filter(x => baseChars.includes(x.c)).length}/${baseChars.length}`);
if (baseIssues.length) { rep.push('基础字表问题：'); baseIssues.forEach(s => rep.push('   - ' + s)); }
if (droppedBase.length) rep.push(`⚠️ 被挤出 1000 字的基础字：${droppedBase.join('')}`);
rep.push('');
rep.push('关卡难度（笔画数递增检查）：');
groups.forEach(g => rep.push(`  第 ${String(g.id).padStart(2)} 关  ${g.chars.length} 字  平均笔画 ${g.avgStroke}  范围 ${g.minStroke}-${g.maxStroke}  首字 ${g.chars[0].c}  末字 ${g.chars[g.chars.length - 1].c}`));
rep.push(`  → 平均笔画单调递增：${monotonic ? '✅ 通过' : '❌ 不通过'}`);
rep.push('');
rep.push(`拼音交叉核对（pinyin-pro 主 / cnchar 参考，不一致 ${pinyinReview.length} 条，已采用 pinyin-pro）：`);
pinyinReview.forEach(s => rep.push('   ' + s));
rep.push('');
rep.push(`字段缺失明细（${missing.length}）：`);
missing.forEach(m => rep.push(`   ${m.c} p=${m.p} s=${m.s} w=${JSON.stringify(m.w)}`));
rep.push('');
const manualHits = Object.keys(POLYPHONE).filter(c => set.has(c));
rep.push(`多音字人工校准生效 ${manualHits.length} 字：` + manualHits.map(c => `${c}=${POLYPHONE[c]}`).join(' '));
rep.push('');
const oddWords = [];
flat.forEach(x => x.w.forEach(w => {
  const outside = [...w].filter(ch => !set.has(ch));
  if (outside.length) oddWords.push(`${x.c} → ${w}（含表外字 ${outside.join('')}）`);
}));
rep.push(`组词含表外字的条目（${oddWords.length}，供复核）：`);
oddWords.slice(0, 40).forEach(s => rep.push('   ' + s));
rep.push('');
rep.push('抽检 32 字（人工核对拼音/笔画/部首/组词）：');
flat.filter((_, i) => i % 31 === 0).slice(0, 32).forEach(x => rep.push(`   ${x.c}  ${x.p.padEnd(9)} ${String(x.s).padStart(2)}画  部首 ${x.r.padEnd(2)} ${x.st}  ${x.w.join(' / ')}`));
rep.push('');
groups.forEach(g => rep.push(`第 ${String(g.id).padStart(2)} 关：` + g.chars.map(x => x.c).join(' ')));
fs.writeFileSync(REPORT_FILE, rep.join('\n'));
console.log('\n' + rep.slice(0, 40).join('\n'));
console.log(`\n✅ 字表已写入 ${OUT_FILE}（完整报告：${REPORT_FILE}）`);
