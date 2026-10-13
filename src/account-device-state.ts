// What this browser keeps per account in localStorage that another account must never see
// (#791): unsent chat drafts (chat-drafts.ts) and the place to reopen on load (last-view.ts),
// which names the previous account's chat, and the cached account preferences (#905:
// user-preferences.ts), which are the account's language, Enter behaviour and notification choices. Appearance and the other `noevia:` preferences are
// per device on purpose and are not touched here.
import { accountChangedElsewhere, bindTabAccount, releaseTabAccount } from './account-session';
import { claimDrafts, clearAllDrafts, guardDraftWrites } from './chat-drafts';
import { clearLastPlace, guardLastPlaceWrites, readLastPlace } from './last-view';
import { claimPreferences, clearPreferences } from './user-preferences';

// #1643: a tab whose account another tab replaced must not write that account's drafts or place
// into storage every tab shares.
guardDraftWrites(accountChangedElsewhere);
guardLastPlaceWrites(accountChangedElsewhere);

/** Sign-in: called by AuthGate with the session's account before the app renders, so a different
 *  account's draft or last chat never shows, not even until the profile loads. */
export function claimDeviceState(userId: string): void {
  if (!userId) return;
  // #1643: this tab now shows `userId`'s data; a tab showing anyone else's finds out through this.
  bindTabAccount(userId);
  const place = readLastPlace();
  claimDrafts(userId, place?.user ?? null);
  if (place && place.user !== userId) clearLastPlace();
  claimPreferences(userId);
}

/** Sign-out: nothing typed or opened by this account stays behind on the device. */
export function clearDeviceState(): void {
  releaseTabAccount();
  clearAllDrafts();
  clearLastPlace();
  clearPreferences();
}
