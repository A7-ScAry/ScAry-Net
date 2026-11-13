import { handle, json, getSession, username, fail, rateLimit } from '../../../lib/server.js';

export const onRequestGet = context => handle(context, async ({ env, request }) => {
  const me = await getSession(context);
  await rateLimit(context, 'lookup', 100, 60 * 60 * 1000, me.id);
  const name = username(new URL(request.url).searchParams.get('username'));
  if (name === me.username) fail(400, 'You cannot message yourself.');
  const target = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(name).first();
  if (!target) fail(404, 'No one has registered that username yet.');
  return json({ username: target.username });
});
