export type Palette = 'warm' | 'cool' | 'neutral';
export const palettes: Palette[] = ['warm', 'cool', 'neutral'];
export function currentPalette(): Palette {
  const value = document.documentElement.getAttribute('data-palette');
  return palettes.includes(value as Palette) ? value as Palette : 'cool';
}
export function updateThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
export function applyPalette(palette: Palette) {
  document.documentElement.setAttribute('data-palette', palette);
  try { localStorage.setItem('cowork-palette', palette); } catch { /* keep the session preference */ }
  updateThemeColor();
}
