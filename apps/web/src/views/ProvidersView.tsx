import { useEffect, useState } from 'react';
import { AppPage } from '../components/layout/AppPage';
import { PageHeaderCard } from '../components/layout/PageHeaderCard';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import type { Provider, ProviderKey } from '../types';
import {
  addProviderKey,
  createProvider,
  deleteProvider,
  deleteProviderKey,
  listProviderKeys,
  listProviders,
  resetProviderKeyUsage,
  rotateProviderKey,
  updateProviderKey,
} from '../services/providerService';

function usageLabel(key: ProviderKey): string {
  const parts: string[] = [`${key.usedRequests} Reqs`, `${key.usedTokens} Tokens`];
  if (key.requestLimit) parts.push(`/ ${key.requestLimit} Req Cap`);
  if (key.tokenLimit) parts.push(`/ ${key.tokenLimit} Tok Cap`);
  return parts.join(' · ');
}

export function ProvidersView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keysByProvider, setKeysByProvider] = useState<Record<string, ProviderKey[]>>({});
  const [kind, setKind] = useState('OPENAI');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [keyForm, setKeyForm] = useState<Record<string, { name: string; secret: string }>>({});

  const reload = async () => {
    try {
      const list = await listProviders();
      setProviders(list);
      const entries: Record<string, ProviderKey[]> = {};
      for (const p of list) {
        try {
          entries[p.id] = await listProviderKeys(p.id);
        } catch {
          entries[p.id] = [];
        }
      }
      setKeysByProvider(entries);
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Load Providers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mount fetch is the intended sync point
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    if (!name.trim()) {
      showNotice('error', 'Provider Name Is Required.');
      return;
    }
    try {
      await createProvider(kind, name.trim());
      setName('');
      showNotice('success', 'Provider Created.');
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Create Provider.');
    }
  };

  const runMutation = (task: Promise<unknown>, okMessage: string): void => {
    void task
      .then(() => {
        showNotice('success', okMessage);
        void reload();
      })
      .catch((error: unknown) => showNotice('error', error instanceof Error ? error.message : 'Failed.'));
  };

  const onRotate = (providerId: string, keyId: string): void => {
    const secret = globalThis.prompt('Paste Replacement Secret');
    if (secret) runMutation(rotateProviderKey(providerId, keyId, secret), 'Key Rotated.');
  };

  const onAddKey = async (providerId: string): Promise<void> => {
    const form = keyForm[providerId] ?? { name: '', secret: '' };
    if (!form.name.trim() || !form.secret.trim()) {
      showNotice('error', 'Key Name And Secret Are Required.');
      return;
    }
    try {
      await addProviderKey(providerId, { name: form.name.trim(), secret: form.secret.trim() });
      setKeyForm((prev) => ({ ...prev, [providerId]: { name: '', secret: '' } }));
      showNotice('success', 'Provider Key Added.');
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Add Key.');
    }
  };

  return (
    <AppPage>
      <PageHeaderCard title="Providers" description="Pool Multiple Upstream Keys Per Provider. Failover Is Automatic." />

      <Card>
        <CardHeader>
          <CardTitle>New Provider</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-sm" aria-label="Provider Kind">
            <option value="OPENAI">OpenAI</option>
            <option value="ANTHROPIC">Anthropic</option>
            <option value="GEMINI">Gemini</option>
            <option value="OPENAI_COMPAT">OpenAI Compatible</option>
          </select>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Provider Name (e.g. Primary OpenAI)" aria-label="Provider Name" />
          <Button variant="primary" size="sm" onClick={() => void onCreate()}>
            Create
          </Button>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : providers.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-secondary)]">No Providers Yet. Create One To Get Started.</p>
        </Card>
      ) : (
        providers.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>
                {p.name} <span className="text-xs text-[var(--color-text-muted)]">{p.kind}</span>
              </CardTitle>
              <Button variant="secondary" size="sm" onClick={() => runMutation(deleteProvider(p.id), 'Provider Deleted.')}>
                Delete
              </Button>
            </CardHeader>
            <div className="space-y-2">
              {(keysByProvider[p.id] ?? []).map((k) => (
                <div key={k.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] p-2">
                  <span className="text-sm font-medium">{k.name}</span>
                  <Badge>{k.status}</Badge>
                  <span className="text-xs text-[var(--color-text-muted)]">{k.keyHint ?? ''}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{usageLabel(k)}</span>
                  {k.lastError && <span className="text-xs text-red-500 truncate max-w-xs">{k.lastError}</span>}
                  <span className="ml-auto flex gap-1">
                    <Button variant="secondary" size="sm" onClick={() => runMutation(resetProviderKeyUsage(p.id, k.id), 'Usage Reset.')}>
                      Reset Usage
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => runMutation(updateProviderKey(p.id, k.id, { status: k.status === 'disabled' ? 'active' : 'disabled' }), 'Key Updated.')}>
                      {k.status === 'disabled' ? 'Enable' : 'Disable'}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => onRotate(p.id, k.id)}>
                      Rotate
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => runMutation(deleteProviderKey(p.id, k.id), 'Key Deleted.')}>
                      Delete
                    </Button>
                  </span>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <Input
                  value={keyForm[p.id]?.name ?? ''}
                  onChange={(e) => setKeyForm((prev) => ({ ...prev, [p.id]: { name: e.target.value, secret: prev[p.id]?.secret ?? '' } }))}
                  placeholder="Key Name"
                  aria-label="Key Name"
                />
                <Input
                  value={keyForm[p.id]?.secret ?? ''}
                  onChange={(e) => setKeyForm((prev) => ({ ...prev, [p.id]: { name: prev[p.id]?.name ?? '', secret: e.target.value } }))}
                  placeholder="Upstream Secret (sk-…)"
                  aria-label="Upstream Secret"
                />
                <Button variant="primary" size="sm" onClick={() => void onAddKey(p.id)}>
                  Add Key
                </Button>
              </div>
            </div>
          </Card>
        ))
      )}
    </AppPage>
  );
}
