import { useEffect, useState } from 'react';
import { FEATURES_CHANGED, fetchFeatureFlags } from './api';
import type { FeatureFlags } from './api';

// Flags are presentation hints: the server enforces each feature on its own routes.
// The last flags this browser saw paint first so an enabled surface doesn't shift the layout
// on every load; the server's answer replaces them. A failed load turns everything off.
const CACHE_KEY = 'noevia:feature-flags';

function cached(): FeatureFlags {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v === true)) : {};
  } catch { return {}; }
}

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(cached);
  useEffect(() => {
    let live = true;
    const apply = (next: FeatureFlags) => {
      if (!live) return;
      setFlags(next);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    };
    const load = () => fetchFeatureFlags().then(apply).catch(() => apply({}));
    load();
    window.addEventListener(FEATURES_CHANGED, load);
    return () => { live = false; window.removeEventListener(FEATURES_CHANGED, load); };
  }, []);
  return flags;
}
