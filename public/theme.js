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
  // The accent palette, applied before paint like the theme so there is no flash of
  // the wrong accent. Iris is noevia's own; the rest re-hue the same tone ladder.
  const accents = ['iris', 'warm', 'cool', 'neutral', 'sage'];
  let palette = 'iris';
  try {
    const saved = localStorage.getItem('cowork-palette-' + theme) || localStorage.getItem('cowork-palette');
    if (accents.includes(saved)) palette = saved;
  } catch { /* use the default */ }
  document.documentElement.setAttribute('data-palette', palette);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f9f9ff' : '#151519');
  for (const [key, attribute, allowed] of [
    ['noevia:chat-font', 'data-chat-font', ['sans', 'serif', 'mono']],
    ['noevia:density', 'data-density', ['comfortable', 'compact']],
    ['noevia:motion', 'data-motion', ['system', 'reduced']],
  ]) {
    let value = allowed[0];
    try { const saved = localStorage.getItem(key); if (allowed.includes(saved)) value = saved; } catch { /* use the default */ }
    document.documentElement.setAttribute(attribute, value);
  }
  // Theme family (#249). A browser that saved one of the retired materials lands on the
  // family that replaced it; src/theme-family.ts holds the same table.
  const families = ['editorial', 'contemporary', 'glass'];
  const migration = { soft: 'editorial', material: 'contemporary', liquid: 'glass' };
  let family = 'editorial';
  try {
    const saved = localStorage.getItem('noevia:theme-family');
    const legacy = localStorage.getItem('noevia:material');
    if (families.includes(saved)) family = saved;
    else if (Object.prototype.hasOwnProperty.call(migration, legacy)) family = migration[legacy];
  } catch { /* use the default */ }
  document.documentElement.setAttribute('data-family', family);
})();
