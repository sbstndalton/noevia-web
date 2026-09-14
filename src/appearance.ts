export type Palette = 'warm' | 'cool' | 'neutral' | 'sage' | 'iris';
export type Mode = 'light' | 'dark';
export type Appearance = { theme: Mode; light: Palette; dark: Palette };
export const palettes: Palette[] = ['warm', 'cool', 'neutral', 'sage', 'iris'];
export function currentPalette(): Palette {
  const value = document.documentElement.getAttribute('data-palette');
  return palettes.includes(value as Palette) ? value as Palette : 'cool';
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
  if (!p || !['light','dark'].includes(p.theme) || !palettes.includes(p.light) || !palettes.includes(p.dark)) throw Error('Invalid appearance response');
  return {theme:p.theme,light:p.light,dark:p.dark};
}
export function updateThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
export function applyAppearance(value: Appearance) {
  document.documentElement.setAttribute('data-theme', value.theme);
  document.documentElement.setAttribute('data-palette', value[value.theme]);
  try {
    localStorage.setItem('cowork-theme',value.theme);
    localStorage.setItem('cowork-palette',value[value.theme]);
    localStorage.setItem('cowork-palette-light',value.light);
    localStorage.setItem('cowork-palette-dark',value.dark);
  } catch { /* profile saving can still succeed without browser storage */ }
  updateThemeColor();
  window.dispatchEvent(new Event('cowork:appearance'));
}
export function applyPalette(palette: Palette) {
  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyAppearance({theme,light:savedPalette('light'),dark:savedPalette('dark'),[theme]:palette});
  window.dispatchEvent(new CustomEvent('cowork:palette-change',{detail:{mode:theme,palette}}));
}
