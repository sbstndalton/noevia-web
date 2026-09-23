import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../features/useFeatureFlags';
import { fetchCode } from './api';

/** True when this viewer may use Code mode here: the feature is on and the server says yes (admins). */
export function useCodeAccess(projectId: string): boolean {
  const flags = useFeatureFlags();
  const [access, setAccess] = useState({ projectId: '', allowed: false });
  useEffect(() => {
    if (!flags.codeHarness) { setAccess({ projectId, allowed: false }); return; }
    let live = true;
    setAccess(current => current.projectId === projectId ? current : { projectId, allowed: false });
    fetchCode(projectId)
      .then(() => { if (live) setAccess({ projectId, allowed: true }); })
      .catch(() => { if (live) setAccess({ projectId, allowed: false }); });
    return () => { live = false; };
  }, [flags.codeHarness, projectId]);
  // A previous project's permission must not keep its Code panel mounted for even one render.
  return !!flags.codeHarness && access.projectId === projectId && access.allowed;
}
