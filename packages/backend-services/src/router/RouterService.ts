import { ProviderDAO, ProviderKeyDAO, UsageLedgerDAO } from '@agent-router/backend-data/dao';
import type { ProviderKeyRow } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@agent-router/backend-data/utils';
import { BadRequestError, ExceededLimitError, NotFoundError } from '@agent-router/backend-errors';
import type { ProviderKind } from '@agent-router/shared';
import { TimestampUtil, UUIDUtil } from '@agent-router/shared/utils';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { KeyCrypto } from '../provider/KeyCrypto';
import { buildUpstreamCall, isRetryableStatus, parseUsage } from './UpstreamClient';

interface RouterServiceEnv {
  DB: D1Queryable;
  PROXY_TIMEOUT_MS?: string;
  PROXY_MAX_ATTEMPTS?: string;
  PROXY_MAX_BODY_BYTES?: string;
  KEY_COOLDOWN_BASE_MS?: string;
  KEY_MAX_CONSECUTIVE_FAILURES?: string;
  AES_ENCRYPTION_KEY_SECRET?: { get(): Promise<string> };
}

interface RouterServiceDeps {
  providerDAO?: () => Promise<ProviderDAO>;
  providerKeyDAO?: () => Promise<ProviderKeyDAO>;
  usageDAO?: () => Promise<UsageLedgerDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
  fetchImpl?: typeof fetch;
}

interface ProxyRequest {
  userEmail: string;
  gatewayKeyId: string | null;
  providerId: string;
  providerKind: ProviderKind;
  providerBaseUrl: string | null;
  upstreamPath: string;
  upstreamBody: unknown;
  upstreamModel: string | null;
  bodyBytes: number;
}

interface ProxySuccess {
  status: number;
  bodyText: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  providerKeyId: string;
  attempts: number;
}

function cooldownForFailures(baseMs: number, failures: number): number {
  const capped = Math.min(failures, 6);
  return baseMs * 2 ** capped;
}

class RouterService {
  private readonly deps: Required<RouterServiceDeps>;

  constructor(
    private readonly env: RouterServiceEnv,
    deps: RouterServiceDeps = {},
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
      usageDAO: () => Promise.resolve(new UsageLedgerDAO(env.DB)),
      masterKey,
      config,
      fetchImpl: deps.fetchImpl ?? fetch,
      ...deps,
    };
  }

  private isCapExceeded(row: ProviderKeyRow): boolean {
    if (row.token_limit !== null && row.used_tokens >= row.token_limit) return true;
    if (row.request_limit !== null && row.used_requests >= row.request_limit) return true;
    return false;
  }

  public async proxy(req: ProxyRequest): Promise<ProxySuccess> {
    const maxBody = this.deps.config.getProxyMaxBodyBytes();
    if (req.bodyBytes > maxBody) throw new BadRequestError('Request body too large');
    const maxAttempts = this.deps.config.getProxyMaxAttempts();
    const timeoutMs = this.deps.config.getProxyTimeoutMs();
    const cooldownBase = this.deps.config.getKeyCooldownBaseMs();
    const disableAfter = this.deps.config.getKeyMaxConsecutiveFailures();

    const providerDAO = await this.deps.providerDAO();
    const provider = await providerDAO.getById(req.providerId);
    if (!provider || provider.userEmail.toLowerCase() !== req.userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    if (provider.status !== 'active') throw new BadRequestError('Provider is disabled');

    const keyDAO = await this.deps.providerKeyDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const candidates = await keyDAO.listActiveByProvider(req.providerId, now);
    const usable = candidates.filter((k) => !this.isCapExceeded(k));
    const capped = candidates.filter((k) => this.isCapExceeded(k));
    // Mark newly-capped keys exhausted best-effort (does not block the request).
    for (const key of capped) {
      await keyDAO.markExhausted(key.id, now).catch(() => undefined);
    }
    if (usable.length === 0) throw new ExceededLimitError('All provider keys are exhausted or cooling. Try again later.');

    const masterKey = await this.deps.masterKey();
    const usageDAO = await this.deps.usageDAO();
    let lastError = 'Upstream request failed';
    let lastStatus = 502;
    const attempts = Math.min(maxAttempts, usable.length);
    for (let i = 0; i < attempts; i += 1) {
      const candidate = usable[i];
      const startedMs = Date.now();
      try {
        const secret = await KeyCrypto.decrypt(candidate.encrypted_key, masterKey);
        const call = buildUpstreamCall(req.providerKind, req.providerBaseUrl, req.upstreamPath, secret, req.upstreamBody);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let upstream: Response;
        try {
          upstream = await this.deps.fetchImpl(call.url, { method: 'POST', headers: call.headers, body: call.body, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        const bodyText = await upstream.text();
        const latencyMs = Date.now() - startedMs;
        if (upstream.status >= 200 && upstream.status < 300) {
          let usage = { promptTokens: 0, completionTokens: 0, estimated: true };
          try {
            usage = parseUsage(req.providerKind, JSON.parse(bodyText));
          } catch {
            usage = { promptTokens: 0, completionTokens: 0, estimated: true };
          }
          await keyDAO.recordSuccess(candidate.id, usage.promptTokens, usage.completionTokens, TimestampUtil.getCurrentUnixTimestampInSeconds()).catch(() => undefined);
          // Exhaustion check after increment (best-effort status flip).
          const refreshed = await keyDAO.getById(candidate.id).catch(() => null);
          if (refreshed && this.isCapExceeded(refreshed)) {
            await keyDAO.markExhausted(candidate.id, TimestampUtil.getCurrentUnixTimestampInSeconds()).catch(() => undefined);
          }
          await usageDAO
            .insert({
              id: UUIDUtil.getRandomUUID(),
              userEmail: req.userEmail,
              gatewayKeyId: req.gatewayKeyId,
              providerId: req.providerId,
              providerKeyId: candidate.id,
              upstreamModel: req.upstreamModel,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              latencyMs,
              statusCode: upstream.status,
              errorCode: null,
              estimated: usage.estimated,
              now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
            })
            .catch(() => undefined);
          return { status: upstream.status, bodyText, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, estimated: usage.estimated, providerKeyId: candidate.id, attempts: i + 1 };
        }
        lastStatus = upstream.status;
        lastError = bodyText.slice(0, 300) || `Upstream error ${upstream.status}`;
        if (isRetryableStatus(upstream.status)) {
          const failures = candidate.consecutive_failures + 1;
          const cooldownUntil = failures >= disableAfter ? null : TimestampUtil.getCurrentUnixTimestampInSeconds() + Math.ceil(cooldownForFailures(cooldownBase, failures) / 1000);
          await keyDAO.recordFailure(candidate.id, `Upstream ${upstream.status}`, cooldownUntil, TimestampUtil.getCurrentUnixTimestampInSeconds()).catch(() => undefined);
          if (failures >= disableAfter) {
            const db = (keyDAO as unknown as { database: { prepare(q: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } } }).database;
            await db
              .prepare(`UPDATE provider_keys SET status = 'disabled', updated_at = ? WHERE id = ?`)
              .bind(TimestampUtil.getCurrentUnixTimestampInSeconds(), candidate.id)
              .run()
              .catch(() => undefined);
          }
          await usageDAO
            .insert({
              id: UUIDUtil.getRandomUUID(),
              userEmail: req.userEmail,
              gatewayKeyId: req.gatewayKeyId,
              providerId: req.providerId,
              providerKeyId: candidate.id,
              upstreamModel: req.upstreamModel,
              promptTokens: 0,
              completionTokens: 0,
              latencyMs,
              statusCode: upstream.status,
              errorCode: `UPSTREAM_${upstream.status}`,
              estimated: false,
              now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
            })
            .catch(() => undefined);
          continue;
        }
        // Non-retryable 4xx: surface upstream message, no failover.
        await usageDAO
          .insert({
            id: UUIDUtil.getRandomUUID(),
            userEmail: req.userEmail,
            gatewayKeyId: req.gatewayKeyId,
            providerId: req.providerId,
            providerKeyId: candidate.id,
            upstreamModel: req.upstreamModel,
            promptTokens: 0,
            completionTokens: 0,
            latencyMs,
            statusCode: upstream.status,
            errorCode: `UPSTREAM_${upstream.status}`,
            estimated: false,
            now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
          })
          .catch(() => undefined);
        const error = new BadRequestError(lastError.slice(0, 300));
        (error as unknown as { statusCode?: number }).statusCode = upstream.status;
        throw error;
      } catch (error) {
        if (error instanceof BadRequestError && (error as unknown as { statusCode?: number }).statusCode) throw error;
        const message = error instanceof Error ? error.message : 'Upstream request failed';
        lastError = message.slice(0, 300);
        lastStatus = 502;
        const failures = candidate.consecutive_failures + 1;
        const cooldownUntil = TimestampUtil.getCurrentUnixTimestampInSeconds() + Math.ceil(cooldownForFailures(cooldownBase, failures) / 1000);
        await keyDAO.recordFailure(candidate.id, message.slice(0, 500), cooldownUntil, TimestampUtil.getCurrentUnixTimestampInSeconds()).catch(() => undefined);
      }
    }
    if (lastStatus === 429) throw new ExceededLimitError('All provider keys are rate limited. Try again later.');
    throw new BadRequestError(lastError.slice(0, 300) || 'Upstream request failed');
  }
}

export { RouterService };
export type { RouterServiceDeps, RouterServiceEnv, ProxyRequest, ProxySuccess };
