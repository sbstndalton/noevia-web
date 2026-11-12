// The unsaved text of a Space page, kept on this device while a save has not gone through (a failed
// save, a 409, a closed tab). Per page; cleared by a successful save. Storage may be unavailable
// or full: every call then does nothing and says so, and the editor still holds the text in memory.
export interface PageDraftRecord { title: string; content: string; baseVersion: string | null; savedAt: number }

const PREFIX = 'noevia:space-page-draft:';
const key = (spaceId: string, pageId: string) => `${PREFIX}${spaceId}:${pageId}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
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
  try { if (!store) return false; store.setItem(key(spaceId, pageId), JSON.stringify(draft)); return true; } catch { return false; }
}

export function clearPageDraft(spaceId: string, pageId: string, store: Store | null = defaultStore()): void {
  try { store?.removeItem(key(spaceId, pageId)); } catch { /* nothing to clear */ }
}
