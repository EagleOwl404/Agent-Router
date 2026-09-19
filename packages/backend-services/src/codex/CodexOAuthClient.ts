import { OAuth2TokenNonRetryableError, OAuth2TokenRetryableError } from '@agent-router/backend-errors';

// Public PKCE client embedded in the official Codex CLI / IDE extensions.
// No client secret: PKCE S256 proves ownership of the authorization code.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_REVOKE_URL = 'https://auth.openai.com/oauth/revoke';
const CODEX_ORIGINATOR = 'codex_cli_rs';

interface CodexAuthorizationInput {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

interface CodexTokenResult {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresIn: number | null;
  accountId: string | null;
}

function buildAuthorizationUrl(input: CodexAuthorizationInput): string {
  const url = new URL(CODEX_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CODEX_CLIENT_ID);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_claims', 'true');
  url.searchParams.set('originator', CODEX_ORIGINATOR);
  return url.href;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const normalized = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i) ?? 0;
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function claimAsString(payload: Record<string, unknown> | null, names: readonly string[]): string | null {
  if (!payload) return null;
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function parseAccountId(idToken: string | null, accessToken: string | null): string | null {
  const candidates = ['account_id', 'chatgpt_account_id', 'https://api.openai.com/account_id', 'org_id'] as const;
  const fromId = claimAsString(idToken ? decodeJwtPayload(idToken) : null, candidates);
  if (fromId) return fromId;
  return claimAsString(accessToken ? decodeJwtPayload(accessToken) : null, candidates);
}

function parseExpiresIn(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

interface CodexTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

async function postTokenRequest(values: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<CodexTokenResponse> {
  let response: Response;
  try {
    response = await fetchImpl(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    });
  } catch (error) {
    throw new OAuth2TokenRetryableError(
      error instanceof Error ? `Codex token request failed: ${error.message}` : 'Codex token request failed',
    );
  }
  let data: CodexTokenResponse;
  try {
    data = (JSON.parse(await response.text()) as CodexTokenResponse) ?? {};
  } catch {
    throw new OAuth2TokenRetryableError(`Codex token request failed with status ${response.status}`);
  }
  if (!response.ok || !data.access_token) {
    const message = `Codex token request failed: ${data.error_description ?? data.error ?? response.statusText}`;
    if (response.status >= 400 && response.status < 500) throw new OAuth2TokenNonRetryableError(message);
    throw new OAuth2TokenRetryableError(message);
  }
  return data;
}

function toTokenResult(data: CodexTokenResponse): CodexTokenResult {
  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null,
    idToken: typeof data.id_token === 'string' && data.id_token ? data.id_token : null,
    expiresIn: parseExpiresIn(data.expires_in),
    accountId: parseAccountId(typeof data.id_token === 'string' ? data.id_token : null, (data.access_token as string) ?? null),
  };
}

async function exchangeCode(
  input: { code: string; codeVerifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CodexTokenResult> {
  const data = await postTokenRequest(
    {
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    },
    fetchImpl,
  );
  if (!data.refresh_token) {
    throw new OAuth2TokenNonRetryableError('Codex did not return a refresh token. Reconnect and approve access.');
  }
  return toTokenResult(data);
}

async function refreshAccessToken(input: { refreshToken: string }, fetchImpl: typeof fetch = fetch): Promise<CodexTokenResult> {
  const data = await postTokenRequest(
    {
      grant_type: 'refresh_token',
      client_id: CODEX_CLIENT_ID,
      refresh_token: input.refreshToken,
    },
    fetchImpl,
  );
  // RFC 6749 §6: the server MAY omit a new refresh token; retain the existing one then.
  if (!data.refresh_token) {
    const result = toTokenResult({ ...data, refresh_token: input.refreshToken });
    return result;
  }
  return toTokenResult(data);
}

async function revokeRefreshToken(input: { refreshToken: string }, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(CODEX_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: input.refreshToken, token_type_hint: 'refresh_token', client_id: CODEX_CLIENT_ID }).toString(),
    });
  } catch {
    // Best-effort: revocation failure must not block disconnect.
  }
}

export { CodexOAuthClient };
export type { CodexAuthorizationInput, CodexTokenResult };

const CodexOAuthClient = {
  clientId: CODEX_CLIENT_ID,
  authorizeUrl: CODEX_AUTHORIZE_URL,
  tokenUrl: CODEX_TOKEN_URL,
  buildAuthorizationUrl,
  exchangeCode,
  refreshAccessToken,
  revokeRefreshToken,
  parseAccountId,
};
