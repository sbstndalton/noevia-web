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
