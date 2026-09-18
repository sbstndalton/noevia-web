// Runs before the application/styles load, including when storage is unavailable.
(() => {
  // Preference is light, dark or system (the default, following the device like other apps).
  let preference = 'system';
  try { const saved = localStorage.getItem('cowork-theme'); if (['light', 'dark', 'system'].includes(saved)) preference = saved; } catch { /* use the default */ }
  let systemLight = false;
  try { systemLight = !!matchMedia('(prefers-color-scheme: light)').matches; } catch { /* no media queries: dark */ }
  const theme = preference === 'system' ? (systemLight ? 'light' : 'dark') : preference;
  document.documentElement.setAttribute('data-theme-preference', preference);
  document.documentElement.setAttribute('data-theme', theme);
  // One noevia palette since the 2026-09-18 overhaul; stored palette names are ignored.
  document.documentElement.setAttribute('data-palette', 'noevia');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f9f9ff' : '#151519');
  for (const [key, attribute, allowed] of [
    ['noevia:chat-font', 'data-chat-font', ['sans', 'serif', 'mono']],
    ['noevia:density', 'data-density', ['comfortable', 'compact']],
    ['noevia:motion', 'data-motion', ['system', 'reduced']],
    ['noevia:material', 'data-material', ['liquid', 'glass', 'soft']],
  ]) {
    let value = allowed[0];
    try { const saved = localStorage.getItem(key); if (allowed.includes(saved)) value = saved; } catch { /* use the default */ }
    document.documentElement.setAttribute(attribute, value);
  }
})();
