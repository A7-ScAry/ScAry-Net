import { handle, json, getSession } from '../../../../lib/server.js';
import { groupId, memberOf } from '../../../../lib/groups.js';

export const onRequestGet = context => handle(context, async ({ env, params }) => {
  const me = await getSession(context);
  const id = groupId(params.id);
  const membership = await memberOf(env.DB, id, me.id);
  const group = await env.DB.prepare('SELECT id, name, created_at AS createdAt FROM group_chats WHERE id = ?')
    .bind(id).first();
  if (!group) return json({ error: 'Group not found.' }, 404);
  const result = await env.DB.prepare(`
    SELECT u.username, gm.role FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ? ORDER BY CASE gm.role WHEN 'admin' THEN 0 ELSE 1 END, gm.joined_at, u.username
  `).bind(id).all();
  return json({ group: { ...group, isAdmin: membership.role === 'admin', members: result.results || [] } });
});
