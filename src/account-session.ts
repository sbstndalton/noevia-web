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
// The marker is the fast path. `watchAccountSession` also asks the server who the session belongs to
// whenever the tab becomes visible again, which covers a marker that could not be written (storage
// blocked or full) and the moments between a sign-in and its marker.
import { clearRequestCache } from './request-cache';

const MARKER_KEY = 'noevia:session-account';
/** Per-tab sessionStorage that belongs to one account and survives a reload: the pending Nextcloud
 *  sign-in flow (StoragePicker.tsx) and the "first visit" flag set when an account is created. */
const TAB_ACCOUNT_KEYS = ['cowork-nextcloud-flow', 'cowork-new-account'];
export const ACCOUNT_CHANGED_EVENT = 'noevia:account-changed';

let tabAccount: string | null = null;
/** False when the marker could not be stored (blocked or full storage): it then proves nothing. */
let markerUsable = true;
let changed = false;
let probing = false;

/** The marker's value: an account id, null when nobody is signed in, undefined when unreadable. */
function readMarker(): string | null | undefined {
  try { return localStorage.getItem(MARKER_KEY); } catch { return undefined; }
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
}

/** Ask the server which account the shared cookie belongs to. The answer carries no data of this
 *  tab's account; only a different id, or no session, makes the tab stale. */
async function verifySession(): Promise<void> {
  const bound = tabAccount;
  if (!bound || changed || probing) return;
  probing = true;
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    if (tabAccount !== bound) return;
    if (res.status === 401) { handleAccountChange(); return; }
    if (!res.ok) return;
    const body = await res.json().catch(() => null) as { user?: { id?: unknown } } | null;
    if (tabAccount === bound && typeof body?.user?.id === 'string' && body.user.id !== bound) handleAccountChange();
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
