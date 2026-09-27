/** Whether this viewer may use Code mode here, or whether that answer is still in flight.
 *
 *  'checking' is not "denied": it means the answer is not known yet — either because there is no
 *  real project id to check with (the project list has not loaded), or because a real id's own
 *  `/api/projects/:id/code` probe is in flight. A caller that treats 'checking' the same as
 *  'denied' will (briefly, on every load) assert the honest-but-wrong claim that Code mode is not
 *  connected, then flip to the opposite claim a moment later (#450). */
export type CodeAccessState = 'checking' | 'allowed' | 'denied';

/** The latest resolved answer this hook instance has, and which project id it is for. */
export interface CodeAccessSnapshot {
  projectId: string;
  state: CodeAccessState;
}

/** The answer that needs no server probe at all: the feature is off, this caller opted out
 *  (`enabled=false`), or there is no real project id yet — probing a placeholder id (the bug
 *  behind #450) is never necessary, because access here does not vary per project
 *  (`server/routes/code.cjs` checks the flag and the role before it ever looks at the project id).
 *  Returns `null` when only a fetch for the given id can settle it. */
export function syncCodeAccess(projectId: string, enabled: boolean, codeHarness: boolean): CodeAccessState | null {
  if (!enabled || !codeHarness) return 'denied';
  if (!projectId) return 'checking';
  return null;
}

/** This render's answer for `projectId`, from the latest snapshot a fetch resolved. A snapshot
 *  answering for a *different* id — an earlier id whose fetch is still in flight, or one that
 *  raced back before this one landed — must never leak through as this id's answer: it reads as
 *  'checking' until its own fetch actually resolves, exactly like a brand-new id would (#450). */
export function resolvedCodeAccess(snapshot: CodeAccessSnapshot, projectId: string): CodeAccessState {
  return snapshot.projectId === projectId ? snapshot.state : 'checking';
}
