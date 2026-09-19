import { describe, expect, it, vi } from 'vitest';
import { CodexOAuthClient } from '@agent-router/backend-services/codex';
import { OAuth2TokenNonRetryableError, OAuth2TokenRetryableError } from '@agent-router/backend-errors';

function jwtWithPayload(payload: Record<string, unknown>): string {
  const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64url');
  return `${b64('{"alg":"RS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}

function tokenFetchImpl(response: { status: number; body: unknown }) {
  return vi.fn(async () => new Response(JSON.stringify(response.body), { status: response.status }));
}

describe('CodexOAuthClient', () => {
  it('builds a PKCE authorization url with the public client', () => {
    const url = new URL(CodexOAuthClient.buildAuthorizationUrl({ redirectUri: 'https://gw.example/api/codex/callback/k1', state: 's', codeChallenge: 'c' }));
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://gw.example/api/codex/callback/k1');
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.get('code_challenge')).toBe('c');
  });

  it('extracts the ChatGPT account id from id or access tokens', () => {
    const id = jwtWithPayload({ account_id: 'acc-1' });
    expect(CodexOAuthClient.parseAccountId(id, null)).toBe('acc-1');
    const access = jwtWithPayload({ 'https://api.openai.com/account_id': 'acc-2' });
    expect(CodexOAuthClient.parseAccountId(null, access)).toBe('acc-2');
    expect(CodexOAuthClient.parseAccountId(null, null)).toBeNull();
    expect(CodexOAuthClient.parseAccountId('not-a-jwt', 'also-not')).toBeNull();
  });

  it('exchanges codes and requires a refresh token', async () => {
    const id = jwtWithPayload({ account_id: 'acc-9' });
    const fetchImpl = tokenFetchImpl({ status: 200, body: { access_token: 'at', refresh_token: 'rt', id_token: id, expires_in: 3600 } });
    const result = await CodexOAuthClient.exchangeCode({ code: 'code', codeVerifier: 'verifier', redirectUri: 'https://gw/cb' }, fetchImpl as unknown as typeof fetch);
    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBe('rt');
    expect(result.accountId).toBe('acc-9');
    await expect(
      CodexOAuthClient.exchangeCode(
        { code: 'code', codeVerifier: 'v', redirectUri: 'https://gw/cb' },
        tokenFetchImpl({ status: 200, body: { access_token: 'at' } }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/refresh token/i);
  });

  it('retains the existing refresh token when rotation omits a new one', async () => {
    const result = await CodexOAuthClient.refreshAccessToken(
      { refreshToken: 'rt-old' },
      tokenFetchImpl({ status: 200, body: { access_token: 'at-new', expires_in: 100 } }) as unknown as typeof fetch,
    );
    expect(result.accessToken).toBe('at-new');
    expect(result.refreshToken).toBe('rt-old');
  });

  it('classifies 4xx as non-retryable and 5xx as retryable', async () => {
    await expect(
      CodexOAuthClient.refreshAccessToken(
        { refreshToken: 'rt' },
        tokenFetchImpl({ status: 400, body: { error: 'invalid_grant' } }) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(OAuth2TokenNonRetryableError);
    await expect(
      CodexOAuthClient.refreshAccessToken(
        { refreshToken: 'rt' },
        tokenFetchImpl({ status: 503, body: {} }) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(OAuth2TokenRetryableError);
  });
});
