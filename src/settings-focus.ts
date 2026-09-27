import { isFocusable } from './focus-utils';

type FocusCandidate = { isConnected: boolean; getClientRects(): ArrayLike<unknown>; closest?: (selectors: string) => unknown };

/** #401: Settings hands focus back to whatever opened it when it closes (Escape or the Close
 *  button — both tear the shell down the same way, so one effect covers both). `previous` is the
 *  opener captured before Settings mounted; a caller that unmounts its own trigger in the very
 *  update that opens Settings (the account menu's popover, which closes itself in the same click
 *  handler that opens Settings) leaves `previous` disconnected from the document by the time
 *  Settings closes. Focusing a disconnected element is a silent no-op, which is how focus was
 *  landing on `<body>` — so this falls through to `fallback` instead.
 *
 *  #401 reopened: `previous` can also still be connected but unfocusable — the narrow nav/detail
 *  layout collapses the sidebar drawer (`display: none`) the moment the account menu opens
 *  Settings, and that drawer does not reopen on its own when Settings closes, so the captured
 *  trigger sits inside it the whole time. `isConnected` alone said "still in the document, focus
 *  it" and `.focus()` on a `display:none`-ancestor element is a silent no-op — the exact same
 *  `<body>` symptom, just past a check that only covered "was this removed", not "is this
 *  visible". `isFocusable` (`focus-utils.ts`) covers both; `fallback` should itself already be
 *  the best available visible target (see `SettingsShell.tsx`'s cleanup) so this never needs to
 *  choose between more than two. */
export function closeFocusTarget<T extends FocusCandidate>(previous: T | null, fallback: T | null): T | null {
  if (isFocusable(previous)) return previous;
  return fallback;
}
