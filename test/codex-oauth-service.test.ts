import { describe, expect, it, vi } from 'vitest';
import { CodexOAuthService } from '@agent-router/backend-services/codex';
import { KeyCrypto } from '@agent-router/backend-services/provider';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { CryptoUtil } from '@agent-router/shared/utils';

const MASTER = 'test-master-key';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    provider_id: 'p1',
    user_email: 'u@x.y',
    name: 'Codex',
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
    codex_account_id: null,
    access_expires_at: null,
    oauth_status: 'pending',
    ...overrides,
  };
}

function makeService(opts: { providerKind?: string; key?: Record<string, unknown> | null; fetchImpl?: typeof fetch } = {}) {
  const calls: Record<string, unknown[]> = { createOAuthKey: [], sessions: [], connected: [], consumed: [], cleared: [] };
  const providerDAO = { getById: async () => ({ id: 'p1', userEmail: 'u@x.y', kind: opts.providerKind ?? 'OPENAI_CODEX', name: 'Codex', baseUrl: 'https://api.openai.com/v1', status: 'active', createdAt: 1, updatedAt: null }) };
  const keyRow = opts.key === undefined ? row() : opts.key;
  const providerKeyDAO = {
    countByProvider: async () => 0,
    getById: async () => keyRow,
    getMetadataById: async () => (keyRow ? { id: 'k1', providerId: 'p1', userEmail: 'u@x.y', authType: 'codex_oauth', oauthStatus: 'pending' } : null),
    createOAuthKey: async (r: unknown) => void calls.createOAuthKey.push(r),
    updateOAuthConnected: async (id: string, patch: unknown) => void calls.connected.push({ id, patch }),
    clearOAuth: async (id: string) => void calls.cleared.push(id),
  };
  const sessionDAO = {
    create: async (r: unknown) => void calls.sessions.push(r),
    getActive: async () => ({ sessionId: 's1', providerKeyId: 'k1', userEmail: 'u@x.y', stateHash: 'h', codeVerifier: 'verifier', redirectUri: 'https://gw/api/codex/callback/k1', createdAt: 1, expiresAt: 999, consumedAt: null }),
    consume: async (id: string) => void calls.consumed.push(id),
  };
  const env = { DB: {} as never };
  const svc = new CodexOAuthService(env, {
    providerDAO: () => Promise.resolve(providerDAO as never),
    providerKeyDAO: () => Promise.resolve(providerKeyDAO as never),
    sessionDAO: () => Promise.resolve(sessionDAO as never),
    masterKey: async () => MASTER,
    config: AppConfiguration.fromEnv(env),
    fetchImpl: opts.fetchImpl,
  });
  return { svc, calls, sessionDAO };
}

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('CodexOAuthService', () => {
  it('creates pending OAuth keys only for OPENAI_CODEX providers', async () => {
    const { svc, calls } = makeService();
    const created = await svc.createAuthorizationKey('p1', 'U@X.Y', { name: 'My Codex' });
    expect(created.id).toBe('k1');
    expect(calls.createOAuthKey).toHaveLength(1);
    const wrong = makeService({ providerKind: 'OPENAI' });
    await expect(wrong.svc.createAuthorizationKey('p1', 'u@x.y', { name: 'x' })).rejects.toThrow(/Codex/i);
  });

  it('creates authorization urls with hashed state sessions', async () => {
    const { svc, calls } = makeService();
    const result = await svc.createAuthorization('p1', 'k1', 'u@x.y', 'https://gw.example/api/codex/callback/k1');
    expect(result.redirectUri).toBe('https://gw.example/api/codex/callback/k1');
    expect(result.authorizationUrl).toContain('auth.openai.com');
    const session = calls.sessions[0] as { stateHash: string; codeVerifier: string };
    const state = new URL(result.authorizationUrl).searchParams.get('state') as string;
    expect(session.stateHash).toBe(await CryptoUtil.sha256Hex(state));
    expect(session.codeVerifier).toHaveLength(86);
  });

  it('completes callbacks by storing encrypted tokens and consuming the session', async () => {
    const fetchImpl = vi.fn(async () =>
      tokenResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
    );
    const { svc, calls } = makeService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await svc.completeCallback('k1', 'code-1', 'state-1');
    expect(result).toBeDefined();
    expect(calls.consumed).toEqual(['s1']);
    const patch = (calls.connected[0] as { patch: { encryptedAccessToken: string; encryptedRefreshToken: string; accessExpiresAt: number } }).patch;
    expect(await KeyCrypto.decrypt(patch.encryptedAccessToken, MASTER)).toBe('at-1');
    expect(await KeyCrypto.decrypt(patch.encryptedRefreshToken, MASTER)).toBe('rt-1');
    expect(patch.accessExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects unknown sessions and disconnect clears with revocation', async () => {
    const { svc, sessionDAO } = makeService();
    sessionDAO.getActive = async () => null;
    await expect(svc.completeCallback('k1', 'c', 'bad')).rejects.toThrow(/invalid or expired/i);

    const revokeFetch = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain('auth.openai.com/oauth/revoke');
      return tokenResponse({});
    });
    const withRefresh = makeService({
      key: row({ oauth_status: 'connected', encrypted_refresh_token: await KeyCrypto.encrypt('rt-live', MASTER) }),
      fetchImpl: revokeFetch as unknown as typeof fetch,
    });
    await withRefresh.svc.disconnect('p1', 'k1', 'u@x.y');
    expect(revokeFetch).toHaveBeenCalled();
    expect(withRefresh.calls.cleared).toEqual(['k1']);
  });
});
