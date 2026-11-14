import { handle, json, getSession, bodyJSON, username, fail, rateLimit } from '../../lib/server.js';
import { groupName, MAX_MEMBERS } from '../../lib/groups.js';

// Create a group with the logged-in user as admin and 1–29 other registered users.
export const onRequestPost = context => handle(context, async ({ env, request }) => {
  const me = await getSession(context);
  await rateLimit(context, 'create_group', 6, 60 * 60 * 1000, me.id);
  const data = await bodyJSON(request);
  const name = groupName(data.name);
  if (!Array.isArray(data.members) || data.members.length < 1 || data.members.length >= MAX_MEMBERS) {
    fail(400, 'Add 1–29 people by username.');
  }
  const names = [...new Set(data.members.map(username))];
  if (names.includes(me.username)) fail(400, 'You are already included as the group creator.');
  if (names.length !== data.members.length) fail(400, 'Each member can only be added once.');
  const holders = names.map(() => '?').join(',');
  const found = await env.DB.prepare(`SELECT id, username FROM users WHERE username IN (${holders})`)
    .bind(...names).all();
  const users = found.results || [];
  if (users.length !== names.length) {
    const existing = new Set(users.map(u => u.username));
    fail(404, `Username not found: @${names.find(n => !existing.has(n))}`);
  }
  const id = crypto.randomUUID(), now = Date.now();
  const queries = [
    env.DB.prepare('INSERT INTO group_chats(id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, name, me.id, now, now),
    env.DB.prepare("INSERT INTO group_members(group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)")
      .bind(id, me.id, now)
  ];
  for (const user of users) queries.push(env.DB.prepare(
    "INSERT INTO group_members(group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
  ).bind(id, user.id, now));
  await env.DB.batch(queries);
  return json({ group: { id, name, memberCount: users.length + 1, isAdmin: true } }, 201);
});
