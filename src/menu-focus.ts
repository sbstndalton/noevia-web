/** Whether choosing a `ContextMenu` item should return focus to the trigger. `false` when the
 *  action itself already moved focus somewhere that wants to keep it: an input/textarea/select
 *  (rename opens one) or anything inside an open `<dialog>` (a confirm prompt). The Escape path
 *  already refocuses the trigger unconditionally — Escape never opens anything new, so there is
 *  nothing else that could want focus. */
export function shouldRefocusTrigger(active: Element | null, body: Element | null): boolean {
  if (!active || active === body) return true;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (active.closest?.('dialog')) return false;
  return true;
}
