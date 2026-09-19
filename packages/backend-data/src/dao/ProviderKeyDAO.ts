import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { ProviderKeyMetadata, ProviderKeyStatus } from '@agent-router/shared';

export interface ProviderKeyRow {
  id: string;
  provider_id: string;
  user_email: string;
  name: string;
  encrypted_key: string;
  key_hint: string | null;
  token_limit: number | null;
  request_limit: number | null;
  used_tokens: number;
  used_requests: number;
  reset_at: number | null;
  priority: number;
  status: string;
  cooldown_until: number | null;
  consecutive_failures: number;
  last_used_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number | null;
}

function toMetadata(row: ProviderKeyRow): ProviderKeyMetadata {
  return {
    id: row.id,
    providerId: row.provider_id,
    userEmail: row.user_email,
    name: row.name,
    keyHint: row.key_hint,
    tokenLimit: row.token_limit,
    requestLimit: row.request_limit,
    usedTokens: row.used_tokens,
    usedRequests: row.used_requests,
    resetAt: row.reset_at,
    priority: row.priority,
    status: row.status as ProviderKeyStatus,
    cooldownUntil: row.cooldown_until,
    consecutiveFailures: row.consecutive_failures,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ProviderKeyDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(row: {
    id: string;
    providerId: string;
    userEmail: string;
    name: string;
    encryptedKey: string;
    keyHint: string | null;
    tokenLimit: number | null;
    requestLimit: number | null;
    resetAt: number | null;
    priority: number;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `INSERT INTO provider_keys (id, provider_id, user_email, name, encrypted_key, key_hint,
              token_limit, request_limit, used_tokens, used_requests, reset_at, priority, status,
              cooldown_until, consecutive_failures, last_used_at, last_error, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'active', NULL, 0, NULL, NULL, ?, NULL)`,
          )
          .bind(
            row.id,
            row.providerId,
            row.userEmail.toLowerCase(),
            row.name,
            row.encryptedKey,
            row.keyHint,
            row.tokenLimit,
            row.requestLimit,
            row.resetAt,
            row.priority,
            row.now,
          )
          .run(),
      'create provider key',
    );
  }

  public async getById(id: string): Promise<ProviderKeyRow | null> {
    return this.database.prepare('SELECT * FROM provider_keys WHERE id = ? LIMIT 1').bind(id).first<ProviderKeyRow>();
  }

  public async getMetadataById(id: string): Promise<ProviderKeyMetadata | null> {
    const row = await this.getById(id);
    return row ? toMetadata(row) : null;
  }

  public async listByProvider(providerId: string): Promise<ProviderKeyMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY priority ASC, created_at ASC')
      .bind(providerId)
      .all<ProviderKeyRow>();
    return (result.results ?? []).map(toMetadata);
  }

  public async listActiveByProvider(providerId: string, now: number): Promise<ProviderKeyRow[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM provider_keys WHERE provider_id = ?
         AND status = 'active' AND (cooldown_until IS NULL OR cooldown_until <= ?)
         ORDER BY priority ASC, last_used_at ASC NULLS FIRST, created_at ASC`,
      )
      .bind(providerId, now)
      .all<ProviderKeyRow>();
    return result.results ?? [];
  }

  public async countByProvider(providerId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM provider_keys WHERE provider_id = ?')
      .bind(providerId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  public async updateMeta(
    id: string,
    patch: { name?: string; priority?: number; tokenLimit?: number | null; requestLimit?: number | null; status?: ProviderKeyStatus; now: number },
  ): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE provider_keys SET name = ?, priority = ?, token_limit = ?, request_limit = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(
            patch.name ?? current.name,
            patch.priority ?? current.priority,
            patch.tokenLimit ?? current.token_limit,
            patch.requestLimit ?? current.request_limit,
            patch.status ?? current.status,
            patch.now,
            id,
          )
          .run(),
      'update provider key',
    );
  }

  public async recordSuccess(id: string, promptTokens: number, completionTokens: number, now: number): Promise<void> {
    const total = promptTokens + completionTokens;
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET used_tokens = used_tokens + ?, used_requests = used_requests + 1,
             consecutive_failures = 0, last_used_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(total, now, now, id)
          .run(),
      'record key success',
    );
  }

  public async recordFailure(id: string, error: string, cooldownUntil: number | null, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET consecutive_failures = consecutive_failures + 1,
             cooldown_until = ?, last_error = ?, last_used_at = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(cooldownUntil, error.slice(0, 500), now, now, id)
          .run(),
      'record key failure',
    );
  }

  public async markExhausted(id: string, now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare(`UPDATE provider_keys SET status = 'exhausted', updated_at = ? WHERE id = ?`).bind(now, id).run(),
      'mark key exhausted',
    );
  }

  public async clearCooldown(id: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE provider_keys SET cooldown_until = NULL, consecutive_failures = 0, status = 'active', updated_at = ? WHERE id = ?`)
          .bind(now, id)
          .run(),
      'clear key cooldown',
    );
  }

  public async resetUsage(id: string, resetAt: number | null, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE provider_keys SET used_tokens = 0, used_requests = 0, reset_at = ?, status = 'active', cooldown_until = NULL, consecutive_failures = 0, updated_at = ? WHERE id = ?`)
          .bind(resetAt, now, id)
          .run(),
      'reset key usage',
    );
  }

  public async resetDueKeys(now: number, limit: number): Promise<number> {
    const result = await this.withRetry(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET used_tokens = 0, used_requests = 0, status = 'active', cooldown_until = NULL, consecutive_failures = 0, updated_at = ?
             WHERE id IN (SELECT id FROM provider_keys WHERE reset_at IS NOT NULL AND reset_at <= ? LIMIT ?)`,
          )
          .bind(now, now, limit)
          .run(),
      'reset due keys',
    );
    return result.meta?.changes ?? 0;
  }

  public async disableFailing(threshold: number, now: number, limit: number): Promise<number> {
    const result = await this.withRetry(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET status = 'disabled', updated_at = ?
             WHERE id IN (SELECT id FROM provider_keys WHERE status != 'disabled' AND consecutive_failures >= ? LIMIT ?)`,
          )
          .bind(now, threshold, limit)
          .run(),
      'disable failing keys',
    );
    return result.meta?.changes ?? 0;
  }

  public async delete(id: string): Promise<void> {
    await this.withRetry(() => this.database.prepare('DELETE FROM provider_keys WHERE id = ?').bind(id).run(), 'delete provider key');
  }

  public async deleteByProvider(providerId: string): Promise<void> {
    await this.withRetry(() => this.database.prepare('DELETE FROM provider_keys WHERE provider_id = ?').bind(providerId).run(), 'delete provider keys');
  }
}

export { ProviderKeyDAO };
