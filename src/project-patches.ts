// Debounced project patches and the project delete flow (#942). Kept free of React so the timer
// behaviour can be tested with fake timers: a delete has to cancel a pending patch for that
// project, or the debounced save fires for an id that no longer exists and reports
// "That did not save" for a change nobody lost.

export type PatchQueue<P> = {
  timers: Record<string, ReturnType<typeof setTimeout>>;
  pending: Record<string, P>;
};

/** Merges `patch` into the project's pending patch and (re)starts its debounce timer. When the
 *  timer fires the merged patch is handed to `flush` exactly once. */
export function queueProjectPatch<P extends object>(
  q: PatchQueue<P>,
  id: string,
  patch: P,
  delayMs: number,
  flush: (id: string, merged: P) => void,
): void {
  q.pending[id] = { ...q.pending[id], ...patch } as P;
  if (q.timers[id]) clearTimeout(q.timers[id]);
  q.timers[id] = setTimeout(() => {
    const merged = q.pending[id];
    delete q.pending[id];
    delete q.timers[id];
    if (merged) flush(id, merged);
  }, delayMs);
}

/** Cancels the project's debounce timer and removes its pending patch, returning the patch (if
 *  any) so a caller can put it back when the delete it was cleared for fails. */
export function takeProjectPatch<P>(q: PatchQueue<P>, id: string): P | undefined {
  if (q.timers[id]) clearTimeout(q.timers[id]);
  delete q.timers[id];
  const held = q.pending[id];
  delete q.pending[id];
  return held;
}

/** Puts back a patch taken by takeProjectPatch (the delete failed). Anything queued since is
 *  newer, so it wins over the held values. */
export function restoreProjectPatch<P extends object>(
  q: PatchQueue<P>,
  id: string,
  held: P | undefined,
  flush: (id: string, merged: P) => void,
): void {
  if (!held) return;
  q.pending[id] = { ...held, ...q.pending[id] } as P;
  queueProjectPatch(q, id, {} as P, 0, flush);
}

type ViewLike =
  | { kind: 'project'; id: string }
  | { kind: 'chat'; chatId: string; projectId?: string | null }
  | { kind: string };

/** Whether the screen is showing the project or one of its chats, i.e. whether deleting that
 *  project has to move the person elsewhere. A chat opened by its address has no projectId on
 *  the view, so the chat list is asked which project owns it. */
export function viewBelongsToProject(
  view: ViewLike,
  projectId: string,
  chatProjectOf: (chatId: string) => string | null | undefined,
): boolean {
  if (view.kind === 'project') return (view as { id: string }).id === projectId;
  if (view.kind === 'chat') {
    const v = view as { chatId: string; projectId?: string | null };
    return v.projectId === projectId || chatProjectOf(v.chatId) === projectId;
  }
  return false;
}

type Tr = (key: 'projectSave.failed' | 'projectSave.failedGeneric' | 'projectSave.tooLarge' | 'projectSave.syncFailed' | 'projectSave.syncFailedGeneric', params?: Record<string, string | number>) => string;

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message.trim().replace(/[.\s]+$/, '') : '');

/** The banner text for a project patch the server did not take. */
export function projectSaveErrorText(e: unknown, tr: Tr): string {
  const reason = reasonOf(e);
  if (/exceeds size limit|413/i.test(reason)) return tr('projectSave.tooLarge');
  return reason ? tr('projectSave.failed', { reason }) : tr('projectSave.failedGeneric');
}

/** The banner text for a save that landed but whose source sync failed afterwards. */
export function projectSyncErrorText(e: unknown, tr: Tr): string {
  const reason = reasonOf(e);
  return reason ? tr('projectSave.syncFailed', { reason }) : tr('projectSave.syncFailedGeneric');
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => k in (b as object) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** #1886: the part of `patch` that differs from what the project already holds. A press of
 *  "Refresh from storage" re-submits the unchanged folder list; that is a read plus a sync, not
 *  a settings write, so it must not POST /config (it can overwrite concurrent edits and takes the
 *  projects store lock). An empty result means there is nothing to save. */
export function changedProjectPatch<P extends object>(current: object | undefined, patch: P): Partial<P> {
  const out: Partial<P> = {};
  for (const key of Object.keys(patch) as (keyof P)[]) {
    if (!current || !sameValue((current as Record<string, unknown>)[key as string], patch[key])) out[key] = patch[key];
  }
  return out;
}
