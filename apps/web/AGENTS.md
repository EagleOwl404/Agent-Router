# Agent-Router — Web SPA

Scope: `apps/web/**`. Parent index: `../../AGENTS.md`.

- Vite + React 19 SPA (`src/main.tsx`: `BrowserRouter` → `SpaApp`). Build embeds `dist/index.html` into `apps/api/src/generated/spa-shell.ts` (never edit generated file).
- `SpaApp.tsx` — thin composition root: `useCurrentUser` + `useSpaLanguage` + `useNotice` hook slices, `Header`, `NoticeBar`, then `SpaViewRouter` (no data fetching in router).
- `components/layout/SpaViewRouter.tsx` — routes: `/` (Dashboard or Landing), `/providers`, `/keys`, `/usage`, `/settings` (all gated by `Unauthorized`), `*` (localized 404 `Card`). Views in `src/views/`; shared `ui/` primitives in `src/components/`.
- Views: `DashboardView` (endpoint docs + nav cards), `ProvidersView` (provider CRUD + per-provider key pools with status badges, rotate/reset via `prompt()`), `GatewayKeysView` (mint/copy-once + revoke), `UsageView` (30-day totals + ledger with Load More), `LandingView` (marketing), `SettingsView` (profile + language).
- API access: `src/lib/api.ts` (`apiGet/apiPost/apiPatch/apiDelete`) + `src/services/*` (`providerService`, `gatewayKeyService`, `usageService`, `userService`); `src/types.ts` (router domain types only).
- i18n: `src/i18n.ts` (i18next + `react-i18next`) — single `canonicalizeLanguageTag`; bundles `src/locales/en|zh-CN/translation.json` (currently mirrored; localize `zh-CN` next).
- English UI text uses Title Case; keep `{{placeholder}}` parity across locales. Validate with `pnpm run validate:locales`.
