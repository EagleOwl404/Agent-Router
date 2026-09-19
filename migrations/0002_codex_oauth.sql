-- Agent-Router 0002: OpenAI Codex OAuth (ChatGPT PKCE) support.
-- Extends provider_keys with OAuth columns; adds codex_oauth_sessions for
-- PKCE authorization state (mirrors Otter's oauth2_authorization_sessions).

ALTER TABLE provider_keys ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'static';
ALTER TABLE provider_keys ADD COLUMN encrypted_access_token TEXT;
ALTER TABLE provider_keys ADD COLUMN encrypted_refresh_token TEXT;
ALTER TABLE provider_keys ADD COLUMN codex_account_id TEXT;
ALTER TABLE provider_keys ADD COLUMN access_expires_at INTEGER;
ALTER TABLE provider_keys ADD COLUMN oauth_status TEXT;

CREATE TABLE IF NOT EXISTS codex_oauth_sessions (
  session_id TEXT PRIMARY KEY,
  provider_key_id TEXT NOT NULL REFERENCES provider_keys(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL REFERENCES users(email),
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_codex_oauth_sessions_key ON codex_oauth_sessions (provider_key_id);
CREATE INDEX IF NOT EXISTS idx_codex_oauth_sessions_state ON codex_oauth_sessions (state_hash);
