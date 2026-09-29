import { apiFetch } from '../../api';
import { appLocale } from '../../user-preferences';
import { binaryUnitLabel, formatBinaryBytes, formatBytes, formatBinaryUnit, formatDuration, formatNumber, formatPercent, formatSizeUnit, localizeSizeText } from '../../number-format';

type FractionDigitsArg = number | { min?: number; max: number };

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
export const num = (n: number, digits?: number) => formatNumber(n, appLocale(), digits == null ? { max: 2 } : digits);
/** Up to `max` decimals, none forced ("8", "8,3"): chart axis ticks. */
export const numUpTo = (n: number, max: number) => formatNumber(n, appLocale(), { max });
/** A quantity the model manager service already formatted ("5.3 TB", "10 MB/s"), with its number
 *  in the interface locale. */
export const human = (text: string) => localizeSizeText(text, appLocale());
/** A percentage (27 means 27 %) in the interface locale's percent format ("27%", "27 %"). */
export const pct = (n: number, digits: FractionDigitsArg = 0) => formatPercent(n, appLocale(), digits);
/** A span of seconds with the locale's own unit names ("1 Std. 14 Min."). */
export const duration = (seconds: number) => formatDuration(seconds, appLocale());
export const tokens = (n: number | null | undefined) => (n == null ? '—' : num(n, 0));
export const ctxShort = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${num(n / 1024)}K` : tokens(n));
/** A memory size counted in GiB, with the locale's own unit name ("6,64 Gio" in fr). The unit lives
 *  here, never in a catalogue string, so a catalogue cannot print the wrong one (#636). */
export const gib = (n: number | null | undefined, digits: number | { min?: number; max: number } = 1) => (n == null ? '—' : formatBinaryUnit(n, 'GiB', appLocale(), digits));
/** A chart unit as written in code (" GiB") in the locale's words (" Gio"); other units pass through. */
export const unitLabel = (unit: string) => unit.replace(/(KiB|MiB|GiB|TiB)$/, (u) => binaryUnitLabel(u as 'KiB' | 'MiB' | 'GiB' | 'TiB', appLocale()));
/** A decimal-labelled size counted in GB ("3,3 Go" in fr). */
export const gb = (n: number, digits: number | { min?: number; max: number } = 1) => formatSizeUnit(n, 'GB', appLocale(), digits);
/** A byte count in the unit that fits (o/ko/Mo/Go/To in fr), the same formatter as Backups and project files. */
export const size = (n: number) => formatBytes(n, appLocale());
/** A byte count in the binary unit that fits. */
export const bytes = (n: number) => formatBinaryBytes(n, appLocale());
export { filterOrphanFiles } from './orphan-files';

export function ago(seconds: number) {
  if (seconds < 60) return duration(Math.round(seconds));
  if (seconds < 3600) return duration(Math.round(seconds / 60) * 60);
  return `${num(seconds / 3600, 1)} h`;
}
