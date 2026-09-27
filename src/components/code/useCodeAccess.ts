import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../features/useFeatureFlags';
import { fetchCodeAccess } from './api';
import { resolvedCodeAccess, syncCodeAccess } from './code-access-state';
import type { CodeAccessSnapshot, CodeAccessState } from './code-access-state';
export type { CodeAccessState } from './code-access-state';

/** Tri-state check of whether this viewer may use Code mode here: the feature is on and the
 *  server says yes (admins). See `code-access-state.ts` for what 'checking' means and why it must
 *  not be treated as 'denied'.
 *
 *  `projectId` may be '' when the caller has no real project yet (e.g. the project list hasn't
 *  loaded). The hook then reports 'checking' rather than probing a placeholder id: that placeholder
 *  used to 404 and assert 'denied' for as long as the real project list took to arrive, on every
 *  load of the Code landing page (#450).
 *
 *  `enabled` (default true) lets a caller that only sometimes cares about access — the sidebar,
 *  which only needs this in Code mode — skip the `/api/projects/:id/code` probe entirely rather
 *  than firing it on every load regardless of mode (#415).
 *
 *  The actual probe goes through `fetchCodeAccess` (`./api`), which shares one in-flight/settled
 *  request per project id: `CodingWorkspace` and `Sidebar` both mount this hook for the same id on
 *  `/code`, and without that shared cache each would fire its own request (#458). */
export function useCodeAccess(projectId: string, enabled = true): CodeAccessState {
  const flags = useFeatureFlags();
  const codeHarness = !!flags.codeHarness;
  const [snapshot, setSnapshot] = useState<CodeAccessSnapshot>({ projectId: '', state: 'checking' });
  useEffect(() => {
    const sync = syncCodeAccess(projectId, enabled, codeHarness);
    if (sync) { setSnapshot({ projectId, state: sync }); return; }
    let live = true;
    setSnapshot((current) => (current.projectId === projectId ? current : { projectId, state: 'checking' }));
    fetchCodeAccess(projectId)
      .then(() => { if (live) setSnapshot({ projectId, state: 'allowed' }); })
      .catch(() => { if (live) setSnapshot({ projectId, state: 'denied' }); });
    // A superseded id's fetch must not overwrite a later id's answer once it lands (#450).
    return () => { live = false; };
  }, [enabled, codeHarness, projectId]);
  const sync = syncCodeAccess(projectId, enabled, codeHarness);
  if (sync) return sync;
  return resolvedCodeAccess(snapshot, projectId);
}
