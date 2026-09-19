# Agent-Router — Backend Services

Scope: `packages/backend-services/**`. Parent index: `../../AGENTS.md`. Layer 3 (may use layers 0–2 only, never apps).

- Domain map:
  - `src/auth/AccessAuthService.ts` — `/user/*` identity: `DEMO_MODE` → `DEV_AUTH_EMAIL` → JWT (`cf-access-jwt-assertion` vs `TEAM_DOMAIN`/`POLICY_AUD`) → `ctx.access.getIdentity()` fallback. Never trust `Cf-Access-Authenticated-User-Email`.
  - `src/user/UserService.ts` — `upsertUser` (lowercased email, idempotent; bootstraps globally-unique username from email prefix) + `getProfileByEmail/getByUsername/renameUsername`.
  - `src/gateway/GatewayKeyService.ts` — client bearer keys: `ar_`+uuid mint, sha256 (`agent-router-gw:`) hash, `MAX_GATEWAY_KEYS_PER_USER`/`MAX_GATEWAY_KEY_EXPIRY_DAYS`; `authenticate` → `{userEmail, keyId}` + `last_used` touch; `revokeKey` (404 when unknown), `pruneExpired`.
  - `src/provider/ProviderService.ts` — provider CRUD per user (`OPENAI|ANTHROPIC|GEMINI|OPENAI_COMPAT`, unique name, SSRF-guarded `baseUrl`; first-party kinds pin default endpoints, `OPENAI_COMPAT` allows custom https).
  - `src/provider/ProviderKeyService.ts` — key pools: AES-GCM encrypt on write (`KeyCrypto`, master key from Secrets Store), masked reads (hint only), `priority` ordering, `tokenLimit`/`requestLimit` caps, `resetInDays` rollover, rotate/reset/delete, `decryptSecret` for the proxy path only.
  - `src/router/UpstreamClient.ts` — per-kind call builders (OpenAI Bearer, Anthropic `x-api-key`+version, Gemini `?key=`), `parseUsage` (OpenAI/Gemini `prompt/completion_tokens`, Anthropic `input/output_tokens`, estimated fallback), `isRetryableStatus` (429/502/503/504).
  - `src/router/RouterService.ts` — `proxy()`: cap-aware pick (`status=active`, cooldown elapsed, under caps; marks newly-capped `exhausted`), per-key upstream fetch with `PROXY_TIMEOUT_MS`, success → usage record + ledger; retryable failure → exponential `cooldown_until` (`KEY_COOLDOWN_BASE_MS`), auto-`disabled` past `KEY_MAX_CONSECUTIVE_FAILURES`; all-exhausted → `ExceededLimitError` (429). Non-retryable 4xx surfaces upstream with no failover.
  - `src/usage/UsageService.ts` — `getSummary(days≤90)` + cursor-paginated `listLedger` + `pruneOlderThan`.
- `src/composition/` — `Tokens` registry + `createRequestScope(env)`: per-request `Container`, table-driven lazy+memoized DAO factories (no Secrets Store round-trip until used), single `AppConfiguration`. Handlers resolve `scope.get(Tokens.X)`.
- Constructor injection: every service takes `(env, deps?)` with `() => Promise<DAO>` factories — tests override with stubs, no module mocks needed.
- Errors via `@agent-router/backend-errors` (`Bad/Unauthorized/Forbidden/NotFound/ExceededLimitError`); time/ids via `@agent-router/shared/utils` (`TimestampUtil`, `UUIDUtil`, `CryptoUtil`).
