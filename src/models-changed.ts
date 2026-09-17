import { useEffect } from 'react';

/** The model list changed on the server: something was downloaded, registered,
 *  renamed, deleted, loaded or unloaded.
 *
 *  A window event rather than a callback prop because the views that show models
 *  are not each other's children — App owns the chat's list, LibraryTab and
 *  ModelPopup own their own — and because settings tabs mount per selection, so
 *  a mount-time fetch only refreshes on remount. That is the whole reason a
 *  freshly downloaded model appeared "after a while": nothing asked again.
 *
 *  Follows the existing `noevia:open-model-settings` convention. `noevia:` is
 *  the prefix for anything new; `cowork` identifiers are frozen compatibility
 *  contracts (see AGENTS.md). */
export const MODELS_CHANGED = 'noevia:models-changed';

export function notifyModelsChanged(): void {
  window.dispatchEvent(new Event(MODELS_CHANGED));
}

/** Re-run `handler` whenever the model list changes. `handler` is read through a
 *  ref-free dependency on purpose: pass a stable callback, or accept that a new
 *  identity re-subscribes, which is cheap. */
export function useModelsChanged(handler: () => void): void {
  useEffect(() => {
    window.addEventListener(MODELS_CHANGED, handler);
    return () => window.removeEventListener(MODELS_CHANGED, handler);
  }, [handler]);
}
