// Pointer-following glint for glass controls (docs/spec-ui-direction.md, Study 03). The CSS in
// noevia.css reads --glass-x/--glass-y and an opposing reflection; this script only sets them on
// the control under a precise pointer. Nothing runs on touch or with reduced motion.
(() => {
  const SURFACES = '.glass, .app-mode-switch, .btn-secondary, .modal-btn.secondary, .popup-tab, .settings-navigation nav button, .theme-choice button, .palette-option, select';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  let frame = 0, pending = null, active = null;

  const release = (node) => { if (node) node.removeAttribute('data-glass-active'); };

  document.addEventListener('pointermove', (event) => {
    if (reduced.matches || coarse.matches || event.pointerType === 'touch') return;
    const surface = event.target && typeof event.target.closest === 'function' ? event.target.closest(SURFACES) : null;
    if (surface !== active) { release(active); active = surface; }
    if (!surface) return;
    pending = { surface, x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      const { surface: node, x, y } = pending;
      // The pointer may have left while this frame was queued.
      if (!node.isConnected || node !== active) return;
      const rect = node.getBoundingClientRect();
      const px = Math.round(x - rect.left), py = Math.round(y - rect.top);
      if (getComputedStyle(node).position === 'static') node.classList.add('glass-positioned');
      node.classList.add('glass-reactive');
      node.style.setProperty('--glass-x', `${px}px`);
      node.style.setProperty('--glass-y', `${py}px`);
      node.style.setProperty('--glass-opposite-x', `${Math.round(rect.width - px)}px`);
      node.style.setProperty('--glass-opposite-y', `${Math.round(rect.height - py)}px`);
      // Liquid glass buttons lean up to 4 degrees toward the pointer (nikdelvin/liquid-glass).
      node.style.setProperty('--tilt-x', ((px / rect.width - .5) * 8).toFixed(2));
      node.style.setProperty('--tilt-y', ((.5 - py / rect.height) * 8).toFixed(2));
      node.setAttribute('data-glass-active', '');
    });
  }, { passive: true });

  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) { release(event.target && event.target.closest ? event.target.closest(SURFACES) : null); active = null; }
  }, { passive: true });
})();
