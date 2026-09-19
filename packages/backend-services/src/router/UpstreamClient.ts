import type { ProviderKind } from '@agent-router/shared';

interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function buildUpstreamCall(
  kind: ProviderKind,
  baseUrl: string | null,
  path: string,
  secret: string,
  body: unknown,
  anthropicVersion = '2023-06-01',
): UpstreamCall {
  const payload = JSON.stringify(body ?? {});
  if (kind === 'ANTHROPIC') {
    const base = (baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    return {
      url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
      headers: { 'content-type': 'application/json', 'x-api-key': secret, 'anthropic-version': anthropicVersion },
      body: payload,
    };
  }
  if (kind === 'GEMINI') {
    const base = (baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const separator = path.includes('?') ? '&' : '?';
    return {
      url: `${base}${path.startsWith('/') ? path : `/${path}`}${separator}key=${encodeURIComponent(secret)}`,
      headers: { 'content-type': 'application/json' },
      body: payload,
    };
  }
  const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: payload,
  };
}

// Codex OAuth (ChatGPT subscription) tokens are honored by the Codex
// backend, not the OpenAI platform API. Opencode rewrites both
// /v1/responses and /chat/completions to this endpoint.
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
// Rows created before the backend correction pin the platform endpoint;
// keep calling the Codex backend for them instead of 429ing upstream.
const LEGACY_CODEX_BASE_URLS = new Set(['https://api.openai.com/v1', 'https://api.openai.com/v1/']);

function resolveCodexBase(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/$/, '');
  if (!trimmed || LEGACY_CODEX_BASE_URLS.has(trimmed) || LEGACY_CODEX_BASE_URLS.has(`${trimmed}/`)) return CODEX_BASE_URL;
  return trimmed;
}

function buildCodexCall(baseUrl: string | null, path: string, accessToken: string, accountId: string | null, body: unknown): UpstreamCall {
  const payload = JSON.stringify(body ?? {});
  const base = resolveCodexBase(baseUrl);
  // Required by the Codex backend: the Responses beta gate plus the CLI
  // originator (same values sent by the official Codex CLI and the
  // opencode Codex plugins). Without them the backend rejects calls with
  // an HTML 400 instead of reaching the model.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
  };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  return {
    url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
    headers,
    body: payload,
  };
}

interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

function parseUsage(kind: ProviderKind, responseJson: unknown): ParsedUsage {
  try {
    const root = responseJson as Record<string, unknown>;
    const usage = root?.usage as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== 'object') return { promptTokens: 0, completionTokens: 0, estimated: true };
    if (kind === 'ANTHROPIC') {
      const prompt = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
      const completion = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
      return { promptTokens: prompt, completionTokens: completion, estimated: false };
    }
    const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
    const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
    if (prompt === 0 && completion === 0) {
      const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : 0;
      return { promptTokens: total, completionTokens: 0, estimated: total === 0 };
    }
    return { promptTokens: prompt, completionTokens: completion, estimated: false };
  } catch {
    return { promptTokens: 0, completionTokens: 0, estimated: true };
  }
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

export { buildUpstreamCall, buildCodexCall, parseUsage, isRetryableStatus, CODEX_BASE_URL };
export type { UpstreamCall, ParsedUsage };
