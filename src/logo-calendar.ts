// Calendar colours are a device preference. Months use the device's local calendar;
// an explicit hemisphere avoids guessing geography from a language or time zone.
export const LOGO_PALETTES = ['default', 'spring', 'summer', 'autumn', 'winter', 'rose', 'clover', 'harvest', 'festive'] as const;
export type LogoPalette = typeof LOGO_PALETTES[number];
export type LogoMode = 'default' | 'seasonal' | 'monthly';
export type Hemisphere = 'north' | 'south';
export function calendarLogo(mode: LogoMode, hemisphere: Hemisphere, date = new Date()): LogoPalette {
  const month = date.getMonth();
  if (mode === 'default' || !Number.isFinite(month)) return 'default';
  if (mode === 'monthly') {
    const occasions: Partial<Record<number, LogoPalette>> = { 1: 'rose', 2: 'clover', 9: 'harvest', 11: 'festive' };
    if (occasions[month]) return occasions[month]!;
  }
  const seasons: LogoPalette[] = ['winter', 'spring', 'summer', 'autumn'];
  const season = Math.floor(((month + 1) % 12) / 3);
  return seasons[(season + (hemisphere === 'south' ? 2 : 0)) % 4];
}
export function nextLogoPalette(current: LogoPalette): LogoPalette {
  return LOGO_PALETTES[(LOGO_PALETTES.indexOf(current) + 1) % LOGO_PALETTES.length];
}
