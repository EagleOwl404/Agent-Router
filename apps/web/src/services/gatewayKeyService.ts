import { apiDelete, apiGet, apiPost } from '../lib/api';
import type { CreatedGatewayKey, GatewayKey } from '../types';

export async function listGatewayKeys(): Promise<GatewayKey[]> {
  const data = await apiGet<{ keys: GatewayKey[] }>('/user/gateway-keys');
  return data.keys ?? [];
}

export async function createGatewayKey(name: string, expiresInDays?: number): Promise<CreatedGatewayKey> {
  return apiPost<CreatedGatewayKey>('/user/gateway-keys', { name, expiresInDays });
}

export async function revokeGatewayKey(keyId: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/user/gateway-keys/${keyId}`);
}
