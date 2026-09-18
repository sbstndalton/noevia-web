export type Palette = 'warm' | 'cool' | 'neutral' | 'sage' | 'iris';
export type Mode = 'light' | 'dark';
/** What the person chose; 'system' follows the device. `data-theme` always holds the resolved Mode. */
export type Preference = Mode | 'system';
export type Appearance = { theme: Preference; light: Palette; dark: Palette };
export function systemMode(): Mode {
  try { return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
}
export function resolveMode(preference: Preference): Mode {
  return preference === 'system' ? systemMode() : preference;
}
/** Iris is the noevia default; the rest re-hue the same tone ladder (scripts/palette.cjs). */
export const palettes: Palette[] = ['iris', 'warm', 'cool', 'neutral', 'sage'];
export function currentPalette(): Palette {
  const value = document.documentElement.getAttribute('data-palette');
  return palettes.includes(value as Palette) ? value as Palette : 'iris';
}
export function savedPalette(mode: Mode): Palette {
  try {
    const value = localStorage.getItem(`cowork-palette-${mode}`) || localStorage.getItem('cowork-palette');
    if (palettes.includes(value as Palette)) return value as Palette;
  } catch { /* unavailable storage: use the current session */ }
  return currentPalette();
}
export function parseAppearance(value: unknown): Appearance {
  const p = value as Appearance | null;
  if (!p || !['light','dark','system'].includes(p.theme) || !palettes.includes(p.light) || !palettes.includes(p.dark)) throw Error('Invalid appearance response');
  return {theme:p.theme,light:p.light,dark:p.dark};
}
export function updateThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
export function applyAppearance(value: Appearance) {
  const mode = resolveMode(value.theme);
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.setAttribute('data-theme-preference', value.theme);
  document.documentElement.setAttribute('data-palette', value[mode]);
  try {
    localStorage.setItem('cowork-theme',value.theme);
    localStorage.setItem('cowork-palette',value[mode]);
    localStorage.setItem('cowork-palette-light',value.light);
    localStorage.setItem('cowork-palette-dark',value.dark);
  } catch { /* profile saving can still succeed without browser storage */ }
  updateThemeColor();
  window.dispatchEvent(new Event('cowork:appearance'));
}
export function applyPalette(palette: Palette) {
  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const preference = (document.documentElement.getAttribute('data-theme-preference') || theme) as Preference;
  applyAppearance({theme:['light','dark','system'].includes(preference)?preference:theme,light:savedPalette('light'),dark:savedPalette('dark'),[theme]:palette});
  window.dispatchEvent(new CustomEvent('cowork:palette-change',{detail:{mode:theme,palette}}));
}
