import { calendarLogo, type LogoPalette } from './logo-calendar';
import { detectHemisphere } from './hemisphere';
import { applyFavicon } from './favicon';

// Retired settings (#698): the logo is automatic now, so any saved choice is just cleared.
const STALE_KEYS = ['noevia:logo-calendar', 'noevia:logo-hemisphere'];

let preview: LogoPalette | null = null;
export function refreshLogo(): void {
  const palette = preview ?? calendarLogo(detectHemisphere());
  document.documentElement.dataset.logoPalette = palette;
  void applyFavicon(palette);
}
/** Development-only palette preview; never writes storage. */
export function previewLogo(palette: LogoPalette | null): void { preview = palette; refreshLogo(); }
export function clearStaleLogoPreferences(): void {
  for (const key of STALE_KEYS) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable: nothing to clear */ }
  }
}
export function startLogoAppearance(): () => void {
  clearStaleLogoPreferences();
  refreshLogo();
  // Re-evaluate across a season change and after a suspended tab becomes visible; the favicon
  // is only rewritten when the palette actually changes.
  const timer = window.setInterval(refreshLogo, 3_600_000);
  document.addEventListener('visibilitychange', refreshLogo);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshLogo); };
}
