import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface CodexOAuthSessionRow {
  session_id: string;
  provider_key_id: string;
  user_email: string;
  state_hash: string;
  code_verifier: string;
  redirect_uri: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

export interface CodexOAuthSession {
  sessionId: string;
  providerKeyId: string;
  userEmail: string;
  stateHash: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

function toSession(row: CodexOAuthSessionRow): CodexOAuthSession {
  return {
    sessionId: row.session_id,
    providerKeyId: row.provider_key_id,
    userEmail: row.user_email,
    stateHash: row.state_hash,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

class CodexOAuthSessionDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(row: {
    sessionId: string;
    providerKeyId: string;
    userEmail: string;
    stateHash: string;
    codeVerifier: string;
    redirectUri: string;
    now: number;
    expiresAt: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `INSERT INTO codex_oauth_sessions
              (session_id, provider_key_id, user_email, state_hash, code_verifier, redirect_uri, created_at, expires_at, consumed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .bind(
            row.sessionId,
            row.providerKeyId,
            row.userEmail.toLowerCase(),
            row.stateHash,
            row.codeVerifier,
            row.redirectUri,
            row.now,
            row.expiresAt,
          )
          .run(),
      'create codex oauth session',
    );
  }

  public async getActive(providerKeyId: string, stateHash: string, now: number): Promise<CodexOAuthSession | null> {
    const row = await this.database
      .prepare(
        `SELECT session_id, provider_key_id, user_email, state_hash, code_verifier, redirect_uri, created_at, expires_at, consumed_at
         FROM codex_oauth_sessions
         WHERE provider_key_id = ? AND state_hash = ? AND expires_at > ? AND consumed_at IS NULL
         LIMIT 1`,
      )
      .bind(providerKeyId, stateHash, now)
      .first<CodexOAuthSessionRow>();
    return row ? toSession(row) : null;
  }

  public async consume(sessionId: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE codex_oauth_sessions SET consumed_at = ? WHERE session_id = ? AND consumed_at IS NULL')
          .bind(now, sessionId)
          .run(),
      'consume codex oauth session',
    );
  }

  public async deleteExpiredOrConsumed(now: number, limit: number): Promise<number> {
    const result = await this.withRetry(
      () =>
        this.database
          .prepare(
            `DELETE FROM codex_oauth_sessions
             WHERE session_id IN (
               SELECT session_id FROM codex_oauth_sessions
               WHERE expires_at < ? OR consumed_at IS NOT NULL
               LIMIT ?
             )`,
          )
          .bind(now, limit)
          .run(),
      'delete expired codex oauth sessions',
    );
    return result.meta?.changes ?? 0;
  }
}

export { CodexOAuthSessionDAO };
