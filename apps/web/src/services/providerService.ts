import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import type { Provider, ProviderKey } from '../types';

export async function listProviders(): Promise<Provider[]> {
  const data = await apiGet<{ providers: Provider[] }>('/user/providers');
  return data.providers ?? [];
}

export async function createProvider(kind: string, name: string, baseUrl?: string): Promise<Provider> {
  return apiPost<Provider>('/user/providers', { kind, name, baseUrl: baseUrl || undefined });
}

export async function updateProvider(id: string, patch: { name?: string; baseUrl?: string | null; status?: string }): Promise<Provider> {
  return apiPatch<Provider>(`/user/providers/${id}`, patch);
}

export async function deleteProvider(id: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/user/providers/${id}`);
}

export async function listProviderKeys(providerId: string): Promise<ProviderKey[]> {
  const data = await apiGet<{ keys: ProviderKey[] }>(`/user/providers/${providerId}/keys`);
  return data.keys ?? [];
}

export async function addProviderKey(
  providerId: string,
  input: { name: string; secret: string; tokenLimit?: number | null; requestLimit?: number | null; resetInDays?: number | null; priority?: number },
): Promise<ProviderKey> {
  return apiPost<ProviderKey>(`/user/providers/${providerId}/keys`, input);
}

export async function updateProviderKey(providerId: string, keyId: string, patch: { name?: string; priority?: number; tokenLimit?: number | null; requestLimit?: number | null; status?: string }): Promise<ProviderKey> {
  return apiPatch<ProviderKey>(`/user/providers/${providerId}/keys/${keyId}`, patch);
}

export async function rotateProviderKey(providerId: string, keyId: string, secret: string): Promise<ProviderKey> {
  return apiPost<ProviderKey>(`/user/providers/${providerId}/keys/${keyId}/rotate`, { secret });
}

export async function resetProviderKeyUsage(providerId: string, keyId: string, resetInDays?: number): Promise<ProviderKey> {
  return apiPost<ProviderKey>(`/user/providers/${providerId}/keys/${keyId}/reset-usage`, { resetInDays });
}

export async function deleteProviderKey(providerId: string, keyId: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/user/providers/${providerId}/keys/${keyId}`);
}
