/** Where you were when you closed the tab (user review of `ab2720a`, 2026-09-18).
 *  Reloading used to drop you on a brand new chat, which loses the thing you were
 *  reading. Per device, like the other `noevia:` preferences — appearance follows
 *  the account, placement does not.
 *
 *  The stored account id is a guard, not a permission: the server scopes every
 *  chat and project read by the session, so a restored id belonging to someone
 *  else simply does not load. It exists so a second account on the same browser
 *  starts on its own fresh chat rather than on a dead reference. */

const KEY = 'noevia:last-view';

export type StoredView =
  | { kind: 'diary' }
  | { kind: 'projects' }
  | { kind: 'models'; model?: string }
  | { kind: 'project'; id: string }
  | { kind: 'chat'; chatId: string; projectId?: string | null };

export type LastPlace = { user: string | null; view: StoredView; settings: string | null };

/** `preview` is deliberately absent: an unbuilt surface is never somewhere to return to. */
function parseView(value: unknown): StoredView | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'diary' || v.kind === 'projects') return { kind: v.kind };
  if (v.kind === 'models') return typeof v.model === 'string' ? { kind: 'models', model: v.model } : { kind: 'models' };
  if (v.kind === 'project' && typeof v.id === 'string' && v.id) return { kind: 'project', id: v.id };
  if (v.kind === 'chat' && typeof v.chatId === 'string' && v.chatId) {
    return { kind: 'chat', chatId: v.chatId, projectId: typeof v.projectId === 'string' ? v.projectId : null };
  }
  return null;
}

export function readLastPlace(): LastPlace | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const view = parseView(stored.view);
    if (!view) return null;
    return {
      user: typeof stored.user === 'string' ? stored.user : null,
      view,
      settings: typeof stored.settings === 'string' ? stored.settings : null,
    };
  } catch {
    // Unavailable or corrupt storage: start where a first visit starts.
    return null;
  }
}

export function writeLastPlace(place: LastPlace): void {
  try { localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* storage off: this session only */ }
}

export function clearLastPlace(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
