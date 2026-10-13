import { useEffect, useState } from 'react';
import { FEATURES_CHANGED, fetchFeatureFlags } from './api';
import type { FeatureFlags } from './api';
import { accountChangedElsewhere } from '../../account-session';

// Flags are presentation hints: the server enforces each feature on its own routes.
// The last flags this browser saw paint first so an enabled surface doesn't shift the layout
// on every load; the server's answer replaces them. A failed load turns everything off.
const CACHE_KEY = 'noevia:feature-flags';
// A refused sign-in in another tab settles in seconds; give up after about the marker's own lifetime.
const RETRY_MS = 3000;
const RETRIES = 10;

function cached(): FeatureFlags {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v === true)) : {};
  } catch { return {}; }
}

/** Reads the flags now and again whenever `FEATURES_CHANGED` fires; returns the cleanup. Exported for tests. */
export function startFlagReads(read: () => Promise<FeatureFlags>, apply: (flags: FeatureFlags) => void): () => void {
  let live = true;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const load = () => read().then((next) => { if (live) apply(next); }).catch((error: unknown) => {
    if (!live) return;
    // #1643: another tab is signing in and nothing was sent. That says nothing about the flags, so the
    // last ones stay (switching everything off until a remount is wrong if that sign-in is refused), and
    // the read is repeated until the sign-in has settled. A changed account reloads the page instead.
    const refused = error as { name?: string; reason?: string } | null;
    if (refused?.name === 'AccountChangedError') {
      if (refused.reason === 'signing-in' && attempts++ < RETRIES) { clearTimeout(retry); retry = setTimeout(load, RETRY_MS); }
      return;
    }
    apply({});
  });
  load();
  window.addEventListener(FEATURES_CHANGED, load);
  return () => { live = false; clearTimeout(retry); window.removeEventListener(FEATURES_CHANGED, load); };
}

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(cached);
  useEffect(() => startFlagReads(fetchFeatureFlags, (next) => {
    setFlags(next);
    // #1643: not under a new account's name once another tab has replaced this tab's account.
    if (accountChangedElsewhere()) return;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }), []);
  return flags;
}
