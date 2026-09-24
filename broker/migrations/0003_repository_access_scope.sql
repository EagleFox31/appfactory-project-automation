ALTER TABLE oauth_states
  ADD COLUMN repository_access TEXT NOT NULL DEFAULT 'public';
