// #1814 / #1857: the outcome of an explicit "Refresh models" press as a passing note, shared by the model popup
// and Settings → Models → Routing. idle -> busy -> updated | wait | empty | failed -> (5 s) idle. Clearing it also
// lets a repeat of the same outcome be announced again (busy -> same text is a fresh live-region change).
import { useEffect, useState } from 'react';
import { useT } from '../i18n';

export type RefreshState = 'idle' | 'busy' | 'updated' | 'wait' | 'empty' | 'failed';
const NOTE_KEY = { updated: 'modelPopup.refreshUpdated', wait: 'modelPopup.refreshWait', empty: 'modelPopup.refreshEmpty', failed: 'modelPopup.refreshFailed' } as const;
export const REFRESH_NOTE_MS = 5000;

/** The state, its setter, and the note text for the current state ('' while idle or busy). */
export function useRefreshNote(): [RefreshState, (s: RefreshState) => void, string] {
  const t = useT();
  const [state, setState] = useState<RefreshState>('idle');
  useEffect(() => {
    if (state === 'idle' || state === 'busy') return;
    const id = setTimeout(() => setState('idle'), REFRESH_NOTE_MS);
    return () => clearTimeout(id);
  }, [state]);
  return [state, setState, state === 'idle' || state === 'busy' ? '' : t(NOTE_KEY[state])];
}

/** What a refresh answer means: throttled (wait), nothing listed (empty: keep the old list) or a new list (updated). */
export function refreshOutcome(r: { models: string[]; throttled?: boolean }): 'wait' | 'empty' | 'updated' {
  return r.throttled ? 'wait' : r.models.length ? 'updated' : 'empty';
}
