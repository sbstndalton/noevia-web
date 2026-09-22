// Pointer-following glint for glass controls (docs/spec-ui-direction.md, Study 03). The CSS in
// noevia.css reads --glass-x/--glass-y and an opposing reflection; this script only sets them on
// the control under a precise pointer. Nothing runs on touch or with reduced motion.
(() => {
  const SURFACES = '.glass:not(.glass-thumb):not(.knob)';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more)');
  const coarse = matchMedia('(pointer: coarse)');
  let frame = 0, pending = null, active = null;

  const release = (node) => { if (node) node.removeAttribute('data-glass-active'); };

  const enabled = () => root.getAttribute('data-material') === 'liquid' && root.getAttribute('data-motion') !== 'reduced' && !reduced.matches && !coarse.matches;
  const reset = () => { release(active); active = null; };
  new MutationObserver(reset).observe(root, { attributes: true, attributeFilter: ['data-material', 'data-motion'] });
  reduced.addEventListener('change', reset);
  coarse.addEventListener('change', reset);

  document.addEventListener('pointermove', (event) => {
    if (!enabled() || event.pointerType === 'touch') { reset(); return; }
    const surface = event.target && typeof event.target.closest === 'function' ? event.target.closest(SURFACES) : null;
    if (surface !== active) { release(active); active = surface; }
    if (!surface) return;
    pending = { surface, x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      const { surface: node, x, y } = pending;
      // The pointer may have left while this frame was queued.
      if (!enabled() || !node.isConnected || node !== active) return;
      const rect = node.getBoundingClientRect();
      const px = Math.round(x - rect.left), py = Math.round(y - rect.top);
      if (getComputedStyle(node).position === 'static') node.classList.add('glass-positioned');
      node.classList.add('glass-reactive');
      node.style.setProperty('--glass-x', `${px}px`);
      node.style.setProperty('--glass-y', `${py}px`);
      node.style.setProperty('--glass-opposite-x', `${Math.round(rect.width - px)}px`);
      node.style.setProperty('--glass-opposite-y', `${Math.round(rect.height - py)}px`);
      node.setAttribute('data-glass-active', '');
    });
  }, { passive: true });

  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) { release(event.target && event.target.closest ? event.target.closest(SURFACES) : null); active = null; }
  }, { passive: true });
})();
