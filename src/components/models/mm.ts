import { apiFetch } from '../../api';
import { appLocale } from '../../user-preferences';

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
/** A number in the app's date-and-number locale (appLocale(), browser default for 'system'):
 *  `digits` fixes the decimals, otherwise up to two are shown. 32768 is "32,768" in en-GB and
 *  "32.768" in de-DE. */
export const num = (n: number, digits?: number) => new Intl.NumberFormat(appLocale(), digits == null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
export const tokens = (n: number | null | undefined) => (n == null ? '—' : num(n, 0));
export const ctxShort = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${num(n / 1024)}K` : tokens(n));
export const gib = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${num(n, digits)} GiB`);
export const bytes = (n: number) => (n >= 1024 ** 3 ? `${num(n / 1024 ** 3, 1)} GiB` : n >= 1024 ** 2 ? `${num(n / 1024 ** 2, 0)} MiB` : `${num(Math.round(n / 1024), 0)} KiB`);
export { filterOrphanFiles } from './orphan-files';

export function ago(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
