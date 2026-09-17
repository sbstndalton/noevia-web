// Layout mode. Runs before the app so the first paint is already the right shape.
//
// Every responsive rule in this app keys off the CSS viewport width (`max-width: 700px`
// and friends). The one lever that changes what those rules see is the viewport meta tag,
// so that is what this script drives — no parallel breakpoint system, no per-rule opt-out.
//
//   auto     follow the device (the default)
//   desktop  render the full-width layout on a phone or tablet, like a browser's
//            "Request desktop site". Sets a fixed viewport width, so `max-width: 700px`
//            stops matching and the page scales down to fit.
//   mobile   render the compact layout. On a phone that is simply `width=device-width`.
//            Desktop browsers ignore the viewport meta entirely, so there it falls back to
//            the `data-layout` attribute, which the shell and the model manager honour.
//
// Detection prefers UA Client Hints (`navigator.userAgentData.mobile`), which is a real
// signal rather than a string match, and falls back to the UA string plus a coarse pointer.
(() => {
  const root = document.documentElement;
  const KEY = 'cowork-layout-mode';
  const MODES = ['auto', 'mobile', 'desktop'];
  const FORCED_DESKTOP_WIDTH = 1100;
  const meta = document.querySelector('meta[name="viewport"]');
  const originalViewport = meta ? meta.getAttribute('content') : '';

  function detectDevice() {
    const hints = navigator.userAgentData;
    if (hints && typeof hints.mobile === 'boolean') return hints.mobile ? 'mobile' : 'desktop';
    const ua = navigator.userAgent || '';
    // iPadOS reports a Mac UA; a touch-capable "Mac" is an iPad.
    if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'mobile';
    if (/Android|Mobile|Silk|Kindle|Opera M(obi|ini)|IEMobile|Windows Phone/i.test(ua)) return 'mobile';
    // Neither hint nor string said mobile. A coarse-only pointer on a narrow screen still is.
    try {
      if (window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches
          && Math.min(screen.width, screen.height) <= 820) return 'mobile';
    } catch { /* matchMedia is optional here */ }
    return 'desktop';
  }

  function read() {
    try { const saved = localStorage.getItem(KEY); if (MODES.includes(saved)) return saved; } catch { /* default */ }
    return 'auto';
  }

  function apply(mode) {
    const device = detectDevice();
    const layout = mode === 'auto' ? device : mode;
    root.setAttribute('data-device', device);
    root.setAttribute('data-layout-mode', mode);
    root.setAttribute('data-layout', layout);
    if (!meta) return layout;
    // Only a device that honours the meta can be widened. Asking a desktop browser for a
    // 1100px viewport does nothing, and asking it for device-width would be a no-op too.
    if (layout === 'desktop' && device === 'mobile') {
      meta.setAttribute('content', `width=${FORCED_DESKTOP_WIDTH}, viewport-fit=cover, interactive-widget=resizes-content`);
    } else {
      meta.setAttribute('content', originalViewport);
    }
    return layout;
  }

  let mode = read();
  apply(mode);

  window.noeviaLayout = {
    modes: MODES.slice(),
    get: () => mode,
    device: () => root.getAttribute('data-device') || detectDevice(),
    set(next) {
      mode = MODES.includes(next) ? next : 'auto';
      try { localStorage.setItem(KEY, mode); } catch { /* preference stays for this tab only */ }
      const layout = apply(mode);
      window.dispatchEvent(new CustomEvent('noevia-layout-change', { detail: { mode, layout } }));
      return layout;
    },
  };
})();
