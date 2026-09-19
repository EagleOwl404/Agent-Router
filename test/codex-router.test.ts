import { describe, expect, it, vi } from 'vitest';
import { RouterService } from '@agent-router/backend-services/router';
import { buildCodexCall } from '@agent-router/backend-services/router';
import { KeyCrypto } from '@agent-router/backend-services/provider';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

const MASTER = 'test-master-key';

async function enc(secret: string): Promise<string> {
  return KeyCrypto.encrypt(secret, MASTER, 'codex-oauth');
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    provider_id: 'p1',
    user_email: 'u@x.y',
    name: id,
    encrypted_key: '',
    key_hint: null,
    token_limit: null,
    request_limit: null,
    used_tokens: 0,
    used_requests: 0,
    reset_at: null,
    priority: 0,
    status: 'active',
    cooldown_until: null,
    consecutive_failures: 0,
    last_used_at: null,
    last_error: null,
    created_at: 1,
    updated_at: null,
    auth_type: 'codex_oauth',
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    codex_account_id: 'acc-1',
    access_expires_at: null,
    oauth_status: 'connected',
    ...overrides,
  };
}

function makeService(keys: Array<ReturnType<typeof row>>, fetchImpl: typeof fetch, codexTokens?: { getAccessToken: ReturnType<typeof vi.fn> }) {
  const events: string[] = [];
  const keyDAO = {
    listActiveByProvider: async () => keys,
    getById: async (id: string) => keys.find((k) => k.id === id) ?? null,
    recordSuccess: async (id: string) => void events.push(`success:${id}`),
    recordFailure: async (id: string) => void events.push(`failure:${id}`),
    markExhausted: async (id: string) => void events.push(`exhausted:${id}`),
    database: { prepare: () => ({ bind: () => ({ run: async () => undefined }) }) },
  };
  const env = { DB: {} as never };
  const svc = new RouterService(env, {
    providerDAO: () => Promise.resolve({ getById: async () => ({ id: 'p1', user_email: 'u@x.y', userEmail: 'u@x.y', status: 'active' }) } as never),
    providerKeyDAO: () => Promise.resolve(keyDAO as never),
    usageDAO: () => Promise.resolve({ insert: async () => undefined } as never),
    masterKey: async () => MASTER,
    config: AppConfiguration.fromEnv(env),
    fetchImpl,
    codexTokens: codexTokens as never,
  });
  return { svc, events };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function proxyInput() {
  return {
    userEmail: 'u@x.y',
    gatewayKeyId: 'gw1',
    providerId: 'p1',
    providerKind: 'OPENAI_CODEX' as const,
    providerBaseUrl: 'https://api.openai.com/v1',
    upstreamPath: '/responses',
    upstreamBody: { model: 'gpt-5', input: 'hi' },
    upstreamModel: 'gpt-5',
    bodyBytes: 100,
  };
}

describe('RouterService Codex OAuth', () => {
  it('builds codex calls with bearer plus account headers', () => {
    const call = buildCodexCall(null, '/responses', 'at-1', 'acc-1', { model: 'gpt-5' });
    expect(call.url).toBe('https://api.openai.com/v1/responses');
    expect(call.headers.authorization).toBe('Bearer at-1');
    expect(call.headers['ChatGPT-Account-Id']).toBe('acc-1');
    const anon = buildCodexCall(null, '/responses', 'at-1', null, {});
    expect(anon.headers['ChatGPT-Account-Id']).toBeUndefined();
  });

  it('proxies through OAuth keys with resolved access tokens', async () => {
    const k1 = row('k1', { encrypted_refresh_token: await enc('rt-1') });
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      return jsonResponse(200, { output: [], usage: { input_tokens: 0, prompt_tokens: 4, completion_tokens: 3 } });
    });
    const codexTokens = { getAccessToken: vi.fn(async () => ({ accessToken: 'at-live', accountId: 'acc-1' })) };
    const { svc, events } = makeService([k1], fetchImpl as unknown as typeof fetch, codexTokens);
    const result = await svc.proxy(proxyInput());
    expect(result.status).toBe(200);
    expect(result.providerKeyId).toBe('k1');
    expect(seen[0].authorization).toBe('Bearer at-live');
    expect(seen[0]['ChatGPT-Account-Id']).toBe('acc-1');
    expect(events).toContain('success:k1');
  });

  it('refreshes once on 401 before failing over', async () => {
    const k1 = row('k1', { encrypted_refresh_token: await enc('rt-1') });
    const k2 = row('k2', { encrypted_refresh_token: await enc('rt-2') });
    let k1Calls = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      if (auth === 'Bearer at-stale') {
        k1Calls += 1;
        return jsonResponse(401, { error: { message: 'invalid_token' } });
      }
      return jsonResponse(200, { output: [], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    });
    const codexTokens = {
      getAccessToken: vi.fn(async (_p: string, _k: string, _u: string, opts?: { forceRefresh?: boolean }) =>
        opts?.forceRefresh ? { accessToken: 'at-fresh', accountId: 'acc-1' } : { accessToken: 'at-stale', accountId: 'acc-1' },
      ),
    };
    const { svc } = makeService([k1, k2], fetchImpl as unknown as typeof fetch, codexTokens);
    const result = await svc.proxy(proxyInput());
    expect(result.providerKeyId).toBe('k1');
    expect(k1Calls).toBe(1);
    expect(codexTokens.getAccessToken).toHaveBeenCalledWith('p1', 'k1', 'u@x.y', { forceRefresh: true });
  });

  it('fails over when the OAuth resolver reports revoked keys', async () => {
    const k1 = row('k1', { encrypted_refresh_token: await enc('rt-1') });
    const k2 = row('k2', { encrypted_refresh_token: await enc('rt-2') });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { output: [], usage: { prompt_tokens: 1, completion_tokens: 0 } }));
    const codexTokens = {
      getAccessToken: vi.fn(async (_p: string, keyId: string) => {
        if (keyId === 'k1') throw Object.assign(new Error('Codex authorization expired or was revoked. Reconnect the key.'), { name: 'BadRequestError' });
        return { accessToken: 'at-2', accountId: 'acc-1' };
      }),
    };
    const { svc, events } = makeService([k1, k2], fetchImpl as unknown as typeof fetch, codexTokens);
    const result = await svc.proxy(proxyInput());
    expect(result.providerKeyId).toBe('k2');
    expect(events).toContain('failure:k1');
  });

  it('asks for reconnection when every key is OAuth-blocked', async () => {
    const k1 = row('k1', { oauth_status: 'pending', encrypted_refresh_token: null });
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const { svc } = makeService([k1], fetchImpl as unknown as typeof fetch, { getAccessToken: vi.fn() });
    await expect(svc.proxy(proxyInput())).rejects.toThrow(/reconnect/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
