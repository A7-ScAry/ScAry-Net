import { fail } from './server.js';

export const MAX_MEMBERS = 30;
export function groupId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) fail(400, 'Invalid group.');
  return value;
}
export function groupName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (Array.from(name).length < 2 || Array.from(name).length > 50 || /[\x00-\x1f\x7f]/.test(name)) {
    fail(400, 'Group names must be 2–50 characters.');
  }
  return name;
}
export async function memberOf(db, group, userId, admin = false) {
  const member = await db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(group, userId).first();
  if (!member) fail(403, 'You are not a member of this group.');
  if (admin && member.role !== 'admin') fail(403, 'Only the group admin can manage members.');
  return member;
}
