ALTER TABLE oauth_states ADD COLUMN code_verifier TEXT;

CREATE TABLE IF NOT EXISTS authorization_refresh_locks (
  auth_key TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
