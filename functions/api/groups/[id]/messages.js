import { handle, json, bodyJSON, getSession, fail, rateLimit } from '../../../../lib/server.js';
import { groupId, memberOf } from '../../../../lib/groups.js';

export const onRequestGet = context => handle(context, async ({ env, params, request }) => {
  const me = await getSession(context);
  const id = groupId(params.id);
  await memberOf(env.DB, id, me.id);
  const url = new URL(request.url);
  const before = url.searchParams.has('before'), after = url.searchParams.has('after');
  if (before && after) fail(400, 'Choose only one cursor.');
  const cursor = url.searchParams.get('before') || url.searchParams.get('after');
  const match = cursor && /^(\d{13}):([0-9a-f-]{36})$/.exec(cursor);
  if (cursor && !match) fail(400, 'Invalid message cursor.');
  const dir = after ? 'ASC' : 'DESC';
  const condition = !match ? '' : before
    ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))'
    : 'AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))';
  const binds = [me.id, id];
  if (match) binds.push(Number(match[1]), Number(match[1]), match[2]);
  const result = await env.DB.prepare(`
    SELECT m.id, m.body, m.created_at AS createdAt, u.username AS sender,
      (CASE WHEN m.sender_id = ? THEN 1 ELSE 0 END) AS mine
    FROM group_messages m JOIN users u ON u.id = m.sender_id
    WHERE m.group_id = ? ${condition}
    ORDER BY m.created_at ${dir}, m.id ${dir} LIMIT 60
  `).bind(...binds).all();
  const rows = result.results || [];
  if (!after) rows.reverse();
  return json({ messages: rows, hasMore: !after && rows.length === 60 });
});

export const onRequestPost = context => handle(context, async ({ env, params, request }) => {
  const me = await getSession(context);
  const id = groupId(params.id);
  await memberOf(env.DB, id, me.id);
  await rateLimit(context, 'send', 50, 60 * 1000, me.id);
  const data = await bodyJSON(request);
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text || Array.from(text).length > 1000) fail(400, 'Write a message between 1 and 1000 characters.');
  const now = Date.now(), mid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO group_messages(id, group_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(mid, id, me.id, text, now),
    env.DB.prepare(`UPDATE group_chats SET last_body = ?, last_sender_id = ?, updated_at = ?
      WHERE id = ? AND updated_at <= ?`).bind(text, me.id, now, id, now)
  ]);
  return json({ message: { id: mid, body: text, createdAt: now, mine: 1, sender: me.username } }, 201);
});
