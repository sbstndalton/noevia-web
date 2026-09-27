import { useEffect } from 'react';
import { invalidateCached } from '../../request-cache';
import { WORKSPACE_KEY } from '../../api';

/** Chats or projects changed outside the chat views (for example an import from Settings → Data).
 *  Same convention as noevia:models-changed: a window event, because App owns the lists and the
 *  settings pages are not its children. */
export const WORKSPACE_CHANGED = 'noevia:workspace-changed';

export function notifyWorkspaceChanged(): void {
  // #459: every caller of this function just changed something `fetchWorkspace()`'s cached
  // `/api/workspace` response would otherwise keep serving stale — invalidate here, once, rather
  // than at every one of this function's call sites.
  invalidateCached(WORKSPACE_KEY);
  window.dispatchEvent(new Event(WORKSPACE_CHANGED));
}

export function useWorkspaceChanged(onChange: () => void): void {
  useEffect(() => {
    const handler = () => onChange();
    window.addEventListener(WORKSPACE_CHANGED, handler);
    return () => window.removeEventListener(WORKSPACE_CHANGED, handler);
  }, [onChange]);
}
