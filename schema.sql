-- ScAry Net / Cloudflare D1 schema
-- Run once in D1's Console BEFORE users register.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages(sender_id, receiver_id, created_at, id);
CREATE INDEX IF NOT EXISTS messages_sender_time_idx ON messages(sender_id, created_at);

CREATE TABLE IF NOT EXISTS threads (
  user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_body TEXT NOT NULL,
  last_sender_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_low, user_high),
  CHECK(user_low < user_high)
);
CREATE INDEX IF NOT EXISTS threads_recent_low_idx ON threads(user_low, updated_at DESC);
CREATE INDEX IF NOT EXISTS threads_recent_high_idx ON threads(user_high, updated_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);

-- Email recovery. For an existing database run migration_email.sql ONCE instead.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS email_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','change_email','recover')),
  target_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, purpose)
);
CREATE INDEX IF NOT EXISTS email_challenges_expires_idx ON email_challenges(expires_at);
CREATE TABLE IF NOT EXISTS recovery_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_tickets_user_idx ON recovery_tickets(user_id);

-- Group messaging for NEW databases. Existing ones: run migration_groups.sql.
CREATE TABLE IF NOT EXISTS group_chats (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 50),
  created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, last_body TEXT, last_sender_id TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS groups_updated_idx ON group_chats(updated_at DESC);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
  joined_at INTEGER NOT NULL, PRIMARY KEY (group_id,user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id,group_id);
CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS group_messages_time_idx ON group_messages(group_id,created_at,id);
