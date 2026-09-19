import { apiGet } from '../lib/api';
import type { UsageEntry, UsageSummary } from '../types';

export async function getUsageSummary(days = 30): Promise<UsageSummary> {
  return apiGet<UsageSummary>('/user/usage/summary', { days: String(days) });
}

export async function listUsageLedger(limit = 50, cursor?: string): Promise<{ entries: UsageEntry[]; nextCursor: string | null }> {
  return apiGet<{ entries: UsageEntry[]; nextCursor: string | null }>('/user/usage/ledger', {
    limit: String(limit),
    cursor,
  });
}
