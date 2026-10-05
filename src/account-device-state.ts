// What this browser keeps per account in localStorage that another account must never see
// (#791): unsent chat drafts (chat-drafts.ts) and the place to reopen on load (last-view.ts),
// which names the previous account's chat. Appearance and the other `noevia:` preferences are
// per device on purpose and are not touched here.
import { claimDrafts, clearAllDrafts } from './chat-drafts';
import { clearLastPlace, readLastPlace } from './last-view';

/** Sign-in: called by AuthGate with the session's account before the app renders, so a different
 *  account's draft or last chat never shows, not even until the profile loads. */
export function claimDeviceState(userId: string): void {
  if (!userId) return;
  const place = readLastPlace();
  claimDrafts(userId, place?.user ?? null);
  if (place && place.user !== userId) clearLastPlace();
}

/** Sign-out: nothing typed or opened by this account stays behind on the device. */
export function clearDeviceState(): void {
  clearAllDrafts();
  clearLastPlace();
}
