// Liquid Glass lens for foreground controls (UI overhaul release 1; replaces the WebGL light
// field that lived in glass.js). Each `.glass-lens` element gets an SVG displacement filter
// sized to its own box and corner radius, so its backdrop refracts at the edges and stays
// clear in the middle. Technique adapted from nikdelvin/liquid-glass (c) 2025 Nikita Stadnik,
// MIT; see liquid-glass-LICENSE.txt.
//
// Only Chromium applies url() filters in backdrop-filter; everywhere else the CSS fallback
// (blur, tint, rim and specular edge in materials.css) is the whole effect. Nothing runs with
// reduced transparency or reduced motion, and nothing is drawn: no canvas, no animation loop.
(() => {
  const root = document.documentElement;
  const chromium = !!(navigator.userAgentData && navigator.userAgentData.brands && navigator.userAgentData.brands.some((b) => /Chromium/.test(b.brand)));
  const calm = matchMedia('(prefers-reduced-transparency: reduce), (prefers-reduced-motion: reduce), (prefers-contrast: more)');
  const cache = new Map();

  function map(w, h, r, depth) {
    const edge = (n, size) => Math.min(49, Math.ceil((n / size) * 15));
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><linearGradient id="y" x1="0" x2="0" y1="${edge(r, h)}%" y2="${100 - edge(r, h)}%"><stop offset="0" stop-color="#0F0"/><stop offset="1" stop-color="#000"/></linearGradient>` +
      `<linearGradient id="x" x1="${edge(r, w)}%" x2="${100 - edge(r, w)}%" y1="0" y2="0"><stop offset="0" stop-color="#F00"/><stop offset="1" stop-color="#000"/></linearGradient></defs>` +
      `<rect width="${w}" height="${h}" fill="#808080"/><g filter="blur(2px)"><rect width="${w}" height="${h}" fill="#000080"/>` +
      `<rect width="${w}" height="${h}" fill="url(#y)" style="mix-blend-mode:screen"/><rect width="${w}" height="${h}" fill="url(#x)" style="mix-blend-mode:screen"/>` +
      `<rect x="${depth}" y="${depth}" width="${Math.max(1, w - 2 * depth)}" height="${Math.max(1, h - 2 * depth)}" rx="${r}" fill="#808080" filter="blur(${depth}px)"/></g></svg>`);
  }

  /** A per-size filter: displacement with a slight per-channel split (chromatic aberration). */
  function filter(w, h, r) {
    const key = `${w}x${h}r${r}`;
    if (cache.has(key)) return cache.get(key);
    const depth = Math.max(3, Math.min(12, Math.round(Math.min(w, h) * 0.22)));
    // Gentle on small controls so text under a sliding thumb stays readable; the centre stays clear.
    const strength = Math.max(3, Math.min(10, Math.round(Math.min(w, h) * 0.18)));
    const channel = (scale, matrix, result) => `<feDisplacementMap in="SourceGraphic" in2="m" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/><feColorMatrix type="matrix" values="${matrix}" result="${result}"/>`;
    const url = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><filter id="lens" color-interpolation-filters="sRGB">` +
      `<feImage x="0" y="0" width="${w}" height="${h}" href="${map(w, h, r, depth)}" result="m"/>` +
      channel(strength + 2, '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', 'r') +
      channel(strength + 1, '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', 'g') +
      channel(strength, '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', 'b') +
      `<feBlend in="r" in2="g" mode="screen"/><feBlend in2="b" mode="screen"/></filter></svg>`) + '#lens")';
    if (cache.size > 64) cache.clear();
    cache.set(key, url);
    return url;
  }

  function fit(node) {
    if (!active()) return;
    const box = node.getBoundingClientRect();
    const w = Math.round(box.width), h = Math.round(box.height);
    if (!w || !h) return;
    const r = Math.min(Math.round(parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0), Math.floor(Math.min(w, h) / 2));
    node.style.setProperty('--lens', filter(w, h, r));
  }

  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
  const seen = new Set();
  function scan() {
    if (!active()) return;
    for (const node of seen) { if (!node.isConnected) { resize?.unobserve(node); seen.delete(node); } }
    document.querySelectorAll('.glass-lens').forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      fit(node);
      if (resize) resize.observe(node);
    });
  }
  function active() { return chromium && !calm.matches && root.getAttribute('data-motion') !== 'reduced' && root.getAttribute('data-family') === 'glass'; }
  function sync() {
    if (active()) { root.setAttribute('data-lens', 'svg'); scan(); } else { root.removeAttribute('data-lens'); resize?.disconnect(); seen.clear(); }
  }

  if (!chromium) return;
  sync();
  calm.addEventListener('change', sync);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-family', 'data-motion'] });
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; scan(); }); })
    .observe(document.body, { subtree: true, childList: true });
  if (typeof module !== 'undefined') module.exports = { filter, fit };
})();
