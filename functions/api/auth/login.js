import { handle, bodyJSON, username, fail, json, rateLimit, passwordHash, secureEqual, createSession, cookieHeader } from '../../../lib/server.js';

export const onRequestPost = context => handle(context, async ({ env, request }) => {
  await rateLimit(context, 'login', 25, 60 * 60 * 1000);
  const data = await bodyJSON(request);
  const name = username(data.username);
  const password = typeof data.password === 'string' ? data.password : '';
  if (!/^[0-9a-f]{64}$/.test(password)) fail(400, 'Invalid username or password.');
  const user = await env.DB.prepare('SELECT id, username, password_salt, password_hash FROM users WHERE username = ?')
    .bind(name).first();
  if (!user) fail(401, 'Invalid username or password.');
  const check = await passwordHash(password, user.password_salt);
  if (!secureEqual(check, user.password_hash)) fail(401, 'Invalid username or password.');
  const token = await createSession(env.DB, user.id);
  return json({ user: { username: user.username } }, 200, { 'Set-Cookie': cookieHeader(token) });
});
