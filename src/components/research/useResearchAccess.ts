import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../features/useFeatureFlags';
import { fetchResearch } from './api';

/** True when this viewer may use deep research here: feature on and the server says yes (admins only). */
export function useResearchAccess(projectId: string): boolean {
  const flags = useFeatureFlags();
  const [access, setAccess] = useState({ projectId: '', allowed: false });
  useEffect(() => {
    if (!flags.deepResearch) { setAccess({ projectId, allowed: false }); return; }
    let live = true;
    setAccess(current => current.projectId === projectId ? current : { projectId, allowed: false });
    fetchResearch(projectId).then(() => { if (live) setAccess({ projectId, allowed: true }); })
      .catch(() => { if (live) setAccess({ projectId, allowed: false }); });
    return () => { live = false; };
  }, [flags.deepResearch, projectId]);
  return !!flags.deepResearch && access.projectId === projectId && access.allowed;
}
