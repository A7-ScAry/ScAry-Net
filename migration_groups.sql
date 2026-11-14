-- ScAry Net group messaging: ADDITIVE upgrade for an EXISTING D1 database.
-- Safe for current users, direct messages, email verification and recovery.
-- Run ONCE: npx wrangler d1 execute scary-net-db --remote --file=./migration_groups.sql

CREATE TABLE IF NOT EXISTS group_chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 50),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_body TEXT,
  last_sender_id TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS groups_updated_idx ON group_chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id, group_id);

CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS group_messages_time_idx ON group_messages(group_id, created_at, id);
