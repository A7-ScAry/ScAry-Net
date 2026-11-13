import { handle, bodyJSON, username, fail, json, rateLimit, randomSecret, passwordHash, createSession, cookieHeader } from '../../../lib/server.js';
import { normalizeEmail, requireEmailConfig, issueCode, requireNewPassword } from '../../../lib/email.js';

export const onRequestPost = context => handle(context, async ({ env, request }) => {
  requireEmailConfig(env);
  await rateLimit(context, 'register', 4, 60*60*1000);
  const data = await bodyJSON(request);
  const name = username(data.username);
  const email = normalizeEmail(data.email);
  requireNewPassword(data);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username=? OR email=?').bind(name,email).first();
  if (existing) fail(409, 'Username or email already in use.');
  const id = crypto.randomUUID(), salt = randomSecret();
  const hash = await passwordHash(data.password, salt);
  try {
    await env.DB.prepare('INSERT INTO users(id,username,email,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id,name,email,salt,hash,Date.now()).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) fail(409,'Username or email already in use.');
    throw error;
  }
  let verificationSent = false;
  try { await issueCode(context, {id,username:name}, 'verify_email', email); verificationSent = true; }
  catch (error) { console.warn('Signup completed, but verification email could not be sent.'); }
  const token = await createSession(env.DB, id);
  return json({user:{username:name},verificationSent},201,{'Set-Cookie': cookieHeader(token)});
});
