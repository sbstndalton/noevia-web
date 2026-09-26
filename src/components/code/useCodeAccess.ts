import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../features/useFeatureFlags';
import { fetchCode } from './api';

/** True when this viewer may use Code mode here: the feature is on and the server says yes (admins).
 *
 *  `enabled` (default true) lets a caller that only sometimes cares about access — the sidebar,
 *  which only needs this in Code mode — skip the `/api/projects/:id/code` probe entirely rather
 *  than firing it on every load regardless of mode (#415). */
export function useCodeAccess(projectId: string, enabled = true): boolean {
  const flags = useFeatureFlags();
  const [access, setAccess] = useState({ projectId: '', allowed: false });
  useEffect(() => {
    if (!enabled || !flags.codeHarness) { setAccess({ projectId, allowed: false }); return; }
    let live = true;
    setAccess(current => current.projectId === projectId ? current : { projectId, allowed: false });
    fetchCode(projectId)
      .then(() => { if (live) setAccess({ projectId, allowed: true }); })
      .catch(() => { if (live) setAccess({ projectId, allowed: false }); });
    return () => { live = false; };
  }, [enabled, flags.codeHarness, projectId]);
  // A previous project's permission must not keep its Code panel mounted for even one render.
  return enabled && !!flags.codeHarness && access.projectId === projectId && access.allowed;
}
