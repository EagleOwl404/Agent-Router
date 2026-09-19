import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';

type UsageApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerUsageRoutes(app: UsageApp): void {
  app.get('/user/usage/summary', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const days = Number(new URL(c.req.url).searchParams.get('days') ?? '30');
    const svc = createRequestScope(c.env).get(Tokens.UsageService);
    return c.json(await svc.getSummary(email, Number.isFinite(days) ? days : 30));
  });

  app.get('/user/usage/ledger', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const params = new URL(c.req.url).searchParams;
    const limit = Number(params.get('limit') ?? '50');
    const cursor = params.get('cursor') ?? undefined;
    const svc = createRequestScope(c.env).get(Tokens.UsageService);
    const { entries, nextCursor } = await svc.listLedger(email, Number.isFinite(limit) ? limit : 50, cursor);
    return c.json({ entries, nextCursor });
  });
}

export { registerUsageRoutes };
