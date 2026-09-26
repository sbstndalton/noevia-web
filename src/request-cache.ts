/**
 * #422: a handful of reads (the profile, the feature flags) are asked for by many
 * independent components that mount together and none of them knows the others
 * exist — `App`, `Sidebar`, `AccountMenu` and `MtpControl` each fetch the profile
 * on their own mount, and `useResearchAccess`/`useCodeAccess` each pull the feature
 * flags through `useFeatureFlags`. Nothing was wrong about any one of those reads;
 * there was just no shared place to notice "someone already asked this".
 *
 * This is that shared place: a small module-level cache keyed by request identity.
 * A concurrent call while a request is in flight gets the same promise (no second
 * request fires); a call shortly after a request resolved gets the same resolved
 * value for `ttlMs` longer, long enough to cover one page's worth of mounting
 * components without turning into a real cache with its own staleness problems.
 *
 * Correctness lives in the callers, not here: this module never invalidates
 * itself on a timer alone — anything that mutates the resource behind a cached
 * key must call `invalidateCached(key)` right after the mutation succeeds, so the
 * next read is never served a value the save has already made stale. See the
 * call sites next to `updateProfile`, `updateFeatures`, `completeOnboarding`,
 * `logout` and the 401 handler in `api.ts`, and next to `saveFeature` and the
 * `noevia:features-changed` listener in `components/features/api.ts`.
 */

interface Entry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 4000;
const store = new Map<string, Entry<unknown>>();

export function cached<T>(key: string, load: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.promise;
  const promise = load();
  store.set(key, { promise, expiresAt: now + ttlMs });
  // A rejected request must not keep poisoning every reader for the rest of the TTL window —
  // drop it immediately so the next call retries instead of replaying the same failure.
  promise.catch(() => {
    if (store.get(key)?.promise === promise) store.delete(key);
  });
  return promise;
}

export function invalidateCached(key: string): void {
  store.delete(key);
}
