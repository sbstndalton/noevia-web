// The unsaved text of a Space page, kept on this device while a save has not gone through (a failed
// save, a 409, a closed tab). Per page; cleared by a successful save. Storage may be unavailable
// or full: every call then does nothing and says so, and the editor still holds the text in memory.
export interface PageDraftRecord { title: string; content: string; baseVersion: string | null; savedAt: number }

const PREFIX = 'noevia:space-page-draft:';
const key = (spaceId: string, pageId: string) => `${PREFIX}${spaceId}:${pageId}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// A tab whose account another tab replaced writes nothing into storage every tab shares (#1643), as chat drafts do.
let writesBlocked: () => boolean = () => false;
export function guardPageDraftWrites(blocked: () => boolean): void { writesBlocked = blocked; }

/** Sign-out: no page text stays behind on the device (#791). */
export function clearAllPageDrafts(store: Pick<Storage, 'removeItem' | 'key' | 'length'> | null = defaultStore() as Storage | null): void {
  try {
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    for (const k of keys) store.removeItem(k);
  } catch { /* nothing to clear */ }
}
const defaultStore = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function readPageDraft(spaceId: string, pageId: string, store: Store | null = defaultStore()): PageDraftRecord | null {
  try {
    const raw = store?.getItem(key(spaceId, pageId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.title !== 'string' || typeof v.content !== 'string') return null;
    return { title: v.title, content: v.content, baseVersion: typeof v.baseVersion === 'string' ? v.baseVersion : null, savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0 };
  } catch { return null; }
}

export function writePageDraft(spaceId: string, pageId: string, draft: PageDraftRecord, store: Store | null = defaultStore()): boolean {
  try { if (!store || writesBlocked()) return false; store.setItem(key(spaceId, pageId), JSON.stringify(draft)); return true; } catch { return false; }
}

/** Clears the device copy. With `onlyIfSaved`, only when it holds exactly that text: a late save that finishes after the page was
 *  reopened and edited must not delete what the new editor stored. */
export function clearPageDraft(spaceId: string, pageId: string, store: Store | null = defaultStore(), onlyIfSaved?: { title: string; content: string }): void {
  try {
    if (onlyIfSaved) {
      const kept = readPageDraft(spaceId, pageId, store);
      if (kept && (kept.title !== onlyIfSaved.title || kept.content !== onlyIfSaved.content)) return;
    }
    store?.removeItem(key(spaceId, pageId));
  } catch { /* nothing to clear */ }
}
