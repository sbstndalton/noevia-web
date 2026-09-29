// The one place a number becomes display text in the interface locale (#587). The model manager
// (sizes, chart axes, tokens/s) used to mix `toFixed` (always an English "3.3") with
// Intl.NumberFormat ("131.072") on the same card. Everything goes through Intl.NumberFormat with
// the active UI locale instead, so every locale gets its own decimal and grouping separators.
// Pure and import-free so tests can load it in isolation.

export type FractionDigits = number | { min?: number; max: number };

const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string | undefined, digits: FractionDigits): Intl.NumberFormat {
  const min = typeof digits === 'number' ? digits : digits.min ?? 0;
  const max = typeof digits === 'number' ? digits : digits.max;
  const key = `${locale ?? ''}|${min}|${max}`;
  let f = cache.get(key);
  if (!f) {
    try { f = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max }); }
    catch { f = new Intl.NumberFormat(undefined, { minimumFractionDigits: min, maximumFractionDigits: max }); }
    cache.set(key, f);
  }
  return f;
}

/** `digits` is a fixed count, or {min, max}. `locale` undefined means the browser's own. */
export function formatNumber(n: number, locale: string | undefined, digits: FractionDigits = { max: 2 }): string {
  return formatter(locale, digits).format(n);
}

/** Localises the leading number of a server-formatted quantity ("5.3 TB", "10 MB/s", "1m"),
 *  keeping its own decimal count and the rest of the text. Anything that does not start with a
 *  plain number is returned unchanged. */
export function localizeLeadingNumber(text: string, locale: string | undefined): string {
  const m = /^(\d+)(?:\.(\d+))?([\s\S]*)$/.exec(text);
  if (!m) return text;
  const decimals = m[2]?.length ?? 0;
  return formatNumber(Number(`${m[1]}${m[2] ? `.${m[2]}` : ''}`), locale, decimals) + m[3];
}

const percentCache = new Map<string, Intl.NumberFormat>();

/** A percentage in the locale's own percent format ("27 %" in de/fr, "27%" in en). `pct` is in
 *  percent points (27 means 27 %), which is how the model manager and the stats strip carry it. */
export function formatPercent(pct: number, locale: string | undefined, digits: FractionDigits = 0): string {
  const min = typeof digits === 'number' ? digits : digits.min ?? 0;
  const max = typeof digits === 'number' ? digits : digits.max;
  const key = `${locale ?? ''}|${min}|${max}`;
  let f = percentCache.get(key);
  if (!f) {
    const options = { style: 'percent' as const, minimumFractionDigits: min, maximumFractionDigits: max };
    try { f = new Intl.NumberFormat(locale, options); } catch { f = new Intl.NumberFormat(undefined, options); }
    percentCache.set(key, f);
  }
  return f.format(pct / 100);
}

const unitCache = new Map<string, Intl.NumberFormat | null>();
function unitFormatter(locale: string | undefined, unit: string): Intl.NumberFormat | null {
  const key = `${locale ?? ''}|${unit}`;
  const hit = unitCache.get(key);
  if (hit !== undefined) return hit;
  let f: Intl.NumberFormat | null = null;
  try { f = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 0 }); } catch { f = null; }
  unitCache.set(key, f);
  return f;
}

const ENGLISH_UNIT: Record<string, string> = { day: 'd', hour: 'h', minute: 'm', second: 's' };

/** A span of seconds as at most two units, the same shape the server used to build (s, m, h m,
 *  d h), in the locale's own unit names ("1 Std. 14 Min.", "13 T 15 Std."). Uses
 *  Intl.DurationFormat where the browser has it, then Intl.NumberFormat unit formatting, and last
 *  the compact English letters ("1h 14m") if neither can format the locale. */
export function formatDuration(totalSeconds: number, locale: string | undefined): string {
  const secs = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  const parts: [string, number][] = secs < 60 ? [['second', secs]] : secs < 3600 ? [['minute', m]]
    : secs < 86400 ? [['hour', h], ['minute', m]] : [['day', d], ['hour', h]];
  const DurationFormat = (Intl as unknown as { DurationFormat?: new (l?: string, o?: object) => { format(v: object): string } }).DurationFormat;
  // DurationFormat leaves out zero-valued units, so an all-zero span ("0 s") would come out empty.
  if (DurationFormat && parts.some(([, v]) => v > 0)) {
    try { return new DurationFormat(locale, { style: 'short' }).format(Object.fromEntries(parts.map(([u, v]) => [`${u}s`, v]))); } catch { /* fall through */ }
  }
  const formatted: string[] = [];
  for (const [unit, value] of parts) {
    const f = unitFormatter(locale, unit);
    if (!f) return parts.map(([u, v]) => `${v}${ENGLISH_UNIT[u]}`).join(' ');
    formatted.push(f.format(value));
  }
  return formatted.join(' ');
}

const compactCache = new Map<string, Intl.NumberFormat>();

/** A count in the locale's own compact form (#600): "1.2K" and "1.2M" in en, "1,2 Mio." in de,
 *  "1,2 M" in fr. Below a thousand it is the plain integer. Intl.NumberFormat owns the suffix, so
 *  no locale keeps an English "k", "M" or "B". */
export function formatCompact(n: number, locale: string | undefined): string {
  const key = locale ?? '';
  let f = compactCache.get(key);
  if (!f) {
    const options = { notation: 'compact' as const, compactDisplay: 'short' as const, maximumFractionDigits: 1 };
    try { f = new Intl.NumberFormat(locale, options); } catch { f = new Intl.NumberFormat(undefined, options); }
    compactCache.set(key, f);
  }
  return f.format(n);
}

const byteCache = new Map<string, Intl.NumberFormat | null>();
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
function byteFormatter(locale: string | undefined, unit: string, digits: number): Intl.NumberFormat | null {
  const key = `${locale ?? ''}|${unit}|${digits}`;
  const hit = byteCache.get(key);
  if (hit !== undefined) return hit;
  let f: Intl.NumberFormat | null = null;
  try { f = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }); } catch { f = null; }
  byteCache.set(key, f);
  return f;
}

/** A file size in the unit that fits (B, KB, MB, GB; 1024 steps) with the locale's own separators
 *  and unit names ("2 kB" / "1,5 MB" in de, "2 ko" in fr), so a 2 KB note no longer reads
 *  "0.00 MB" (#610). Whole numbers below 1 KB and from 100 up; one decimal in between. */
export function formatBytes(bytes: number, locale: string | undefined): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0, i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) { value /= 1024; i++; }
  const digits = i === 0 || value >= 100 ? 0 : 1;
  const f = byteFormatter(locale, BYTE_UNITS[i], digits);
  if (f) return f.format(value);
  return `${formatNumber(value, locale, digits)} ${['B', 'KB', 'MB', 'GB'][i]}`;
}
