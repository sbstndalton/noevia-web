import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../features/useFeatureFlags';
import { fetchCode } from './api';

/** True when this viewer may use Code mode here: the feature is on and the server says yes (admins). */
export function useCodeAccess(projectId: string): boolean {
  const flags = useFeatureFlags();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!flags.codeHarness) { setAllowed(false); return; }
    let live = true;
    fetchCode(projectId).then(() => { if (live) setAllowed(true); }).catch(() => { if (live) setAllowed(false); });
    return () => { live = false; };
  }, [flags.codeHarness, projectId]);
  return allowed;
}
