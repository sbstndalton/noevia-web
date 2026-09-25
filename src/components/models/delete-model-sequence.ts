// Pure sequencing for DeleteModel's "delete the files, then clean up settings" flow (#176).
//
// The files delete and the settings-section delete are two independent server calls. Once the
// files are gone the model must disappear from the list immediately — a failure cleaning up its
// settings sections is real but non-blocking, and must never leave the deleted model stuck on
// screen (a re-click would just re-run the already-successful file delete and throw again).

/** `error` is the English text (logs, tests); `cleanupDetail` is the underlying message the UI
 *  wraps in its own translated sentence (mm.delete.cleanupFailed). `rolesCleared` carries the
 *  server's report of which auto-router roles referenced the deleted model (POST
 *  /api/models/delete's `rolesCleared`), when `deleteFiles` reports one back. */
export type DeleteOutcome = { onDeleted: boolean; error: string | null; cleanupDetail?: string; rolesCleared?: string[] };

/**
 * @param deleteFiles   Deletes the model's files. Rejects on failure. May resolve with the
 *                       roles the server cleared off the deleted model (POST /api/models/delete
 *                       runs on this side of `deleteFiles` for the primary delete path).
 * @param deleteSettings Removes the model's settings sections, if requested. Rejects on failure.
 *                        Omit (or pass undefined) when there is nothing to clean up.
 */
export async function runDeleteModelFiles(deleteFiles: () => Promise<string[] | void>, deleteSettings?: () => Promise<void>): Promise<DeleteOutcome> {
  const rolesCleared = (await deleteFiles()) || undefined;
  if (!deleteSettings) return { onDeleted: true, error: null, rolesCleared };
  try {
    await deleteSettings();
    return { onDeleted: true, error: null, rolesCleared };
  } catch (e) {
    return { onDeleted: true, error: settingsCleanupErrorText(e), cleanupDetail: e instanceof Error ? e.message : String(e ?? ''), rolesCleared };
  }
}

export function settingsCleanupErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return `Deleted, but its settings could not be cleaned up${msg ? `: ${msg}` : '.'}`;
}

/** 4xx-resilient JSON error parse: never throws on a non-JSON or empty body. */
export async function readErrorBody(r: { json: () => Promise<unknown>; status: number }): Promise<{ error?: string }> {
  const body = (await r.json().catch(() => ({}))) as { error?: string } | null;
  return body && typeof body === 'object' ? body : {};
}

export function httpErrorMessage(status: number, error?: string): string {
  return error || `HTTP ${status}`;
}
