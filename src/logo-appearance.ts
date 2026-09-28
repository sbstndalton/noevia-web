import { calendarLogo, type LogoPalette } from './logo-calendar';
import { PREFERENCES, readPreference } from './preferences';
let preview: LogoPalette | null = null;
export function refreshLogo(): void {
  document.documentElement.dataset.logoPalette = preview ?? calendarLogo(readPreference('logo'), readPreference('hemisphere'));
}
/** Ephemeral admin preview, cleared on leaving Appearance; never writes storage. */
export function previewLogo(palette: LogoPalette | null): void { preview = palette; refreshLogo(); }
export function startLogoAppearance(): () => void {
  const stored = () => {
    for (const name of ['logo', 'hemisphere'] as const) {
      const spec = PREFERENCES[name];
      try {
        const value = localStorage.getItem(spec.key);
        document.documentElement.setAttribute(spec.attribute, (spec.values as readonly string[]).includes(value || '') ? value! : spec.values[0]);
      } catch { /* Keep the in-memory preference when storage is unavailable. */ }
    }
    refreshLogo();
  };
  stored();
  // Re-evaluate across midnight and after a suspended tab becomes visible.
  const timer = window.setInterval(refreshLogo, 60_000);
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === PREFERENCES.logo.key || event.key === PREFERENCES.hemisphere.key) stored();
  };
  document.addEventListener('visibilitychange', refreshLogo);
  window.addEventListener('storage', storage);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshLogo); window.removeEventListener('storage', storage); };
}
