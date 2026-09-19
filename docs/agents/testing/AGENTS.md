# Agent-Router — Testing

Scope: unit tests. Parent index: `../../../AGENTS.md`.

Current thresholds (`vitest.config.mts`): **statements 20 / branches 15 / functions 12 / lines 22** — scaffold baseline set 2026-09-19 after the Edge-Git → Agent-Router rewrite (old thresholds 70/55/70/70 no longer applied; archived suites live in `test/_archive_edge_git/`, excluded from the run). Raise plan (stepwise, only when green with headroom): 20/15/12/22 → 50/40/50/50 → 70/55/70/70. Never lower thresholds to make CI pass.

**Covered** (test files exist): `GatewayKeyService` mint/auth/validation (`test/gateway-keys.test.ts`), `ProviderService` create/validation/SSRF guard (`test/providers.test.ts`), `ProviderKeyService` encrypt/hint/validate/decrypt (`test/provider-keys.test.ts`), `RouterService` success-record/429-failover/exhaustion/4xx-passthrough (`test/router-failover.test.ts`), `UpstreamClient` builders/usage parsing/retryable statuses (`test/upstream-client.test.ts`), `UsageService` + `UserService` (`test/usage-user.test.ts`).

**Still thin**: API route handlers (proxy/provider/key/usage), DAO SQL (fake-D1 coverage), cron tasks, `KeyCrypto` round-trip edge cases, SPA components (no component tests by design).

**Mock patterns**:

- Services: stub DAO factories via constructor deps (`{ gatewayKeyDAO: () => Promise.resolve(stub) }`); assert via returned values and event arrays, not `vi.mock`.
- Upstream fetch: inject `fetchImpl` into `RouterService`; script per-key responses by inspecting the `Authorization`/`x-api-key` header.
- Secrets: real `KeyCrypto.encrypt/decrypt` with an ephemeral master key; gateway hashes via real `GatewayKeyService.hashKey`.
- Never trust `Cf-Access-Authenticated-User-Email`; tests use `DEV_AUTH_EMAIL`/`DEMO_MODE` stubs.
