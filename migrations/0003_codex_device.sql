-- Agent-Router 0003: Codex device-code sessions.
-- Hosted-friendly replacement for the browser PKCE redirect flow, which
-- OpenAI's IdP rejects (the public Codex client is allow-listed for
-- localhost callbacks only). The device flow needs no redirect_uri:
-- the server issues a user_code, the user approves it at
-- https://auth.openai.com/codex/device, and the server polls for tokens.
-- codex_oauth_sessions is superseded but retained (migrations are append-only).

CREATE TABLE IF NOT EXISTS codex_device_sessions (
  device_auth_id TEXT PRIMARY KEY,
  provider_key_id TEXT NOT NULL REFERENCES provider_keys(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL REFERENCES users(email),
  user_code TEXT NOT NULL,
  verification_url TEXT NOT NULL DEFAULT 'https://auth.openai.com/codex/device',
  poll_interval_seconds INTEGER NOT NULL DEFAULT 5,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_codex_device_sessions_key ON codex_device_sessions (provider_key_id);
