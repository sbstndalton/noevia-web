import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../features/useFeatureFlags';
import { fetchResearch } from './api';

/** True when this viewer may use deep research here: feature on and the server says yes (admins only). */
export function useResearchAccess(projectId: string): boolean {
  const flags = useFeatureFlags();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!flags.deepResearch) { setAllowed(false); return; }
    let live = true;
    fetchResearch(projectId).then(() => { if (live) setAllowed(true); }).catch(() => { if (live) setAllowed(false); });
    return () => { live = false; };
  }, [flags.deepResearch, projectId]);
  return allowed;
}
