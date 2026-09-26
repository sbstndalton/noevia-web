/** Cancelling a message edit (#355) must return focus to that message's own Edit trigger — but
 *  while editing, React has unmounted that trigger (the edit textarea replaces its whole row), so
 *  a call like `editTriggers.get(id)?.focus()` made synchronously from the cancel handler races:
 *  the trigger was deleted from the map the instant editing began, and only remounts (repopulating
 *  the map) on the *next* render, after the cancel handler already returned — too late for that
 *  call's `.focus()`, which silently no-ops on `undefined`.
 *
 *  The fix defers the focus call to a layout effect that runs after that remount has committed,
 *  keyed by which message id is waiting for its trigger back. These two functions are the pure
 *  half of that: no ref, no DOM, so the transition itself has a test independent of React. */

export interface EditFocusState {
  /** The message whose Edit trigger should receive focus once it exists again, or null once
   *  that focus call has been made (or there is nothing pending). */
  pendingFocusId: string | null;
}

/** Called synchronously when the reader cancels editing `id` (Escape, or the Cancel button). */
export function onCancelEdit(id: string): EditFocusState {
  return { pendingFocusId: id };
}

/** Called from the layout effect that runs after every render, with the current `editingId` and
 *  the pending state above. Returns the id whose trigger should be focused now, and the state to
 *  store afterwards. Focus fires only once `editingId` has actually returned to null — i.e. only
 *  after the render that remounted (and re-registered) that trigger — never on the same render
 *  that requested the cancel. */
export function focusAfterRender(editingId: string | null, state: EditFocusState): { focusId: string | null; next: EditFocusState } {
  if (state.pendingFocusId !== null && editingId === null) {
    return { focusId: state.pendingFocusId, next: { pendingFocusId: null } };
  }
  return { focusId: null, next: state };
}
