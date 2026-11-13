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
  return json({ chats: result.results || [] });
});
