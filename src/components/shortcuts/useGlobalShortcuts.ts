import { useEffect, useRef } from 'react';
import { isApple, matchShortcut, type ShortcutId } from './shortcuts';

export const OPEN_SEARCH = 'noevia:open-search';

/** Listens once at the window; handlers are read from a ref so callers need not memoise them. */
export function useGlobalShortcuts(handlers: Record<ShortcutId, () => void>): boolean {
  const apple = typeof navigator !== 'undefined' && isApple(navigator.platform || navigator.userAgent);
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const id = matchShortcut(event, apple);
      if (!id) return;
      event.preventDefault();
      latest.current[id]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apple]);
  return apple;
}
