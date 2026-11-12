// Small display helpers for the Spaces screens: pure, locale-aware, no React.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];

/** "3 hours ago", in the interface language. `ts` is epoch milliseconds (or seconds below 1e11). */
export function relativeTime(ts: number, locale: string | undefined, now = Date.now()): string {
  const ms = ts < 1e11 ? ts * 1000 : ts;
  const seconds = Math.round((ms - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, 'second');
}

/** A first line to show for a page that has no title worth showing. */
export const pageName = (title: string, untitled: string): string => title.trim() || untitled;
