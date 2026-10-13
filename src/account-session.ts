// Which account this tab is signed in as, and what happens when another tab changes that (#1643).
//
// The session cookie is shared by every tab of a browser, the page's in-memory state is not. If
// another tab signs out and in as a different user, this tab keeps the first account's open chats,
// the kept-alive Diary tree and its drafts while every request it makes now goes out under the new
// account's cookie. A tab therefore remembers the account it was set up for (`bindTabAccount`, from
// the sign-in claim in account-device-state.ts) and mirrors it into a localStorage marker that all
// tabs share. A tab whose marker names someone else, or nobody, is stale: it
//   - stops sending requests and stops writing drafts at once (`accountChangedElsewhere`, checked
//     synchronously by apiFetch and writeDraft, so the storage event arriving late cannot matter),
//   - drops the shared request cache and the tab-scoped session state,
//   - tells AuthGate to unmount the app (`noevia:account-changed`), and
//   - reloads, which discards everything held in memory and lands on the new account or sign-in.
// A tab that is about to sign in writes a "signing in" marker BEFORE the credential request (`beginSignIn`),
// because the new cookie exists from that response on while the account marker only follows once the
// session has been read back. Other tabs refuse to send while it stands (without reloading: a mistyped
// password puts the old marker back), and reload when it is replaced by another account. A marker left
// behind by a tab that died mid sign-in goes stale after a while and the tab then asks the server.
// The marker is the fast path. `watchAccountSession` also asks the server who the session belongs to
// whenever the tab becomes visible again, which covers a marker that could not be written (storage
// blocked or full) and the moments between a sign-in and its marker.
import { clearRequestCache } from './request-cache';

const MARKER_KEY = 'noevia:session-account';
/** Per-tab sessionStorage that belongs to one account and survives a reload: the pending Nextcloud
 *  sign-in flow (StoragePicker.tsx) and the "first visit" flag set when an account is created. */
const TAB_ACCOUNT_KEYS = ['cowork-nextcloud-flow', 'cowork-new-account'];
export const ACCOUNT_CHANGED_EVENT = 'noevia:account-changed';
/** The reload did not happen (a beforeunload prompt, such as the Diary's unsaved text, was declined). */
export const ACCOUNT_RELOAD_BLOCKED_EVENT = 'noevia:account-reload-blocked';
const SIGNING_IN = 'signing-in:';
export const SIGNING_IN_TTL_MS = 30_000;
const RELOAD_GRACE_MS = 2500;
export const PROBE_MIN_INTERVAL_MS = 5000;

let tabAccount: string | null = null;
/** False when the marker could not be stored (blocked or full storage): it then proves nothing. */
let markerUsable = true;
let changed = false;
let probing = false;
let lastProbeAt = 0;

/** The marker's value: an account id, null when nobody is signed in, undefined when unreadable. */
function readMarker(): string | null | undefined {
  try { return localStorage.getItem(MARKER_KEY); } catch { return undefined; }
}

/** When a "signing in" marker was written, or null for any other marker value. */
function signingInSince(marker: string): number | null {
  if (!marker.startsWith(SIGNING_IN)) return null;
  const at = Number(marker.slice(SIGNING_IN.length).split(':')[0]);
  return Number.isFinite(at) ? at : 0;
}

/** Call before sending a credential (password, passkey, recovery, invitation): from then on other tabs
 *  of this browser send nothing. The returned function puts the previous marker back, for a credential
 *  that was refused (it does nothing if another tab has written its own marker since). A successful
 *  sign-in does not call it: `claimDeviceState` replaces the marker with the new account's id. */
export function beginSignIn(): () => void {
  const previous = readMarker();
  const mine = `${SIGNING_IN}${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(MARKER_KEY, mine); } catch { return () => undefined; }
  return () => {
    try {
      if (localStorage.getItem(MARKER_KEY) !== mine) return;
      if (typeof previous === 'string') localStorage.setItem(MARKER_KEY, previous); else localStorage.removeItem(MARKER_KEY);
    } catch { /* storage went away: nothing to restore */ }
  };
}

/** This tab now shows `userId`'s data: remember it here and tell the other tabs. */
export function bindTabAccount(userId: string): void {
  if (!userId) return;
  tabAccount = userId;
  changed = false;
  try { localStorage.setItem(MARKER_KEY, userId); } catch { /* unusable, found out below */ }
  markerUsable = readMarker() === userId;
}

/** Sign-out in this tab: nothing is shown for an account any more, and other tabs hear it. */
export function releaseTabAccount(): void {
  tabAccount = null;
  changed = false;
  try { localStorage.removeItem(MARKER_KEY); } catch { /* nothing stored to remove */ }
}

/** The session ended here (a 401) and the sign-in screen replaced the app: there is no account to
 *  protect until someone signs in. The marker is left alone — it is not this tab's to clear. */
export function unbindTabAccount(): void {
  tabAccount = null;
  changed = false;
}

/** True once this tab's account is no longer the browser's. Synchronous and cheap, so it can sit
 *  in front of every request and every write of account data. */
export function accountChangedElsewhere(): boolean {
  if (changed) return true;
  if (!tabAccount || !markerUsable) return false;
  const marker = readMarker();
  if (marker === undefined || marker === tabAccount) return false;
  const since = marker === null ? null : signingInSince(marker);
  if (since !== null) {
    // Someone is signing in: send nothing, but keep the page until it is known who they signed in as.
    if (Date.now() - since < SIGNING_IN_TTL_MS) return true;
    void verifySession(true); // the tab that was signing in is gone; the server says whose session this is
    return false;
  }
  handleAccountChange();
  return true;
}

/** Idempotent. Everything in this tab that was loaded for the old account goes. */
function handleAccountChange(): void {
  if (changed) return;
  changed = true;
  clearRequestCache();
  for (const key of TAB_ACCOUNT_KEYS) { try { sessionStorage.removeItem(key); } catch { /* unavailable */ } }
  try { window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT)); } catch { /* no window: nothing to unmount */ }
  try { window.location.reload(); } catch { /* the stale flag still stops every request */ }
  // A page that is unloading never runs this. One that is still here had its reload declined.
  setTimeout(() => { try { window.dispatchEvent(new Event(ACCOUNT_RELOAD_BLOCKED_EVENT)); } catch { /* no window */ } }, RELOAD_GRACE_MS);
}

/** Ask the server which account the shared cookie belongs to. The answer carries no data of this
 *  tab's account; only a different id, or no session, makes the tab stale. */
async function verifySession(force = false): Promise<void> {
  const bound = tabAccount;
  if (!bound || changed || probing) return;
  // Focus and visibility fire together and often; one answer per interval is enough.
  if (!force && Date.now() - lastProbeAt < PROBE_MIN_INTERVAL_MS) return;
  probing = true;
  lastProbeAt = Date.now();
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    if (tabAccount !== bound) return;
    if (res.status === 401) { handleAccountChange(); return; }
    if (!res.ok) return;
    const body = await res.json().catch(() => null) as { user?: { id?: unknown } } | null;
    if (tabAccount !== bound || typeof body?.user?.id !== 'string') return;
    if (body.user.id !== bound) { handleAccountChange(); return; }
    // Still this account: a "signing in" marker that outlived its tab is put right.
    const marker = readMarker();
    const since = typeof marker === 'string' ? signingInSince(marker) : null;
    if (since !== null && Date.now() - since >= SIGNING_IN_TTL_MS) { try { localStorage.setItem(MARKER_KEY, bound); } catch { /* unusable */ } }
  } catch { /* offline: the next focus asks again */ }
  finally { probing = false; }
}

/** Start listening for account changes made in other tabs. Returns the cleanup. */
export function watchAccountSession(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === MARKER_KEY || event.key === null) accountChangedElsewhere();
  };
  const onVisible = () => { if (document.visibilityState !== 'hidden') void verifySession(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
