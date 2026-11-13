import { handle, json, bodyJSON, getSession, username, fail, rateLimit } from '../../lib/server.js';

export const onRequestPost = context => handle(context, async ({ env, request }) => {
  const me = await getSession(context);
  await rateLimit(context, 'send', 50, 60 * 1000, me.id);
  const data = await bodyJSON(request);
  const name = username(data.to);
  const body = typeof data.text === 'string' ? data.text.trim() : '';
  if (!body || Array.from(body).length > 1000) fail(400, 'Write a message between 1 and 1000 characters.');
  if (name === me.username) fail(400, 'You cannot message yourself.');
  const receiver = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(name).first();
  if (!receiver) fail(404, 'That user does not exist.');
  const id = crypto.randomUUID();
  const now = Date.now();
  const [low, high] = [me.id, receiver.id].sort();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO messages (id, sender_id, receiver_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, me.id, receiver.id, body, now),
    env.DB.prepare(`
      INSERT INTO threads (user_low, user_high, last_body, last_sender_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_low, user_high) DO UPDATE SET
        last_body = excluded.last_body,
        last_sender_id = excluded.last_sender_id,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= threads.updated_at
    `).bind(low, high, body, me.id, now)
  ]);
  return json({ message: { id, body, mine: 1, createdAt: now } }, 201);
});
