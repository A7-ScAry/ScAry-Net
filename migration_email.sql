-- Run ONCE on an EXISTING ScAry Net D1 database. Does not delete messages.
-- Make a backup first. Do NOT re-run; ALTER TABLE will reject duplicate columns.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
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
