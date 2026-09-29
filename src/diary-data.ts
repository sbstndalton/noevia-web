export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function localTimestamp(now = new Date()): string {
  const offset = -now.getTimezoneOffset();
  return `${localDay(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function dateInText(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/);
  const result = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : named ? `${named[3]}-${String(monthNames.indexOf(named[1])+1).padStart(2,'0')}-${named[2].padStart(2,'0')}` : null;
  if (!result) return null;
  const d = new Date(`${result}T12:00:00`);
  return !Number.isNaN(d.valueOf()) && localDay(d) === result ? result : null;
}
export function splitDays(text: string, fallback: string | null = null): Record<string, string> {
  const result: Record<string, string> = {};
  let current = fallback;
  for (const line of text.split('\n')) {
    if (/^#{1,2} /.test(line)) {
      const date = dateInText(line);
      if (date) current = date;
      else if (/^## /.test(line)) current = null;
    }
    if (current) result[current] = (result[current] || '') + line + '\n';
  }
  return result;
}
/** "September 2026" / "septembre 2026", in the given locale (the interface's Intl locale; undefined is the browser's). */
export function monthLabel(id: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${id}-01T12:00:00`));
}
/** "September 1, 2026" / "1 septembre 2026", in the given locale. */
export function dayLabel(id: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${id}T12:00:00`));
}

// First day of the week, 0 = Sunday … 6 = Saturday. Used only when the runtime cannot say
// (Intl.Locale weekInfo / getWeekInfo() is missing): CLDR's answer by region, Monday unless the
// region is listed. A bare language is resolved to its likely region first (fr -> FR, en -> US).
const SUNDAY_FIRST = new Set(['US', 'CA', 'MX', 'BR', 'PT', 'JP', 'IL', 'IN', 'KR', 'TW', 'HK', 'PH', 'ZA', 'SA', 'CO', 'VE', 'PE', 'PA', 'DO', 'GT', 'HN', 'NI', 'SV', 'PR', 'TH', 'ID', 'PK', 'SG', 'MO', 'BD', 'ET', 'KE', 'ZW']);
const SATURDAY_FIRST = new Set(['AE', 'AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY']);
const LIKELY_REGION: Record<string, string> = { en: 'US', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', nb: 'NO', no: 'NO', nn: 'NO', nl: 'NL', pt: 'BR', sv: 'SE', ja: 'JP', ko: 'KR', he: 'IL', ar: 'SA', hi: 'IN', zh: 'CN' };

/** The locale's first weekday as a JS day number (0 = Sunday … 6 = Saturday). Reads Intl.Locale's
 *  week info where the runtime has it, otherwise a fallback table. `locale` undefined is the
 *  browser's own language. Never throws. */
export function firstWeekday(locale?: string): number {
  const tag = locale || (typeof navigator !== 'undefined' ? navigator.languages?.[0] || navigator.language : '') || 'en-US';
  try {
    const l = new Intl.Locale(tag) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = typeof l.getWeekInfo === 'function' ? l.getWeekInfo() : l.weekInfo;
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7; // Intl: 1 = Monday … 7 = Sunday
  } catch { /* fall through to the table */ }
  return fallbackFirstWeekday(tag);
}
/** The table half of firstWeekday, exported so its answers are tested on a runtime that has weekInfo. */
export function fallbackFirstWeekday(tag: string): number {
  const parts = tag.replace(/_/g, '-').split('-');
  const language = (parts[0] || 'en').toLowerCase();
  const region = (parts.slice(1).find((p) => /^[A-Za-z]{2}$|^\d{3}$/.test(p)) || LIKELY_REGION[language] || '').toUpperCase();
  if (SATURDAY_FIRST.has(region)) return 6;
  return SUNDAY_FIRST.has(region) ? 0 : 1;
}
/** The month's day ids, padded with null so the first day falls in the right column for a week that starts on `firstDay`. */
export function calendarDays(id: string, firstDay = 0): (string | null)[] {
  const start = new Date(`${id}-01T12:00:00`);
  const count = new Date(start.getFullYear(), start.getMonth()+1, 0).getDate();
  return [...Array((start.getDay() - firstDay + 7) % 7).fill(null), ...Array.from({length: count}, (_, i) => `${id}-${String(i+1).padStart(2,'0')}`)];
}
