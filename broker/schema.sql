CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  code_verifier TEXT,
  repository_access TEXT NOT NULL DEFAULT 'public'
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
  ON oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS user_authorizations (
  user_id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  user_id TEXT,
  repository_id TEXT,
  run_id TEXT,
  outcome TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_occurred_at
  ON security_events (occurred_at);

CREATE TABLE IF NOT EXISTS authorization_refresh_locks (
  auth_key TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
