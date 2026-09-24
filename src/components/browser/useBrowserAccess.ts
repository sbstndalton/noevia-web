import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../features/useFeatureFlags';
import { fetchBrowser } from './api';

/** True when this viewer may use Browser mode here: the feature is on and the server says yes (admins). */
export function useBrowserAccess(projectId: string): boolean {
  const flags = useFeatureFlags();
  const [access, setAccess] = useState({ projectId: '', allowed: false });
  useEffect(() => {
    if (!flags.browserExecutor) { setAccess({ projectId, allowed: false }); return; }
    let live = true;
    setAccess(current => current.projectId === projectId ? current : { projectId, allowed: false });
    fetchBrowser(projectId)
      .then(() => { if (live) setAccess({ projectId, allowed: true }); })
      .catch(() => { if (live) setAccess({ projectId, allowed: false }); });
    return () => { live = false; };
  }, [flags.browserExecutor, projectId]);
  // A previous project's permission must not keep its Browser panel mounted for even one render.
  return !!flags.browserExecutor && access.projectId === projectId && access.allowed;
}
