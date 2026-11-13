import { handle, json, getSession, username, fail } from '../../lib/server.js';

export const onRequestGet = context => handle(context, async ({ env, request }) => {
  const me = await getSession(context);
  const url = new URL(request.url);
  const name = username(url.searchParams.get('username'));
  if (name === me.username) fail(400, 'You cannot message yourself.');
  const peer = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(name).first();
  if (!peer) fail(404, 'User not found.');

  const cursor = url.searchParams.get('before') || url.searchParams.get('after');
  const before = url.searchParams.has('before');
  const after = url.searchParams.has('after');
  if (before && after) fail(400, 'Choose only one cursor.');
  let cursorMs = null, cursorId = null;
  if (cursor) {
    const m = cursor.match(/^(\d{13}):([0-9a-f-]{36})$/);
    if (!m) fail(400, 'Invalid message cursor.');
    cursorMs = Number(m[1]);
    cursorId = m[2];
  }

  const condition = cursorMs === null ? '' :
    (before ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))'
            : 'AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))');
  const order = after ? 'ASC' : 'DESC';
  const args = [me.id, peer.id, peer.id, me.id];
  if (cursorMs !== null) args.push(cursorMs, cursorMs, cursorId);
  const sql = `
    SELECT m.id, m.body, m.created_at AS createdAt,
           (CASE WHEN m.sender_id = ? THEN 1 ELSE 0 END) AS mine
    FROM messages m
    WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      ${condition}
    ORDER BY m.created_at ${order}, m.id ${order}
    LIMIT 60
  `;
  // One more parameter for 'mine' in the SELECT expression.
  const qArgs = [me.id, ...args];
  const result = await env.DB.prepare(sql).bind(...qArgs).all();
  const rows = result.results || [];
  if (!after) rows.reverse();
  return json({ messages: rows, hasMore: !after && rows.length === 60 });
});
