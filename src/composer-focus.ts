/** Whether the primary pointer on this device is coarse (touch) rather than fine (mouse/trackpad)
 *  — the same signal `phone.css`'s own `@media (pointer: coarse)` rules gate on, plus `(hover:
 *  none)` for the touch devices phone.css also targets that way (see e.g. `noevia.css`'s
 *  `@media (hover: none)` rules). Exported as a pure function of `window` (rather than read
 *  inline) so #435's focus recovery — which must never *programmatically* focus the composer
 *  textarea on such a device, since that pops the on-screen keyboard over whatever the person is
 *  reading — has something independent of React to test. */
export function isCoarsePointerDevice(win: { matchMedia?: (query: string) => { matches: boolean } } | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win || typeof win.matchMedia !== 'function') return false;
  return win.matchMedia('(pointer: coarse)').matches || win.matchMedia('(hover: none)').matches;
}
