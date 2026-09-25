// Hover pull (#313): cards, buttons, sidebar rows and chips shift a few pixels toward the
// pointer when it arrives, then spring back when it leaves. It never tracks the pointer: the
// offset is set on enter and refreshed at most every PULL_MOVE_INTERVAL ms while the pointer
// stays inside, always under the same caps. One delegated behaviour for the whole app, not a
// per-component hook; an element opts out with data-pull="off".
//
// Translate only, no tilt: a ≤2° rotate without perspective is invisible, and a perspective()
// transform would replace each component's own `transform` (press scale). Motion uses the
// individual `translate` property through the Web Animations API,
// so it composes with every component's own `transform` (press scale, thumbs) and does not
// replace any CSS transition list. Timing is the #247 contract: --motion-quick / --ease-quick
// toward the pointer, --motion-considered / --ease-pull-return (a small spring) back home.
// Off on touch / coarse pointers, under prefers-reduced-motion, and with Settings → Motion
// set to reduced (html[data-motion='reduced']).

/** Largest translate toward the pointer, in px. */
export const PULL_MAX_SHIFT = 3;
/** Minimum gap between pointer-move refreshes (10 Hz). */
export const PULL_MOVE_INTERVAL = 100;

export const PULL_TARGETS = [
  '.project-card', '.btn', '.modal-btn', '.send-btn', '.composer-add', '.model-pill', '.reasoning-pill',
  '.new-chat-btn', '.shell-icon-button', '.app .sidebar.pane .nav-item', '.app .sidebar.pane .proj-row', '.app .sidebar.pane .chat-row',
  '.chip', '.tool-chip', '.project-chip', '.family-tile', '.btn-primary', '.btn-secondary', '[data-pull="on"]',
].join(', ');

/** Never pull text entry, segmented thumbs or anything inside them. */
const EXCLUDED = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .glass-seg, .composer-mode-toggle, .glass-switch, [data-pull="off"]';

export interface Pull { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100 || 0;

/**
 * Offset toward a pointer at (px, py) for an element box. Normalised to the box's half-size,
 * so the pull is the same at any element size; each axis capped at PULL_MAX_SHIFT px.
 */
export function pullFor(box: { left: number; top: number; width: number; height: number }, px: number, py: number): Pull {
  if (!(box.width > 0) || !(box.height > 0)) return { x: 0, y: 0 };
  const nx = clamp((px - (box.left + box.width / 2)) / (box.width / 2), -1, 1);
  const ny = clamp((py - (box.top + box.height / 2)) / (box.height / 2), -1, 1);
  return { x: round(nx * PULL_MAX_SHIFT), y: round(ny * PULL_MAX_SHIFT) };
}

export function pullKeyframe(p: Pull): Keyframe {
  return { translate: `${p.x}px ${p.y}px` } as Keyframe;
}

function ms(value: string, fallback: number) {
  const v = value.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}

/** Starts the delegated behaviour once; returns a stop function (tests, hot reload). */
export function startHoverPull(doc: Document = document, win: Window = window): () => void {
  const root = doc.documentElement;
  const fine = win.matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = () => fine.matches && !reduced.matches && root.getAttribute('data-motion') !== 'reduced';
  const running = new WeakMap<Element, Animation>();
  let active: HTMLElement | null = null;
  let lastMove = 0;

  const token = (name: string, fallback: string) => win.getComputedStyle(root).getPropertyValue(name).trim() || fallback;

  const play = (el: HTMLElement, frame: Keyframe, returning: boolean) => {
    const prev = running.get(el);
    if (prev) { try { prev.commitStyles(); } catch { /* not rendered */ } prev.cancel(); }
    if (typeof el.animate !== 'function') return;
    const duration = ms(token(returning ? '--motion-considered' : '--motion-quick', returning ? '260ms' : '160ms'), 180);
    const easing = token(returning ? '--ease-pull-return' : '--ease-quick', 'ease-out');
    let anim: Animation;
    try { anim = el.animate([frame], { duration, easing, fill: 'forwards' }); }
    catch { anim = el.animate([frame], { duration, easing: 'ease-out', fill: 'forwards' }); }
    running.set(el, anim);
    if (returning) anim.addEventListener('finish', () => {
      if (running.get(el) !== anim) return;
      anim.cancel(); running.delete(el);
      el.style.removeProperty('translate');
    });
  };

  /** Springs home, or — when motion was just turned off or the node is gone — stops at once. */
  const release = (el: HTMLElement | null, immediate = false) => {
    if (!el) return;
    el.removeAttribute('data-pulling');
    if (immediate || !el.isConnected || !enabled()) {
      const prev = running.get(el);
      if (prev) prev.cancel();
      running.delete(el);
      el.style.removeProperty('translate');
      return;
    }
    if (running.has(el) || el.style.getPropertyValue('translate')) play(el, pullKeyframe({ x: 0, y: 0 }), true);
  };

  const targetOf = (node: EventTarget | null): HTMLElement | null => {
    const el = node && typeof (node as Element).closest === 'function' ? (node as Element) : null;
    if (!el || el.closest(EXCLUDED)) return null;
    const hit = el.closest<HTMLElement>(PULL_TARGETS);
    if (!hit || hit.matches(':disabled') || hit.closest('[aria-disabled="true"], fieldset:disabled')) return null;
    return hit;
  };

  const pull = (el: HTMLElement, x: number, y: number) => {
    el.setAttribute('data-pulling', '');
    play(el, pullKeyframe(pullFor(el.getBoundingClientRect(), x, y)), false);
  };

  /** Drops a pulled node that left the document (a re-render) before handling the next event. */
  const prune = () => { if (active && !active.isConnected) { release(active, true); active = null; } };

  const onOver = (e: PointerEvent) => {
    prune();
    if (e.pointerType === 'touch' || !enabled()) { release(active); active = null; return; }
    const el = targetOf(e.target);
    if (el === active) return;
    release(active);
    active = el;
    lastMove = e.timeStamp;
    if (el) pull(el, e.clientX, e.clientY);
  };
  const onMove = (e: PointerEvent) => {
    prune();
    if (!active || e.pointerType === 'touch' || e.timeStamp - lastMove < PULL_MOVE_INTERVAL) return;
    if (!enabled() || !active.isConnected) { release(active); active = null; return; }
    lastMove = e.timeStamp;
    pull(active, e.clientX, e.clientY);
  };
  const onOut = (e: PointerEvent) => {
    prune();
    if (!active) return;
    const to = e.relatedTarget as Node | null;
    if (to && active.contains(to)) return;
    if (to && targetOf(to) === active) return;
    release(active); active = null;
  };
  const reset = () => { release(active); active = null; };
  // Motion switched off (OS or Settings) or the pointer became coarse: stop dead, no return.
  const halt = () => { release(active, true); active = null; };

  doc.addEventListener('pointerover', onOver, { passive: true });
  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerout', onOut, { passive: true });
  doc.addEventListener('pointerdown', reset, { passive: true });
  reduced.addEventListener?.('change', halt);
  fine.addEventListener?.('change', halt);
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(halt);
  observer?.observe(root, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    halt();
    doc.removeEventListener('pointerover', onOver); doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerout', onOut); doc.removeEventListener('pointerdown', reset);
    reduced.removeEventListener?.('change', halt); fine.removeEventListener?.('change', halt);
    observer?.disconnect();
  };
}
