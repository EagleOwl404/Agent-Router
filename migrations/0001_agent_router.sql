-- Agent-Router v1 schema (fresh; Edge-Git migrations archived in _archive_edge_git/).
-- Multi-user gateway: users own providers, each provider has many upstream keys,
-- clients authenticate with per-user gateway keys. Usage is tracked per
-- provider key against admin-set caps; the router fails over transparently.

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_username_ci ON users (lower(username));

CREATE TABLE IF NOT EXISTS gateway_keys (
  key_id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES users(email),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gateway_keys_user ON gateway_keys (lower(user_email));
CREATE INDEX IF NOT EXISTS idx_gateway_keys_hash ON gateway_keys (key_hash);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES users(email),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  UNIQUE (user_email, name)
);
CREATE INDEX IF NOT EXISTS idx_providers_user ON providers (lower(user_email));

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL REFERENCES users(email),
  name TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hint TEXT,
  token_limit INTEGER,
  request_limit INTEGER,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  used_requests INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  cooldown_until INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys (provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_keys_user ON provider_keys (lower(user_email));
CREATE INDEX IF NOT EXISTS idx_provider_keys_status ON provider_keys (status, priority);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  gateway_key_id TEXT,
  provider_id TEXT,
  provider_key_id TEXT,
  upstream_model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  status_code INTEGER NOT NULL DEFAULT 200,
  error_code TEXT,
  estimated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_ledger (lower(user_email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_ledger (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_key ON usage_ledger (provider_key_id, created_at DESC);
