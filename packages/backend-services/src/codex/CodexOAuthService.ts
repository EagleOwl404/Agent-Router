import { CodexOAuthSessionDAO, ProviderDAO, ProviderKeyDAO } from '@agent-router/backend-data/dao';
import type { CodexOAuthSession } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@agent-router/backend-data/utils';
import { BadRequestError, NotFoundError } from '@agent-router/backend-errors';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import type { ProviderKeyMetadata } from '@agent-router/shared';
import { CryptoUtil, TimestampUtil, UUIDUtil } from '@agent-router/shared/utils';
import { KeyCrypto } from '../provider/KeyCrypto';
import { CodexOAuthClient } from './CodexOAuthClient';

interface CodexOAuthServiceEnv {
  DB: D1Queryable;
  CODEX_OAUTH_STATE_EXPIRY_MINUTES?: string;
  AES_ENCRYPTION_KEY_SECRET?: { get(): Promise<string> };
}

interface CodexOAuthServiceDeps {
  providerDAO?: () => Promise<ProviderDAO>;
  providerKeyDAO?: () => Promise<ProviderKeyDAO>;
  sessionDAO?: () => Promise<CodexOAuthSessionDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
  fetchImpl?: typeof fetch;
}

interface CodexAuthorizationResult {
  keyId: string;
  authorizationUrl: string;
  redirectUri: string;
  expiresAt: number;
}

async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return CryptoUtil.toBase64Url(new Uint8Array(digest));
}

class CodexOAuthService {
  private readonly deps: Required<CodexOAuthServiceDeps>;

  constructor(
    private readonly env: CodexOAuthServiceEnv,
    deps: CodexOAuthServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    const masterKey =
      deps.masterKey ??
      (async () => {
        if (!env.AES_ENCRYPTION_KEY_SECRET) throw new BadRequestError('Server key encryption is not configured');
        return env.AES_ENCRYPTION_KEY_SECRET.get();
      });
    this.deps = {
      providerDAO: () => Promise.resolve(new ProviderDAO(env.DB)),
      providerKeyDAO: () => Promise.resolve(new ProviderKeyDAO(env.DB)),
      sessionDAO: () => Promise.resolve(new CodexOAuthSessionDAO(env.DB)),
      masterKey,
      config,
      fetchImpl: deps.fetchImpl ?? fetch,
      ...deps,
    };
  }

  private async requireCodexKey(providerId: string, keyId: string, userEmail: string) {
    const providerDAO = await this.deps.providerDAO();
    const provider = await providerDAO.getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    if (provider.kind !== 'OPENAI_CODEX') throw new BadRequestError('Provider is not an OpenAI Codex provider');
    const keyDAO = await this.deps.providerKeyDAO();
    const key = await keyDAO.getById(keyId);
    if (!key || key.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    if ((key.auth_type ?? 'static') !== 'codex_oauth') throw new BadRequestError('Key is not a Codex OAuth key');
    return { provider, key, keyDAO };
  }

  public async createAuthorizationKey(
    providerId: string,
    userEmail: string,
    input: { name?: unknown; priority?: unknown },
  ): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    const providerDAO = await this.deps.providerDAO();
    const provider = await providerDAO.getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== normalized) throw new NotFoundError('Provider not found');
    if (provider.kind !== 'OPENAI_CODEX') throw new BadRequestError('Provider is not an OpenAI Codex provider');
    const name = typeof input.name === 'string' ? input.name.trim() : 'Codex OAuth';
    if (!name) throw new BadRequestError('name is required');
    if (name.length > 80) throw new BadRequestError('name must be at most 80 characters');
    let priority = 0;
    if (input.priority !== undefined && input.priority !== null) {
      const n = typeof input.priority === 'string' ? Number(input.priority.trim()) : (input.priority as number);
      if (!Number.isSafeInteger(n) || n < 0 || n > 1000) throw new BadRequestError('priority must be an integer 0-1000');
      priority = n;
    }
    const keyDAO = await this.deps.providerKeyDAO();
    const max = this.deps.config.getMaxKeysPerProvider();
    if ((await keyDAO.countByProvider(providerId)) >= max) throw new BadRequestError(`Maximum ${max} keys per provider`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await keyDAO.createOAuthKey({ id, providerId, userEmail: normalized, name, priority, now });
    const created = await keyDAO.getMetadataById(id);
    if (!created) throw new NotFoundError('Provider key not found');
    return created;
  }

  public async createAuthorization(
    providerId: string,
    keyId: string,
    userEmail: string,
    redirectUri: string,
  ): Promise<CodexAuthorizationResult> {
    const normalized = userEmail.toLowerCase();
    await this.requireCodexKey(providerId, keyId, normalized);
    if (!redirectUri || !/^https?:\/\//.test(redirectUri)) throw new BadRequestError('redirectUri must be an http(s) URL');
    const state = CryptoUtil.randomBase64Url(32);
    const codeVerifier = CryptoUtil.randomBase64Url(64);
    const [codeChallenge, stateHash] = await Promise.all([codeChallengeFor(codeVerifier), CryptoUtil.sha256Hex(state)]);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const expiresAt = TimestampUtil.addMinutes(now, this.deps.config.getCodexOAuthStateExpiryMinutes());
    const sessionDAO = await this.deps.sessionDAO();
    await sessionDAO.create({
      sessionId: UUIDUtil.getRandomUUID(),
      providerKeyId: keyId,
      userEmail: normalized,
      stateHash,
      codeVerifier,
      redirectUri,
      now,
      expiresAt,
    });
    return {
      keyId,
      authorizationUrl: CodexOAuthClient.buildAuthorizationUrl({ redirectUri, state, codeChallenge }),
      redirectUri,
      expiresAt,
    };
  }

  public async completeCallback(keyId: string, code: string, state: string): Promise<{ accountId: string | null }> {
    if (!code) throw new BadRequestError('OAuth callback is missing code');
    if (!state) throw new BadRequestError('OAuth callback is missing state');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const sessionDAO = await this.deps.sessionDAO();
    const stateHash = await CryptoUtil.sha256Hex(state);
    const session: CodexOAuthSession | null = await sessionDAO.getActive(keyId, stateHash, now);
    if (!session) throw new BadRequestError('Codex authorization session is invalid or expired');
    const keyDAO = await this.deps.providerKeyDAO();
    const key = await keyDAO.getById(keyId);
    if (!key || (key.auth_type ?? 'static') !== 'codex_oauth') throw new NotFoundError('Provider key not found');
    const tokens = await CodexOAuthClient.exchangeCode(
      { code, codeVerifier: session.codeVerifier, redirectUri: session.redirectUri },
      this.deps.fetchImpl,
    );
    const masterKey = await this.deps.masterKey();
    const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
      KeyCrypto.encrypt(tokens.accessToken, masterKey),
      KeyCrypto.encrypt(tokens.refreshToken as string, masterKey),
    ]);
    const accessExpiresAt = now + (tokens.expiresIn ?? 864_000);
    await keyDAO.updateOAuthConnected(keyId, {
      encryptedAccessToken,
      encryptedRefreshToken,
      accountId: tokens.accountId,
      accessExpiresAt,
      now,
    });
    await sessionDAO.consume(session.sessionId, now).catch(() => undefined);
    return { accountId: tokens.accountId };
  }

  public async disconnect(providerId: string, keyId: string, userEmail: string): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    const { keyDAO } = await this.requireCodexKey(providerId, keyId, normalized);
    const key = await keyDAO.getById(keyId);
    if (key?.encrypted_refresh_token) {
      try {
        const masterKey = await this.deps.masterKey();
        const refreshToken = await KeyCrypto.decrypt(key.encrypted_refresh_token, masterKey);
        await CodexOAuthClient.revokeRefreshToken({ refreshToken }, this.deps.fetchImpl);
      } catch {
        // Best-effort revocation; local state is cleared regardless.
      }
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await keyDAO.clearOAuth(keyId, now);
    const updated = await keyDAO.getMetadataById(keyId);
    if (!updated) throw new NotFoundError('Provider key not found');
    return updated;
  }

  public async getStatus(providerId: string, keyId: string, userEmail: string): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    const { keyDAO } = await this.requireCodexKey(providerId, keyId, normalized);
    const meta = await keyDAO.getMetadataById(keyId);
    if (!meta) throw new NotFoundError('Provider key not found');
    return meta;
  }
}

export { CodexOAuthService };
export type { CodexOAuthServiceDeps, CodexOAuthServiceEnv, CodexAuthorizationResult };
