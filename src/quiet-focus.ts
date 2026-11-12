/** #2486: a heading the app focuses on a route change (so a screen reader announces where it landed) draws no ring unless the
 *  keyboard was the last input; a click, a tap or a direct load is not the person's own focus. A key press on the heading, or
 *  leaving it, brings the ordinary ring back. The CSS side is `[data-quiet-focus]:focus-visible` in shell-v2.css (as for the
 *  Settings panel, #2401). */
let keyboardLast = false;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => { keyboardLast = true; }, true);
  document.addEventListener('pointerdown', () => { keyboardLast = false; }, true);
}

export function focusHeading(el: HTMLElement | null | undefined): void {
  if (!el) return;
  if (!keyboardLast) {
    el.dataset.quietFocus = '';
    const loud = () => { delete el.dataset.quietFocus; el.removeEventListener('keydown', loud); el.removeEventListener('blur', loud); };
    el.addEventListener('keydown', loud);
    el.addEventListener('blur', loud);
  }
  el.focus();
}
