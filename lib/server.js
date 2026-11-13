// Shared Cloudflare Pages Functions helpers. No dependencies.
const encoder = new TextEncoder();
const COOKIE = '__Host-scary_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function fail(status, message) { throw new HttpError(status, message); }

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

export async function handle(context, callback) {
  try {
    if (!context.env.DB) fail(503, 'Database not connected. Add the Cloudflare D1 binding named DB.');
    if (context.request.method !== 'GET') {
      // Same-origin JSON requests only. Prevent cross-site form/CSRF requests.
      const origin = context.request.headers.get('Origin');
      if (origin !== new URL(context.request.url).origin) fail(403, 'Request origin not allowed.');
      if (!(context.request.headers.get('Content-Type') || '').startsWith('application/json')) {
        fail(415, 'Only JSON requests are accepted.');
      }
    }
    return await callback(context);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('ScAry Net request failed', error);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

export async function bodyJSON(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 8192) fail(413, 'Request too large.');
  const raw = await request.text();
  if (raw.length > 8192) fail(413, 'Request too large.');
  let obj;
  try { obj = JSON.parse(raw); } catch { fail(400, 'Invalid JSON.'); }
  if (!obj || Array.isArray(obj) || typeof obj !== 'object') fail(400, 'Invalid request.');
  return obj;
}

export function username(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(name)) fail(400, 'Usernames must be 3–20 letters, numbers or underscores.');
  return name;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(value) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
export function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 20000, salt: encoder.encode(salt) },
    material, 256
  );
  return toHex(bits);
}
export function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function cookieHeader(token, deleteCookie = false) {
  const value = deleteCookie ? '' : token;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; ${deleteCookie ? 'Max-Age=0' : `Max-Age=${SESSION_SECONDS}`}`;
}
export async function createSession(db, userId) {
  const token = randomSecret();
  const digest = await sha256(token);
  const expires = Date.now() + SESSION_SECONDS * 1000;
  await db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(digest, userId, expires).run();
  return token;
}
function getCookie(request) {
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  return match ? match.slice(COOKIE.length + 1) : null;
}
export async function getSession(context, required = true) {
  const token = getCookie(context.request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    if (required) fail(401, 'Please log in.');
    return null;
  }
  const digest = await sha256(token);
  const user = await context.env.DB.prepare(`
    SELECT u.id, u.username FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(digest, Date.now()).first();
  if (!user && required) fail(401, 'Session expired. Please log in again.');
  return user || null;
}
export async function revokeSession(context) {
  const token = getCookie(context.request);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await context.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
}

// Fixed-window limits. IP keys are SHA-256 digests rather than raw IP addresses.
export async function rateLimit(context, scope, maxHits, windowMs, identifier) {
  const ip = context.request.headers.get('cf-connecting-ip') || 'unknown';
  const key = await sha256(`v1|${scope}|${identifier || ip}`);
  const now = Date.now();
  const resetAt = now + windowMs;
  await context.env.DB.prepare(`
    INSERT INTO rate_limits(key, hits, resets_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN rate_limits.resets_at <= ? THEN 1 ELSE rate_limits.hits + 1 END,
      resets_at = CASE WHEN rate_limits.resets_at <= ? THEN excluded.resets_at ELSE rate_limits.resets_at END
  `).bind(key, resetAt, now, now).run();
  const info = await context.env.DB.prepare('SELECT hits FROM rate_limits WHERE key = ?').bind(key).first();
  if (info && info.hits > maxHits) fail(429, 'Too many requests. Please try again later.');
}
