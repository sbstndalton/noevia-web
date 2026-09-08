import { useEffect, useRef } from 'react';

/** Native modality keeps Tab and assistive technology out of the workspace
 *  underneath, and supports nested pickers without hand-written focus traps. */
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return ref;
}
