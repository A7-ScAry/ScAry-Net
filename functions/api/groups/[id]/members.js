import { handle, json, getSession, bodyJSON, username, fail, rateLimit } from '../../../../lib/server.js';
import { groupId, memberOf, MAX_MEMBERS } from '../../../../lib/groups.js';

// The group admin adds/removes members; everyone can leave their own group.
export const onRequestPost = context => handle(context, async ({ env, params, request }) => {
  const me = await getSession(context);
  const id = groupId(params.id);
  const mine = await memberOf(env.DB, id, me.id);
  const data = await bodyJSON(request);
  await rateLimit(context, 'group_members', 30, 60 * 60 * 1000, me.id);
  const action = data.action;
  if (action === 'add') {
    if (mine.role !== 'admin') fail(403, 'Only the group admin can add people.');
    const name = username(data.username);
    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(name).first();
    if (!user) fail(404, 'That username does not exist.');
    const membership = await env.DB.prepare('SELECT 1 AS yes FROM group_members WHERE group_id = ? AND user_id = ?')
      .bind(id, user.id).first();
    if (membership) fail(409, 'That person is already in the group.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').bind(id).first();
    if (count.n >= MAX_MEMBERS) fail(409, 'This group has reached its 30-member limit.');
    await env.DB.prepare("INSERT INTO group_members(group_id,user_id,role,joined_at) VALUES (?,?,'member',?)")
      .bind(id, user.id, Date.now()).run();
    return json({ success: true });
  }
  if (action !== 'remove' && action !== 'leave') fail(400, 'Invalid member action.');
  const targetName = action === 'leave' ? me.username : username(data.username);
  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(targetName).first();
  if (!target) fail(404, 'That username does not exist.');
  if (target.id !== me.id && mine.role !== 'admin') fail(403, 'Only the group admin can remove others.');
  const targetMember = await env.DB.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(id, target.id).first();
  if (!targetMember) fail(404, 'That person is not in the group.');
  if (targetMember.role === 'admin' && target.id !== me.id) fail(403, 'Only the admin can leave their role.');

  // If the admin leaves, pass administration to the oldest remaining member.
  // If nobody else remains, delete the empty group (messages are cascaded).
  const others = target.id === me.id && targetMember.role === 'admin'
    ? await env.DB.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ? ORDER BY joined_at, user_id LIMIT 1')
      .bind(id, me.id).first()
    : null;
  if (targetMember.role === 'admin' && target.id === me.id && !others) {
    await env.DB.prepare('DELETE FROM group_chats WHERE id = ?').bind(id).run();
  } else if (others) {
    await env.DB.batch([
      env.DB.prepare("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?")
        .bind(id, others.user_id),
      env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
        .bind(id, me.id)
    ]);
  } else {
    await env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
      .bind(id, target.id).run();
  }
  return json({ success: true, left: target.id === me.id });
});
