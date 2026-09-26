import { useEffect, useRef } from 'react';

const FIELD_SELECTOR = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

/**
 * Which element inside an opened dialog should receive initial focus (#363): the one marked
 * `data-initial-focus`, or the first form field otherwise. Never the dialog's own Close button,
 * which is usually the first focusable element in the DOM and so what native `showModal()`
 * focuses by default when nothing else claims it. Kept pure (works against anything with
 * `querySelector`) so the selection logic is unit-testable without a real dialog.
 */
export function initialFocusTarget(dialog: { querySelector<T extends Element = Element>(selector: string): T | null } | null): HTMLElement | null {
  if (!dialog) return null;
  return (dialog.querySelector<HTMLElement>('[data-initial-focus]') ?? dialog.querySelector<HTMLElement>(FIELD_SELECTOR)) || null;
}

/** Native modality keeps Tab and assistive technology out of the workspace
 *  underneath, and supports nested pickers without hand-written focus traps.
 *  Initial focus goes through `initialFocusTarget` rather than whatever the browser
 *  focuses by default: React's `autoFocus` sets a DOM property, not the `autofocus`
 *  attribute, so native `showModal()` never sees it and falls through to the first
 *  focusable element — usually the dialog's own Close button. Callers that want a
 *  specific field focused should mark it `data-initial-focus` (or pass a ref and set
 *  the attribute themselves); a plain form field is picked up automatically. */
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    initialFocusTarget(dialog)?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return ref;
}
