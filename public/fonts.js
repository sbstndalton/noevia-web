// Web fonts load after first paint instead of blocking it: a stylesheet added from script is
// not render-blocking, and text shows in each family's system fallback until the face arrives
// (display=swap). Inline onload is barred by the CSP.
//
// Only the active theme family's faces load (#249); switching family, or opening the live
// previews in Settings → Appearance (event `noevia:preview-fonts`), loads the others once.
(() => {
  const FAMILY_FONTS = {
    editorial: 'family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600',
    contemporary: 'family=Geist:wght@400;500;600;700',
    glass: 'family=Manrope:wght@400;500;600;700&family=Sora:wght@400;500;600',
  };
  const MONO = 'family=JetBrains+Mono:wght@400;500;600';
  const loaded = new Set();
  function load(family) {
    const query = FAMILY_FONTS[family];
    if (!query || loaded.has(family)) return;
    loaded.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + query + (loaded.size === 1 ? '&' + MONO : '') + '&display=swap';
    link.dataset.family = family;
    document.head.appendChild(link);
  }
  const root = document.documentElement;
  const current = () => root.getAttribute('data-family') || 'editorial';
  load(current());
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => load(current())).observe(root, { attributes: true, attributeFilter: ['data-family'] });
  addEventListener('noevia:preview-fonts', () => Object.keys(FAMILY_FONTS).forEach(load));
  if (typeof module !== 'undefined') module.exports = { FAMILY_FONTS, load };
})();
