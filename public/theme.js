// Runs before the application/styles load, including when storage is unavailable.
(() => {
  let theme = 'dark';
  let palette = 'cool';
  try { if (localStorage.getItem('cowork-theme') === 'light') theme = 'light'; } catch { /* use the default */ }
  try { const saved = localStorage.getItem('cowork-palette-'+theme) || localStorage.getItem('cowork-palette'); if (['warm', 'cool', 'neutral', 'sage', 'iris'].includes(saved)) palette = saved; } catch { /* use the default */ }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-palette', palette);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ({ warm: { light: '#fbf7f0', dark: '#24201d' }, cool: { light: '#f7f9fc', dark: '#1c1d20' }, neutral: { light: '#fafafa', dark: '#202020' }, sage: { light: '#f4f8f5', dark: '#1b2421' }, iris: { light: '#f7f5fb', dark: '#22202b' } })[palette][theme]);
  for (const [key, attribute, allowed] of [
    ['noevia:chat-font', 'data-chat-font', ['sans', 'serif', 'mono']],
    ['noevia:density', 'data-density', ['comfortable', 'compact']],
    ['noevia:motion', 'data-motion', ['system', 'reduced']],
  ]) {
    let value = allowed[0];
    try { const saved = localStorage.getItem(key); if (allowed.includes(saved)) value = saved; } catch { /* use the default */ }
    document.documentElement.setAttribute(attribute, value);
  }
})();
