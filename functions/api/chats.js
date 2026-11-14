import { handle, json, getSession } from '../../lib/server.js';

export const onRequestGet = context => handle(context, async ({ env }) => {
  const me = await getSession(context);
  const result = await env.DB.prepare(`
    SELECT u.username, t.last_body AS lastBody, t.updated_at AS updatedAt,
           (CASE WHEN t.last_sender_id = ? THEN 1 ELSE 0 END) AS sentByMe
    FROM threads t
    JOIN users u ON u.id = (CASE WHEN t.user_low = ? THEN t.user_high ELSE t.user_low END)
    WHERE t.user_low = ? OR t.user_high = ?
    ORDER BY t.updated_at DESC
    LIMIT 100
  `).bind(me.id, me.id, me.id, me.id).all();
  let groups = { results: [] };
  try { groups = await env.DB.prepare(`
    SELECT g.id, g.name, g.updated_at AS updatedAt, g.last_body AS lastBody,
      (CASE WHEN g.last_sender_id = ? THEN 1 ELSE 0 END) AS sentByMe,
      (SELECT u.username FROM users u WHERE u.id = g.last_sender_id) AS lastSender,
      (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS memberCount
    FROM group_members gm JOIN group_chats g ON g.id = gm.group_id
    WHERE gm.user_id = ? ORDER BY g.updated_at DESC LIMIT 100
  `).bind(me.id, me.id).all();
  } catch (error) {
    // Private chats remain available before the additive group migration runs.
    if (!String(error.message || error).includes('no such table')) throw error;
  }
  return json({ chats: result.results || [], groups: groups.results || [] });
});
