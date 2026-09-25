// Guards against a stale cached app shell (issue #311): iOS Safari's cache for a
// standalone/home-screen web app can keep serving an old index.html + JS bundle
// well past a deploy, even though our server sends `Cache-Control: no-cache` with
// an ETag for index.html and hashed, immutable URLs for /assets/*.js — WebKit's
// cache for the top-level navigation of a standalone app has been observed to
// skip revalidation entirely. A stale shell means a stale sidebar Logo, not just
// a stale favicon, because the JS embedding the mark never gets re-fetched.
//
// The fix does not rely on anything already present in the (possibly stale) HTML
// page: it fetches a tiny same-origin resource with `cache: 'no-store'`, which
// forces a real network round trip regardless of any HTTP or platform cache, and
// compares the version it reports to the version baked into *this* running
// bundle (`__NOEVIA_BUILD__`, set at build time — see vite.config.ts). A mismatch
// means the page now executing is not the one the server would serve today, so
// we force a single, cache-busting reload. A sessionStorage guard keeps this to
// at most one reload per tab per detected mismatch, so a flaky network or an
// in-flight deploy cannot cause a reload loop.
const GUARD_KEY = 'noevia:shell-reload-guard';
const RELOAD_PARAM = '_shell';

// The reload itself lands on a URL carrying `?_shell=<version>` (the
// cache-busting query that forced a real network fetch); once we're running
// again there is nothing left for it to do, so drop it from the visible URL
// without another navigation or history entry.
function stripReloadParam(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(RELOAD_PARAM)) return;
    url.searchParams.delete(RELOAD_PARAM);
    history.replaceState(history.state, '', url.toString());
  } catch { /* no History API, or a non-browser sandbox running this module */ }
}

export async function checkStaleShell(): Promise<void> {
  stripReloadParam();
  const build = __NOEVIA_BUILD__;
  if (!build || typeof fetch !== 'function') return;
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (!data.version || data.version === build) return;
    const guardValue = `${build}->${data.version}`;
    let already: string | null = null;
    try { already = sessionStorage.getItem(GUARD_KEY); } catch { /* private mode etc. */ }
    if (already === guardValue) return; // already tried reloading for this exact mismatch
    try { sessionStorage.setItem(GUARD_KEY, guardValue); } catch { /* ignore */ }
    const url = new URL(location.href);
    url.searchParams.set(RELOAD_PARAM, data.version);
    location.replace(url.toString());
  } catch {
    // Offline, or the request failed: keep running the current shell rather
    // than risk a reload loop.
  }
}
