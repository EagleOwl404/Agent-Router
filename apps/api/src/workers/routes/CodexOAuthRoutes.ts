import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';

type CodexApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerCodexOAuthRoutes(app: CodexApp): void {
  app.get('/api/codex/callback/:keyId', async (c) => {
    const keyId = c.req.param('keyId');
    const error = c.req.query('error');
    if (error) {
      return c.redirect(`/providers?codex=error&message=${encodeURIComponent(error)}`, 302);
    }
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) {
      return c.redirect('/providers?codex=error&message=OAuth%20callback%20is%20missing%20code%20or%20state.', 302);
    }
    try {
      const svc = createRequestScope(c.env).get(Tokens.CodexOAuthService);
      await svc.completeCallback(keyId, code, state);
    } catch (callbackError) {
      const message = callbackError instanceof Error ? callbackError.message : 'Codex authorization failed.';
      return c.redirect(`/providers?codex=error&message=${encodeURIComponent(message)}`, 302);
    }
    return c.redirect(`/providers?codex=connected&keyId=${encodeURIComponent(keyId)}`, 302);
  });
}

export { registerCodexOAuthRoutes };
