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
  pending: boolean;
}

const DEFAULT_TTL_MS = 4000;
const MAX_ENTRIES = 128;
const store = new Map<string, Entry<unknown>>();

export function cached<T>(key: string, load: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && (hit.pending || hit.expiresAt > now)) return hit.promise;
  // Directory listings add one key per path. Retire expired one-off paths and
  // cap unusually rapid browsing so this short-lived cache cannot grow forever.
  for (const [storedKey, entry] of store) if (!entry.pending && entry.expiresAt <= now) store.delete(storedKey);
  const promise = load();
  if (store.size >= MAX_ENTRIES) {
    for (const [storedKey, entry] of store) {
      if (!entry.pending) { store.delete(storedKey); break; }
    }
  }
  // If every slot is in flight, return this request without caching it. An older
  // in-flight read remains shared, and the cache still has a fixed upper bound.
  if (store.size >= MAX_ENTRIES) return promise;
  const entry: Entry<T> = { promise, expiresAt: Infinity, pending: true };
  store.set(key, entry);
  // A rejected request must not keep poisoning every reader for the rest of the TTL window —
  // drop it immediately so the next call retries instead of replaying the same failure.
  void promise.then(
    () => { entry.pending = false; entry.expiresAt = Date.now() + ttlMs; },
    () => { if (store.get(key) === entry) store.delete(key); },
  );
  return promise;
}

export function invalidateCached(key: string): void {
  store.delete(key);
}

/** Remove a resource family without retaining a new generation of keys after every edit. */
export function invalidateCachedPrefix(prefix: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

export function clearRequestCache(): void {
  store.clear();
}
