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
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
const BYTE_LABELS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
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
  return `${formatNumber(value, locale, digits)} ${BYTE_LABELS[i]}`;
}

/** A quantity already counted in a decimal-labelled unit (a model's 3.3 "GB") in the locale's own
 *  words: "3,3 Go" in fr, "3,3 GB" in de and en. */
export function formatSizeUnit(value: number, unit: 'MB' | 'GB' | 'TB', locale: string | undefined, digits: FractionDigits = { max: 2 }): string {
  const max = typeof digits === 'number' ? digits : digits.max;
  const min = typeof digits === 'number' ? digits : digits.min ?? 0;
  const intl = { MB: 'megabyte', GB: 'gigabyte', TB: 'terabyte' }[unit];
  try { return new Intl.NumberFormat(locale, { style: 'unit', unit: intl, unitDisplay: 'short', minimumFractionDigits: min, maximumFractionDigits: max }).format(value); } catch { /* unknown locale */ }
  return `${formatNumber(value, locale, digits)} ${unit}`;
}

// Binary sizes (KiB, MiB, GiB) have no Intl unit. Their names per language: the IEC symbols
// everywhere except French, whose octet-based names are Kio, Mio, Gio (the CLDR "o" for a byte).
export type BinaryUnit = 'B' | 'KiB' | 'MiB' | 'GiB' | 'TiB';
const BINARY_UNITS: BinaryUnit[] = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
const BINARY_LABELS: Record<string, Record<BinaryUnit, string>> = {
  fr: { B: 'o', KiB: 'Kio', MiB: 'Mio', GiB: 'Gio', TiB: 'Tio' },
};

/** The locale's name for a binary unit ("Gio" in fr, "GiB" elsewhere). */
export function binaryUnitLabel(unit: BinaryUnit, locale: string | undefined): string {
  const language = (locale || '').toLowerCase().split(/[-_]/)[0];
  return BINARY_LABELS[language]?.[unit] ?? unit;
}

const gapCache = new Map<string, string>();
/** The space the locale puts between a number and a unit (a no-break space in fr and de). */
function unitGap(locale: string | undefined): string {
  const key = locale ?? '';
  let gap = gapCache.get(key);
  if (gap === undefined) {
    gap = ' ';
    try {
      const literal = new Intl.NumberFormat(locale, { style: 'unit', unit: 'gigabyte', unitDisplay: 'short' }).formatToParts(1).find((p) => p.type === 'literal');
      if (literal) gap = literal.value;
    } catch { /* keep the plain space */ }
    gapCache.set(key, gap);
  }
  return gap;
}

/** A value already counted in `unit` (6.64 GiB) with the locale's number format and unit name. */
export function formatBinaryUnit(value: number, unit: BinaryUnit, locale: string | undefined, digits: FractionDigits = { max: 2 }): string {
  return `${formatNumber(value, locale, digits)}${unitGap(locale)}${binaryUnitLabel(unit, locale)}`;
}

/** A byte count in the binary unit that fits ("1,5 GiB", "1,5 Gio" in fr), one decimal below 100. */
export function formatBinaryBytes(bytes: number, locale: string | undefined): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0, i = 0;
  while (value >= 1024 && i < BINARY_UNITS.length - 1) { value /= 1024; i++; }
  return formatBinaryUnit(value, BINARY_UNITS[i], locale, { max: i === 0 || value >= 100 ? 0 : 1 });
}

/** A server-formatted size ("5.3 TB", "14 GiB", "10 MB/s"): the number in the locale's format and
 *  the unit in the locale's words. This is the FALLBACK for a size the server only sent as text;
 *  where a raw byte count exists, format that with formatBytes. Text that is not "<number> <known
 *  unit>[rest]" goes through localizeLeadingNumber unchanged otherwise. */
export function localizeSizeText(text: string, locale: string | undefined): string {
  const m = /^(\d+)(?:\.(\d+))?[\s ]*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)(?![A-Za-z])([\s\S]*)$/.exec(text);
  if (!m) return localizeLeadingNumber(text, locale);
  const value = Number(`${m[1]}${m[2] ? `.${m[2]}` : ''}`), decimals = m[2]?.length ?? 0, unit = m[3], rest = m[4];
  if (unit === 'MB' || unit === 'GB' || unit === 'TB') return formatSizeUnit(value, unit, locale, decimals) + rest;
  if (unit === 'B') return `${formatNumber(value, locale, 0)}${unitGap(locale)}${binaryUnitLabel('B', locale)}${rest}`;
  if (unit === 'KB') {
    // Intl names the kilobyte too ("kB", "ko"); take the name from a one-unit sample.
    const sample = formatBytes(1024, locale).replace(/^[\d.,\s\u00a0\u202f]+/, '');
    return `${formatNumber(value, locale, decimals)}${unitGap(locale)}${sample}${rest}`;
  }
  return formatBinaryUnit(value, unit as BinaryUnit, locale, decimals) + rest;
}
