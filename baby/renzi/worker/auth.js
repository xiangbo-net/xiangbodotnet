/**
 * auth.js —— 家长端口令校验与登录令牌（零依赖，用 Web Crypto）
 *
 * 密码以「<salt>:<sha256(salt::password)>」形式存在 settings 表，
 * 明文永不落库；登录成功后签发随机令牌，同样存 settings，默认 30 天有效。
 */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  const s = salt || crypto.randomUUID().replace(/-/g, '');
  const h = await sha256Hex(s + '::' + password);
  return s + ':' + h;
}

export async function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const salt = stored.split(':')[0];
  return (await hashPassword(password, salt)) === stored;
}

const TOKEN_TTL = 30 * 24 * 3600 * 1000; // 30 天

export async function issueToken(db) {
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  const now = Date.now();
  await db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,?)')
    .bind('token:' + token, String(now + TOKEN_TTL), now).run();
  return { token, expiresAt: now + TOKEN_TTL };
}

export async function revokeToken(db, token) {
  if (!token) return;
  await db.prepare('DELETE FROM settings WHERE key = ?').bind('token:' + token).run();
}

export async function checkToken(db, token) {
  if (!token) return false;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('token:' + token).first();
  if (!row) return false;
  return Date.now() < Number(row.value);
}

export function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
