// The motion layer (#951), on Motion's vanilla API (motion.dev, MIT). Framework-neutral on
// purpose: it is driven by the DOM (classes, data-attributes, ARIA state) through one observer,
// and the only calls a UI framework makes are enter(el, kind) / exit(el, kind), which return
// promises so an exit can finish before the element is removed. See README.md.
//
// Springs carry velocity when retargeted, so every animation is interruptible: an exit started
// mid-enter continues from the current value (no keyframe "from" on exits). Only transform and
// opacity animate, plus width on the sidebar tile. Reduced motion (the OS setting or
// data-motion="reduced") turns springs into instant changes or short fades.
import { animate } from 'motion';

export type MotionKind = 'dialog' | 'menu' | 'toast' | 'message' | 'chip' | 'list' | 'fade';
type Target = Record<string, number | string | Array<number | string>>;
type Options = Record<string, unknown>;

/** Critically damped by default (Apple's damping 1.0); bounce only on small physical controls. */
const SPRINGS = {
  dialog: { type: 'spring', bounce: 0, visualDuration: 0.22 },
  menu: { type: 'spring', bounce: 0, visualDuration: 0.14 },
  toast: { type: 'spring', bounce: 0, visualDuration: 0.26 },
  message: { type: 'spring', bounce: 0.25, visualDuration: 0.32 },
  chip: { type: 'spring', bounce: 0.15, visualDuration: 0.22 },
  list: { type: 'spring', bounce: 0, visualDuration: 0.22 },
  fade: { type: 'spring', bounce: 0, visualDuration: 0.15 },
  knob: { type: 'spring', bounce: 0.3, visualDuration: 0.16 },
  press: { type: 'spring', bounce: 0, visualDuration: 0.1 },
  release: { type: 'spring', bounce: 0.35, visualDuration: 0.22 },
  tile: { type: 'spring', bounce: 0, visualDuration: 0.24 },
} as const;

export function reducedMotion(): boolean {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root?.getAttribute('data-motion') === 'reduced') return true;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

const ENTER: Record<MotionKind, { from: Target; to: Target }> = {
  dialog: { from: { opacity: 0, scale: 0.98 }, to: { opacity: 1, scale: 1 } },
  menu: { from: { opacity: 0, scale: 0.97 }, to: { opacity: 1, scale: 1 } },
  // The toast is centred with translateX(-50%); Motion owns the transform, so it keeps x.
  toast: { from: { opacity: 0, x: '-50%', y: 12 }, to: { opacity: 1, x: '-50%', y: 0 } },
  message: { from: { opacity: 0, scale: 0.92, y: 6 }, to: { opacity: 1, scale: 1, y: 0 } },
  chip: { from: { opacity: 0, scale: 0.8 }, to: { opacity: 1, scale: 1 } },
  list: { from: { opacity: 0 }, to: { opacity: 1 } },
  fade: { from: { opacity: 0 }, to: { opacity: 1 } },
};
const EXIT: Record<MotionKind, Target> = {
  dialog: { opacity: 0, scale: 0.98 },
  menu: { opacity: 0, scale: 0.97 },
  toast: { opacity: 0, x: '-50%', y: 12 },
  message: { opacity: 0 },
  chip: { opacity: 0, scale: 0.8 },
  list: { opacity: 0 },
  fade: { opacity: 0 },
};

/** Hands the element back to CSS once a spring has come to rest at its natural state, so no
 *  inline transform or opacity is left to block later CSS transforms (hover, :active, layout).
 *  Skipped if another spring has started on the element since. */
const generation = new WeakMap<Element, number>();
function settle(el: Element, mine: number): void {
  if (generation.get(el) !== mine) return;
  const style = (el as HTMLElement).style;
  style.removeProperty('transform'); style.removeProperty('opacity');
}

function run(el: Element, target: Target, options: Options): Promise<void> {
  generation.set(el, (generation.get(el) ?? 0) + 1);
  const controls = animate(el as HTMLElement, target as never, options as never);
  return Promise.resolve(controls.finished).then(() => undefined, () => undefined);
}

/** Plays an element in. Resolves when it has settled. */
export function enter(el: Element | null | undefined, kind: MotionKind, delay = 0): Promise<void> {
  if (!el) return Promise.resolve();
  const { from, to } = ENTER[kind];
  if (reducedMotion()) {
    // No spring: a short opacity fade for dialogs and toasts, nothing for the rest.
    if (kind === 'dialog' || kind === 'toast') return run(el, { opacity: [0, 1] }, { duration: 0.12, ease: 'linear' });
    return Promise.resolve();
  }
  const keyframes: Target = {};
  for (const key of Object.keys(to)) keyframes[key] = from[key] === to[key] ? to[key] : [from[key] as number, to[key] as number];
  const mine = (generation.get(el) ?? 0) + 1;
  return run(el, keyframes, { ...SPRINGS[kind], delay }).then(() => settle(el, mine));
}

/** Plays an element out from wherever it is now (interrupting an enter). Resolve, then remove. */
export function exit(el: Element | null | undefined, kind: MotionKind): Promise<void> {
  if (!el) return Promise.resolve();
  if (reducedMotion()) return kind === 'dialog' || kind === 'toast' ? run(el, { opacity: 0 }, { duration: 0.1, ease: 'linear' }) : Promise.resolve();
  return run(el, EXIT[kind], SPRINGS[kind]);
}

/** A list row appearing: fade plus height, then hand height back to layout. */
export function growIn(el: HTMLElement): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const height = el.getBoundingClientRect().height;
  if (!height) return Promise.resolve();
  el.style.overflow = 'hidden';
  return run(el, { height: [0, height], opacity: [0, 1] }, SPRINGS.list).then(() => { el.style.height = ''; el.style.overflow = ''; });
}

// ── The DOM-driven layer ─────────────────────────────────────────────────────
const MENUS = '.ctx-menu, .account-popover, .popup, .composer-actions-panel, .tool-catalogue-panel, .chat-link-menu, [role="menu"]';
const DIALOGS = 'dialog[open], .aero, [data-motion="dialog"]';
const TOASTS = '.save-error, [data-motion="toast"]';
const CHIPS = '.reply-source-chip, .composer-context-chips > *, .frame-chips > *';
const ROWS = '.app .sidebar .chat-row, .app .sidebar .proj-row';
const PRESS = '.btn, .modal-btn, .popup-tab, .send-btn, .glass.is-press, .new-chat-btn, [data-motion="press"]';
const SIDEBAR = '.app .sidebar.pane:not(.coding-sidebar)';

/** Menus scale from the trigger side: top when they open below it, bottom when above. */
function menuOrigin(menu: HTMLElement): void {
  const trigger = document.querySelector<HTMLElement>('[aria-expanded="true"]');
  if (!trigger) return;
  const t = trigger.getBoundingClientRect(), m = menu.getBoundingClientRect();
  const y = t.top + t.height / 2 < m.top + m.height / 2 ? 'top' : 'bottom';
  const x = Math.abs(t.left - m.left) <= Math.abs(t.right - m.right) ? 'left' : 'right';
  menu.style.transformOrigin = `${y} ${x}`;
}

function hasCssAnimation(el: Element): boolean {
  return el.getAnimations?.().some((a) => !(a as unknown as { id?: string }).id?.startsWith('motion')) ?? false;
}

function onAdded(nodes: HTMLElement[]): void {
  const messages = nodes.filter((n) => n.matches('.msg[data-role="user"]'));
  // One new user message (not a transcript loading in) grows out of the composer side.
  if (messages.length === 1 && nodes.filter((n) => n.matches('.msg')).length === 1) {
    const msg = messages[0];
    if (!msg.nextElementSibling) { msg.style.transformOrigin = 'right bottom'; void enter(msg, 'message'); }
  }
  let chipIndex = 0;
  for (const node of nodes) {
    if (node.matches(MENUS)) { menuOrigin(node); void enter(node, 'menu'); continue; }
    if (node.matches(TOASTS)) { void enter(node, 'toast'); continue; }
    if (node.matches(DIALOGS) && !node.matches('.settings-stage') && !hasCssAnimation(node)) { void enter(node, 'dialog'); continue; }
    if (node.matches(CHIPS)) { void enter(node, 'chip', 0.05 + 0.03 * Math.min(chipIndex++, 7)); continue; }
  }
  const rows = nodes.filter((n) => n.matches(ROWS));
  if (rows.length === 1) void growIn(rows[0]);
}

const settling = new WeakMap<Element, string>();
/** The sidebar tile springs between its expanded and rail widths. The old width is measured by
 *  briefly restoring the previous class (one forced layout on a click), so it is right even the
 *  first time and mid-animation. Only a change that moves is-collapsed counts. */
function onSidebarClass(el: HTMLElement, oldClass: string | null): void {
  if (oldClass === null || /\bis-collapsed\b/.test(oldClass) === el.classList.contains('is-collapsed')) return;
  if (reducedMotion() || innerWidth < 520) { el.style.width = ''; el.style.minWidth = ''; return; }
  const current = el.getBoundingClientRect().width; // inline width if a spring is running
  const now = el.className;
  el.style.width = ''; el.style.minWidth = '';
  const after = el.getBoundingClientRect().width;
  const before = settling.has(el) ? current : (() => { el.className = oldClass; const w = el.getBoundingClientRect().width; el.className = now; return w; })();
  if (Math.abs(before - after) < 1) return;
  const token = `${after}`;
  settling.set(el, token);
  const low = `${Math.min(before, after)}px`;
  el.style.width = `${before}px`; el.style.minWidth = low;
  void run(el, { width: [`${before}px`, `${after}px`] }, SPRINGS.tile)
    .then(() => { if (settling.get(el) === token) { settling.delete(el); el.style.width = ''; el.style.minWidth = ''; } });
}

function onSwitch(el: HTMLElement): void {
  const knob = el.querySelector<HTMLElement>('.knob');
  if (!knob) return;
  const x = el.getAttribute('aria-checked') === 'true' ? 16 : 0;
  if (reducedMotion()) { knob.style.transform = `translateX(${x}px)`; return; }
  // CSS has already moved the knob to its new rest, so the first spring names where it came
  // from; a toggle during a running spring retargets from the current value instead.
  const from = knobsMoving.has(knob) ? null : 16 - x;
  knobsMoving.add(knob);
  const mine = (generation.get(knob) ?? 0) + 1;
  void run(knob, { x: from === null ? x : [from, x] }, SPRINGS.knob).then(() => { knobsMoving.delete(knob); settle(knob, mine); });
}
const knobsMoving = new WeakSet<Element>();

function collect(node: Node, out: HTMLElement[]): void {
  if (!(node instanceof HTMLElement)) return;
  out.push(node);
  // Messages, chips and rows can arrive inside a wrapper; the menus and dialogs are roots.
  for (const child of node.querySelectorAll<HTMLElement>(`${MENUS}, ${TOASTS}, ${CHIPS}, ${ROWS}, .msg`)) out.push(child);
}

let started = false;
/** Starts the DOM-driven layer once. Safe to call from any framework. */
export function startMotion(root: Document = document): void {
  if (started || typeof MutationObserver === 'undefined') return;
  started = true;
  const observer = new MutationObserver((records) => {
    const added: HTMLElement[] = [];
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach((n) => collect(n, added));
      else if (r.target instanceof HTMLElement) {
        if (r.attributeName === 'class' && r.target.matches(SIDEBAR)) onSidebarClass(r.target, r.oldValue);
        if (r.attributeName === 'aria-checked' && r.target.matches('.glass-switch')) onSwitch(r.target);
      }
    }
    if (added.length) onAdded([...new Set(added)]);
  });
  observer.observe(root.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'aria-checked'] });
  // Press: a spring to .97 while held, released with a light settle. Pointer only; keyboard
  // activation stays instant.
  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as Element | null)?.closest?.(PRESS) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled || reducedMotion()) return;
    void run(el, { scale: 0.97 }, SPRINGS.press);
    const release = () => { const mine = (generation.get(el) ?? 0) + 1; void run(el, { scale: 1 }, SPRINGS.release).then(() => settle(el, mine)); el.removeEventListener('pointerup', release); el.removeEventListener('pointerleave', release); el.removeEventListener('pointercancel', release); };
    el.addEventListener('pointerup', release); el.addEventListener('pointerleave', release); el.addEventListener('pointercancel', release);
  }, { passive: true });
  // Exposed for other frameworks and for the browser QA (qa/ui-redo-951.cjs).
  (window as unknown as { noeviaMotion?: unknown }).noeviaMotion = { enter, exit, growIn, reducedMotion };
}
