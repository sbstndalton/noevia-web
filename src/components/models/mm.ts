import { apiFetch } from '../../api';

// Client for the model manager JSON API (administrators only), proxied by noevia's server.
export async function mm<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const r = await apiFetch('/api/model-manager/' + path, {
    method: init.method || (hasBody ? 'POST' : 'GET'),
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error((v as { error?: string }).error || `Request failed (${r.status})`), { status: r.status });
  return v as T;
}

export const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
export const tokens = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
export const ctxShort = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024}K` : tokens(n));
export const gib = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${n.toFixed(digits)} GiB`);
export const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GiB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MiB` : `${Math.round(n / 1024)} KiB`);
export function ago(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
