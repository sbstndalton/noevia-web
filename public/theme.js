// Runs before the application/styles load, including when storage is unavailable.
(() => {
  let theme = 'dark';
  let palette = 'cool';
  try { if (localStorage.getItem('cowork-theme') === 'light') theme = 'light'; } catch { /* use the default */ }
  try { const saved = localStorage.getItem('cowork-palette'); if (['warm', 'cool', 'neutral'].includes(saved)) palette = saved; } catch { /* use the default */ }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-palette', palette);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ({ warm: { light: '#fbf7f0', dark: '#24201d' }, cool: { light: '#faf9f7', dark: '#1c1d20' }, neutral: { light: '#fafafa', dark: '#202020' } })[palette][theme]);
})();
