-- ===========================================================
--  汉字小侦探 · D1 数据库结构（SQLite）
--  一次性执行：wrangler d1 execute <db> --file=worker/schema.sql
--  设计要点：
--   · chars   —— 学习范围（1000 基础字 + 家长新增的字），难度排序靠 difficulty
--   · progress —— 每个字的掌握状态：known / unknown（未出现在表里 = 还没测过）
--   · sessions —— 每局记录（关卡推进 / 练习）
--   · settings —— 家长密码哈希、登录令牌等
-- ===========================================================

CREATE TABLE IF NOT EXISTS chars (
  hanzi        TEXT PRIMARY KEY,                      -- 汉字
  pinyin       TEXT    NOT NULL DEFAULT '',           -- 拼音（带声调）
  pinyin_plain TEXT    NOT NULL DEFAULT '',           -- 拼音（无声调，供搜索，如 mu）
  strokes      INTEGER NOT NULL DEFAULT 0,            -- 笔画数
  radical      TEXT    NOT NULL DEFAULT '',           -- 部首
  structure    TEXT    NOT NULL DEFAULT '',           -- 结构
  freq_rank    INTEGER NOT NULL DEFAULT 999999,       -- 真实字频排名（越小越常用）
  difficulty   INTEGER NOT NULL DEFAULT 0,            -- 难度分 = strokes * 1000000 + freq_rank，越小越简单
  words        TEXT    NOT NULL DEFAULT '[]',         -- 常见组词，JSON 数组（3–5 个）
  source       TEXT    NOT NULL DEFAULT 'seed',       -- seed（内置）| parent（家长新增）
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chars_difficulty ON chars(difficulty);
CREATE INDEX IF NOT EXISTS idx_chars_source     ON chars(source);
CREATE INDEX IF NOT EXISTS idx_chars_plain      ON chars(pinyin_plain);

CREATE TABLE IF NOT EXISTS progress (
  hanzi         TEXT PRIMARY KEY,
  status        TEXT    NOT NULL,                     -- known | unknown
  known_count   INTEGER NOT NULL DEFAULT 0,           -- 累计答「认识」次数
  unknown_count INTEGER NOT NULL DEFAULT 0,           -- 累计答「不认识」次数
  round_count   INTEGER NOT NULL DEFAULT 0,           -- 累计被作答次数
  first_seen_at INTEGER NOT NULL DEFAULT 0,
  last_seen_at  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (hanzi) REFERENCES chars(hanzi) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_progress_status ON progress(status);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL DEFAULT 'level',        -- level | practice
  level_no   INTEGER NOT NULL DEFAULT 0,              -- 关卡序号（练习局为 0）
  mode       TEXT    NOT NULL DEFAULT 'self',         -- self | parent
  total      INTEGER NOT NULL DEFAULT 0,
  known      INTEGER NOT NULL DEFAULT 0,
  unknown    INTEGER NOT NULL DEFAULT 0,
  stars      INTEGER NOT NULL DEFAULT 0,
  avg_dwell  INTEGER NOT NULL DEFAULT 0,              -- 平均停留毫秒
  device     TEXT    NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL DEFAULT 0,
  ended_at   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
