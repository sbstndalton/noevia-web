// Runs before the application/styles load, including when storage is unavailable.
(() => {
  let theme = 'dark';
  try { if (localStorage.getItem('cowork-theme') === 'light') theme = 'light'; } catch { /* use the default */ }
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#faf9f7' : '#1c1d20');
})();
