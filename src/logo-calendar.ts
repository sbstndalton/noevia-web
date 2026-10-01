// The logo follows the date, automatically: four seasons, no settings. The hemisphere
// comes from the browser's time zone (see hemisphere.ts), never from a location prompt.
export const LOGO_PALETTES = ['default', 'spring', 'summer', 'autumn', 'winter'] as const;
export type LogoPalette = typeof LOGO_PALETTES[number];
export type Hemisphere = 'north' | 'south';

/** Palette colours, mirrored from styles/logo-calendar.css (a unit test keeps the two in step).
 *  The sidebar Logo reads the CSS variables; the tab-bar favicon is built from this table. */
export const PALETTE_COLOURS: Record<Exclude<LogoPalette, 'default'>, { dark: string; mid: string; light: string; twig: string; detail: string }> = {
  spring: { dark: '#479252', mid: '#70AF54', light: '#ACCD70', twig: '#967453', detail: '#35563B' },
  summer: { dark: '#176044', mid: '#398356', light: '#6AAB6F', twig: '#876446', detail: '#244632' },
  autumn: { dark: '#9D4030', mid: '#C77B2D', light: '#DAB84F', twig: '#876044', detail: '#603F29' },
  winter: { dark: '#708C8A', mid: '#99B5AE', light: '#D4DFDA', twig: '#7C8077', detail: '#435753' },
};

/** Meteorological seasons by local month; the southern hemisphere is offset by half a year.
 *  An invalid date falls back to the default leaves. */
export function calendarLogo(hemisphere: Hemisphere, date = new Date()): LogoPalette {
  const month = date.getMonth();
  if (!Number.isFinite(month)) return 'default';
  const seasons: LogoPalette[] = ['winter', 'spring', 'summer', 'autumn'];
  const season = Math.floor(((month + 1) % 12) / 3);
  return seasons[(season + (hemisphere === 'south' ? 2 : 0)) % 4];
}
export function nextLogoPalette(current: LogoPalette): LogoPalette {
  return LOGO_PALETTES[(LOGO_PALETTES.indexOf(current) + 1) % LOGO_PALETTES.length];
}
