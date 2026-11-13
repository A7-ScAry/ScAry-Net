// ScAry Net email recovery helpers. Runs only in Cloudflare Pages Functions.
import { fail, sha256, randomSecret, secureEqual, rateLimit } from './server.js';

export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, 'Enter a valid email address.');
  return email;
}

export function requireEmailConfig(env) {
  if (!env.MAILJET_API_KEY || !env.MAILJET_SECRET_KEY || !env.SCARY_FROM_EMAIL || !env.RECOVERY_SECRET || String(env.RECOVERY_SECRET).length < 24) {
    fail(503, 'Email service is not configured yet. The owner must set Cloudflare email secrets.');
  }
}

async function keyedHash(env, value) {
  requireEmailConfig(env);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.RECOVERY_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const out = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
  return Array.from(out, b => b.toString(16).padStart(2, '0')).join('');
}

function code8() {
  const v = new Uint32Array(1);
  crypto.getRandomValues(v);
  return String(v[0] % 100000000).padStart(8, '0');
}

export async function sendEmail(env, to, subject, text) {
  requireEmailConfig(env);
  // Mailjet Send API v3.1. Keep credentials server-side in Cloudflare secrets.
  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET_KEY}`)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      Messages: [{
        From: {Email: String(env.SCARY_FROM_EMAIL).trim(), Name: 'ScAry Net'},
        To: [{Email: to}],
        Subject: subject,
        TextPart: text
      }]
    })
  });
  // Mailjet can report a message-level error in addition to HTTP errors.
  let data = null;
  try { data = await response.json(); } catch { /* Treat non-JSON as a failed send. */ }
  if (!response.ok || !data || !Array.isArray(data.Messages) ||
      data.Messages.length !== 1 || data.Messages[0].Status !== 'success') {
    console.error('ScAry Net Mailjet send failed', response.status,
      data?.Messages?.[0]?.Errors?.map(e => e.ErrorCode).filter(Boolean) || []);
    fail(503, 'Could not send email. Please try again later.');
  }
}

export async function sendNotice(env, email, subject, text) {
  if (!email) return;
  try { await sendEmail(env, email, subject, text); }
  catch { console.warn('Account updated, but email notification was unavailable.'); }
}

export async function issueCode(context, user, purpose, targetEmail) {
  const {env} = context;
  requireEmailConfig(env);
  if (!['verify_email','change_email','recover'].includes(purpose)) fail(400, 'Invalid email action.');
  await rateLimit(context, 'email_send_user', 4, 60*60*1000, user.id);
  await rateLimit(context, 'email_send_target', 4, 60*60*1000, targetEmail);
  const code = code8();
  const id = crypto.randomUUID();
  const codeHash = await keyedHash(env, `${id}|${user.id}|${purpose}|${code}`);
  const expires = Date.now() + 15*60*1000;
  await env.DB.prepare(`
    INSERT INTO email_challenges(id,user_id,purpose,target_email,code_hash,attempts,expires_at,created_at)
    VALUES(?,?,?,?,?,0,?,?)
    ON CONFLICT(user_id,purpose) DO UPDATE SET
      id=excluded.id, target_email=excluded.target_email,
      code_hash=excluded.code_hash, attempts=0,
      expires_at=excluded.expires_at, created_at=excluded.created_at
  `).bind(id,user.id,purpose,targetEmail,codeHash,expires,Date.now()).run();
  const title = purpose === 'recover' ? 'Account recovery' : purpose === 'change_email' ? 'Confirm your new email' : 'Verify your email';
  const extra = purpose === 'recover' ? `Your username is: @${user.username}\n\n` : '';
  try {
    await sendEmail(env, targetEmail, `ScAry Net — ${title}`, `${title}\n\n${extra}Your 8-digit code: ${code}\n\nExpires in 15 minutes. If you did not request this, ignore this email.\n\nScAry Net`);
  } catch (e) {
    await env.DB.prepare('DELETE FROM email_challenges WHERE id=?').bind(id).run();
    throw e;
  }
}

export async function consumeCode(env, userId, purpose, code) {
  requireEmailConfig(env);
  if (!/^\d{8}$/.test(String(code || ''))) fail(400, 'Enter the 8-digit email code.');
  const row = await env.DB.prepare('SELECT * FROM email_challenges WHERE user_id=? AND purpose=?')
    .bind(userId,purpose).first();
  if (!row || row.expires_at <= Date.now() || row.attempts >= 5) fail(400, 'Invalid or expired code. Request a new one.');
  await env.DB.prepare('UPDATE email_challenges SET attempts=attempts+1 WHERE id=?').bind(row.id).run();
  const digest = await keyedHash(env, `${row.id}|${userId}|${purpose}|${code}`);
  if (!secureEqual(row.code_hash, digest)) fail(400, 'Invalid or expired code. Request a new one.');
  await env.DB.prepare('DELETE FROM email_challenges WHERE id=?').bind(row.id).run();
  return row;
}

export async function createRecoveryTicket(env, userId) {
  const token = randomSecret();
  const hash = await sha256(token);
  await env.DB.prepare('DELETE FROM recovery_tickets WHERE user_id=?').bind(userId).run();
  await env.DB.prepare('INSERT INTO recovery_tickets(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .bind(hash,userId,Date.now()+10*60*1000).run();
  return token;
}

export function isPasswordProof(value) { return typeof value==='string' && /^[0-9a-f]{64}$/.test(value); }
export function requireNewPassword(data) {
  if (!Number.isInteger(data.passwordLength) || data.passwordLength < 8 || data.passwordLength > 25 || !isPasswordProof(data.password)) {
    fail(400, 'New passwords must be 8–25 characters.');
  }
}
