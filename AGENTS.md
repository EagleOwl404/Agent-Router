# AGENTS.md

Agent-Router: OpenRouter-style LLM gateway (`@agent-router/monorepo`, `pnpm@11.2.2`).

- **Gateway core**: `packages/router` logic lives in `packages/backend-services/src/router` (`RouterService` failover loop + `UpstreamClient` per-kind calls) over `packages/backend-data` DAOs (`ProviderDAO`, `ProviderKeyDAO`, `GatewayKeyDAO`, `UsageLedgerDAO`, `UserDAO`).
- **Storage**: D1 `migrations/0001_agent_router.sql` (`users`, `gateway_keys`, `providers`, `provider_keys`, `usage_ledger`; Edge-Git schema archived in `migrations/_archive_edge_git/`). Upstream secrets AES-GCM encrypted via Secrets Store (`AES_ENCRYPTION_KEY_SECRET`, `KeyCrypto`).
- **Auth**: `/user/*` Cloudflare Access (`AccessAuthService`: DEMO→DEV→JWT→`ctx.access` fallback; never trust `Cf-Access-Authenticated-User-Email`); proxy paths use gateway-key Bearer (`GatewayKeyService`, sha256 `agent-router-gw:` prefix, `ar_…` display).
- **API**: `apps/api` Hono `AgentRouterWorker` (`POST /v1/chat/completions|embeddings`, `GET /v1/models`, `POST /anthropic/v1/messages`, `POST /gemini/v1beta/models/:action` + `/user/providers|gateway-keys|usage|me` + `/health`, `/docs`); model-prefix routing with `x-provider-id` override.
- **Web**: `apps/web` Vite SPA, build embeds `dist/index.html` → `apps/api/src/generated/spa-shell.ts`.
- **Composition**: single scope per request via `scopeMiddleware` (`getScope(c).get(Tokens.X)`; `createRequestScope(env)` is the composition root, table-driven DAO wiring); `Container` + `createServiceContext` + `AppConfiguration` + `memoizeAsync`/`NullLogger`/`FixedClock` in `@agent-router/backend-runtime/di+config` are the DI foundation. See `docs/agents/runtime/AGENTS.md`.
- **i18n**: web i18next (`en`+`zh-CN` bundles, single `canonicalizeLanguageTag` in `i18n.ts`); English UI text uses Title Case. See `apps/web/AGENTS.md`.

## Commands

```bash
pnpm install
pnpm -r typecheck && pnpm exec vitest run
pnpm --filter @agent-router/web build
pnpm run typegen
pnpm exec wrangler dev --config ./wrangler.jsonc
```

No committed `wrangler.jsonc`. God-file guard 300/400 warn-only.

## Layers

```
shared, backend-errors → 0 deps
backend-runtime → 0 only
backend-data → 0 only
backend-services → 0-2 (not apps)
background → 0-3
api → 0-3 + background (no DAO value imports in endpoints)
```

## Import Direction

```
Layer 0: shared, backend-errors          — zero @agent-router/* deps
Layer 1: backend-runtime                 → layer 0 only
Layer 2: backend-data                    → layer 0 only
Layer 3: backend-services                → layers 0–2 (not apps)
(no Layer 4 by design)
Layer 5: apps/background                 → layers 0–3 (not apps/api)
         apps/api                        → layers 0–3 + background (NOT backend-data/dao except type-only)
```

Enforced by ESLint `no-restricted-imports` in `eslint.config.mjs`.

## Index

| Area                                            | Guide                                 |
| ----------------------------------------------- | ------------------------------------- |
| API worker, auth, routes                        | `apps/api/AGENTS.md`                  |
| Background worker, cron phases                  | `apps/background/AGENTS.md`           |
| Web SPA, router, i18n/Title Case conventions    | `apps/web/AGENTS.md`                  |
| Business logic, service domain map              | `packages/backend-services/AGENTS.md` |
| D1/DAO layer                                    | `packages/backend-data/AGENTS.md`     |
| Bindings, wrangler, env vars, DI                | `docs/agents/runtime/AGENTS.md`       |
| Tests, thresholds, mock patterns                | `docs/agents/testing/AGENTS.md`       |

## Commit Policy

Always commit changes after completing work unless explicitly told not to.

## Git Commit Messages

Format: `<TYPE>[optional scope]: <description>`

- Type in UPPERCASE: `FIX`, `FEAT`, `DOCS`, `STYLE`, `REFACTOR`, `TEST`, `BUILD`, `CHORE`, `CI`, `PERF`.
- Scope in lowercase: `FEAT(runtime): Add Scheduled Job State`.
- Description: Title Case words — `DOCS: Latest Agents Context Reflection`.
- When committing from `main`, first create a branch: `type/description` or `type/scope/description` in kebab-case (e.g. `feat/bootstrap/bootstrap-jqanywhere-v0.1-framework`).
- Always include a Markdown body separated from the subject by a blank line.
- Breaking changes: `!` after type/scope, or `BREAKING CHANGE: <description>` footer.

```text
<TYPE>[optional scope]: <description>

[Markdown body]

[optional footers]
```
