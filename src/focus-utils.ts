/** Shared "is this really focusable right now" check, and a way to defer a focus-return
 *  decision until the layout it depends on has settled.
 *
 *  #401 (reopened): a fallback that only checks `Node.isConnected` treats a control sitting
 *  inside a `display:none` ancestor (a collapsed nav drawer, a hidden tab panel) as usable —
 *  it is still "in the document" — but `.focus()` on an element with no layout box is a silent
 *  no-op, so focus falls through to `<body>` anyway. Measured against a real headless Chrome
 *  (see `tests/client/settings-focus-return.test.cjs`) rather than assumed:
 *  - `display:none` (on the element or an ancestor) reports zero `getClientRects()` — caught below.
 *  - `visibility:hidden` (on the element or an inherited from an ancestor) still reports a
 *    non-empty `getClientRects()` and a `tabIndex` of `0`, so neither of those catches it;
 *    `Element.checkVisibility({ visibilityProperty: true })` does, and correctly reports `true`
 *    again for a descendant that overrides back to `visibility: visible`.
 *  - `disabled` reports `tabIndex === 0` in this engine (not `-1` as some guidance claims) — a
 *    dedicated `.disabled` check is the only thing that catches it.
 *  - `inert` reports a normal `tabIndex` and passes `checkVisibility`; only walking `closest`
 *    for `[inert]` catches it.
 *  - a plain, non-interactive element (a `<h1>` with no `tabindex`) reports `tabIndex === -1`
 *    with everything else looking focusable — `.focus()` on it is a silent no-op. `tabIndex < 0`
 *    catches it without rejecting the disabled/inert/hidden cases above twice, and without
 *    rejecting an intentionally-focusable `tabindex="-1"` target this module never hands out
 *    (none of `settings-focus.ts`'s fallback candidates use one).
 *  Every check is skipped, not assumed true or false, when the candidate does not support it
 *  (the plain objects `settings-focus-return.test.cjs` builds have no `checkVisibility` or
 *  `tabIndex` at all — there is no jsdom in this repo — so only the two checks that do not
 *  need a real layout engine apply to them). */
export function isFocusable<
  T extends {
    isConnected: boolean;
    getClientRects(): ArrayLike<unknown>;
    closest?: (selectors: string) => unknown;
    checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean;
    disabled?: boolean;
    tabIndex?: number;
  },
>(el: T | null | undefined): el is T {
  if (!el || !el.isConnected) return false;
  if (el.getClientRects().length === 0) return false;
  if (el.disabled) return false;
  if (typeof el.closest === 'function' && el.closest('[inert]')) return false;
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) return false;
  if (typeof el.tabIndex === 'number' && el.tabIndex < 0) return false;
  return true;
}

/** Returns the first candidate `isFocusable` accepts, or `null` if none are. Callers list
 *  candidates from most to least specific (e.g. the control that opened a panel, then a
 *  reasonable landmark, then a control guaranteed to exist in the view). */
export function pickFocusable<
  T extends {
    isConnected: boolean;
    getClientRects(): ArrayLike<unknown>;
    closest?: (selectors: string) => unknown;
    checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean;
    disabled?: boolean;
    tabIndex?: number;
  },
>(...candidates: Array<T | null | undefined>): T | null {
  for (const candidate of candidates) {
    if (isFocusable(candidate)) return candidate;
  }
  return null;
}

/** Runs `check` once the layout from the commit that is currently unmounting/closing has had a
 *  chance to settle — a frame after paint, so a class toggled in that same commit (a drawer
 *  collapsing, a panel's exit animation finishing) has taken visual effect before `check` reads
 *  `getClientRects()`. A hidden background tab never fires `requestAnimationFrame` — a known
 *  tester artifact, and a real one for anyone who closes a panel via a keyboard shortcut fired
 *  from a tab that lost visibility — so a short timer runs the same check as a fallback;
 *  whichever fires first wins and the other is a no-op. Returns a canceller. */
export function afterLayoutSettles(check: () => void, timeoutMs = 100): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    check();
  };
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fire) : 0;
  const timer = setTimeout(fire, timeoutMs);
  return () => {
    done = true;
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    clearTimeout(timer);
  };
}
