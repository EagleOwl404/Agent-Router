# Agent-Router

OpenRouter-style LLM gateway on Cloudflare Workers + D1, scaffolded from the Edge-Git monorepo skeleton (`@agent-router/monorepo`, `pnpm@11.2.2`).

- **Gateway**: OpenAI-compatible `POST /v1/chat/completions`, `POST /v1/embeddings`, `GET /v1/models` + `POST /anthropic/v1/messages` + `POST /gemini/v1beta/models/<model>:generateContent`. Clients authenticate with per-user gateway keys (`Authorization: Bearer ar_…`, sha256 `agent-router-gw:` prefix). Model names route automatically (`gpt-*`→OpenAI, `claude-*`→Anthropic, `gemini-*`→Gemini); `x-provider-id` pins a provider.
- **Key pools**: each provider holds many upstream keys with admin-set `tokenLimit`/`requestLimit` caps, `priority` ordering, and monthly `resetInDays` rollover. Secrets are AES-GCM encrypted (Secrets Store `AES_ENCRYPTION_KEY_SECRET`) and never returned by the API (hint only).
- **Failover**: transparent in-request retry — upstream `429/5xx`/network errors mark the key cooling (exponential backoff) and retry on the next key (up to `PROXY_MAX_ATTEMPTS`). Clients only see `429 all_keys_exhausted` when the whole pool is down. Non-retryable `4xx` surfaces the upstream message with no failover.
- **Usage**: per-request ledger (`usage_ledger`) with parsed token counts + `/user/usage/summary` and `/user/usage/ledger` readers.
- **Auth**: `/user/*` via Cloudflare Access (`AccessAuthService`: DEMO→DEV→JWT→`ctx.access` fallback; never trust `Cf-Access-Authenticated-User-Email`); users auto-provisioned with globally-unique usernames.
- **Web**: Vite SPA served from the Worker — Dashboard (endpoint docs), Providers (pools + usage bars + rotate/reset), Gateway Keys (mint/copy-once), Usage (totals + ledger), Settings (profile + language).
- **Cron** (`*/10 * * * *`, `CronTasksWorker` DO): gateway-key prune, usage-reset rollover, failing-key auto-disable, ledger prune.

## Quick start

```bash
pnpm install
pnpm -r typecheck && pnpm exec vitest run
pnpm --filter @agent-router/web build
cp apps/api/wrangler.template.jsonc wrangler.jsonc  # fill D1 id + secrets
pnpm exec wrangler d1 migrations apply --remote agent-router-db
pnpm exec wrangler deploy
```

Proxy example: `curl -H "Authorization: Bearer ar_…" -H "Content-Type: application/json" <host>/v1/chat/completions -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'`.

## Config vars

Router knobs (defaults in `ConfigurationDefaults.ts`): `MAX_PROVIDERS_PER_USER=10`, `MAX_KEYS_PER_PROVIDER=10`, `MAX_GATEWAY_KEYS_PER_USER=10`, `MAX_GATEWAY_KEY_EXPIRY_DAYS=365`, `PROXY_TIMEOUT_MS=30000`, `PROXY_MAX_ATTEMPTS=4`, `PROXY_MAX_BODY_BYTES=1048576`, `KEY_COOLDOWN_BASE_MS=60000`, `KEY_MAX_CONSECUTIVE_FAILURES=10`, `USAGE_RETENTION_DAYS=90`. Required: `POLICY_AUD`, `TEAM_DOMAIN` (Access JWT); secret: `AES_ENCRYPTION_KEY_SECRET` (upstream key encryption).

## CD vars

`WRANGLER_JSONC` (full file) or `WRANGLER_VARS_PATCH_JSON` e.g. `{"POLICY_AUD":"…","TEAM_DOMAIN":"https://….cloudflareaccess.com","SITE_URL":"https://llm.example.com"}`.
