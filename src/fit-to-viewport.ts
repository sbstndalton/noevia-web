// Shrink-to-fit (user review, 2026-09-19): when a page, pane or menu is only slightly taller
// than the space it has, scale its content down just enough to fit instead of making you
// scroll for a last line. Content that is genuinely long (a chat list, a transcript) is left
// to scroll: fitting only applies while the overflow is small, and never below MIN.
const MIN = 0.82;
// And the reverse on phones and tablets (user review, 2026-09-19): a page much shorter than a
// tall screen grows, up to MAX, so a zoomed-out phone uses its height instead of leaving a
// band of nothing. Desktop browsers keep the size the user zoomed to.
const MAX = 1.25;
// Scroll areas that hold pages, panes and menus. Transcripts, editors and code blocks are not
// listed: their text must stay at the reader's size.
const AREAS = [
  '.app .sidebar.pane', '.coding-content', '.settings-detail-scroll', '.settings-stage .settings-navigation nav',
  '.plugins-view', '.feature-preview', '.projects-workspace', '.project-scroll', '.project-main', '.model-manager-page',
  '.edit-project-body', '.ctx-menu', '[role="menu"]', '.account-popover', '.composer-actions-panel', '.noevia-inspector',
  '.chat-workspace.is-empty > .transcript', '.diary-context', '.auth-screen',
].join(', ');

const fitted = new WeakMap<HTMLElement, HTMLElement[]>();

function clear(area: HTMLElement): void {
  for (const child of fitted.get(area) ?? []) child.style.removeProperty('zoom');
  fitted.delete(area);
}

function fit(area: HTMLElement): void {
  clear(area);
  if (!area.isConnected || !area.clientHeight) return;
  const overflow = () => area.scrollHeight - area.clientHeight;
  const s = getComputedStyle(area);
  const pad = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
  if (overflow() <= 1) { grow(area, pad); return; }
  const ratio = (area.clientHeight - pad) / (area.scrollHeight - pad);
  if (!(ratio >= MIN)) return;
  const children = [...area.children].filter((c): c is HTMLElement => c instanceof HTMLElement && getComputedStyle(c).position !== 'fixed');
  if (!children.length) return;
  let f = Math.floor(ratio * 1000) / 1000;
  for (let pass = 0; pass < 3 && f >= MIN; pass++) {
    for (const c of children) c.style.zoom = String(f);
    fitted.set(area, children);
    const left = overflow();
    if (left <= 1) return;
    f = Math.floor(f * ((area.clientHeight - pad) / (area.scrollHeight - pad)) * 1000) / 1000 - 0.002;
  }
  clear(area);
}

function grow(area: HTMLElement, pad: number): void {
  if (document.documentElement.dataset.device === 'desktop' || area.matches('.sidebar, .ctx-menu, [role="menu"], .account-popover, .composer-actions-panel')) return;
  const children = [...area.children].filter((c): c is HTMLElement => c instanceof HTMLElement && getComputedStyle(c).position !== 'fixed' && getComputedStyle(c).position !== 'sticky');
  if (!children.length) return;
  const rects = children.map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
  if (!rects.length) return;
  const content = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top));
  const free = area.clientHeight - pad;
  if (!(content > 0) || free / content < 1.15) return;
  let f = Math.min(MAX, Math.floor((free / content) * 0.97 * 100) / 100);
  fitted.set(area, children);
  while (f > 1.02) {
    for (const c of children) c.style.zoom = String(f);
    if (area.scrollHeight - area.clientHeight <= 1 && area.scrollWidth - area.clientWidth <= 1) return;
    f = Math.round((f - 0.04) * 100) / 100;
  }
  clear(area);
}

let frame = 0;
function fitAll(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    for (const area of document.querySelectorAll<HTMLElement>(AREAS)) fit(area);
  });
}

export function startFitToViewport(): void {
  if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined' || !CSS.supports('zoom', '0.9')) return;
  const resize = new ResizeObserver(fitAll);
  resize.observe(document.documentElement);
  window.visualViewport?.addEventListener('resize', fitAll);
  // viewport.js announces each settled size, including the one after a zoom finishes.
  window.addEventListener('noevia:viewport', fitAll);
  window.addEventListener('resize', fitAll);
  window.addEventListener('orientationchange', () => setTimeout(fitAll, 300));
  // Content changes (a page opens, a section expands, fonts load). Our own zoom writes are
  // style changes, which are ignored, so fitting never feeds itself.
  new MutationObserver((records) => {
    if (records.every((r) => r.type === 'attributes' && r.attributeName === 'style')) return;
    fitAll();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'open', 'aria-expanded', 'data-view', 'style'] });
  void document.fonts?.ready.then(fitAll);
  fitAll();
}
