// Follow the visible viewport when a mobile keyboard opens. Pinch zoom keeps the
// layout stable: it must not trigger a resize/reflow that fights magnification.
(() => {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;
  function update() {
    frame = 0;
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = Math.round(viewport ? viewport.height : window.innerHeight);
    if (height <= 0) return;
    root.style.setProperty('--visible-viewport-height', `${height}px`);
    root.toggleAttribute('data-short-viewport', height <= 550);
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  viewport?.addEventListener('resize', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  update();
})();
