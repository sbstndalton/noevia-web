// #2457: "Set up later" on the passkey step is remembered for 30 days in this browser, per account, so a password sign-in goes
// straight to the app within that time. No server state: the stored value is the time it was chosen. Registering a passkey, or the
// 30 days passing, ends it. Not cleared on sign-out: the choice belongs to the browser, like the other per-device preferences.
export const PASSKEY_LATER_DAYS = 30;
const PASSKEY_LATER_MS = PASSKEY_LATER_DAYS * 24 * 60 * 60 * 1000;
const keyFor = (userId: string) => `noevia-passkey-later:${userId}`;

export function deferPasskeyStep(userId: string, now = Date.now()): void {
  if (!userId) return;
  try { localStorage.setItem(keyFor(userId), String(now)); } catch { /* storage blocked: the step simply shows again */ }
}

/** True while "Set up later" is still in force for this account in this browser. A time in the future (clock moved) or an unreadable value counts as not chosen. */
export function passkeyStepDeferred(userId: string, now = Date.now()): boolean {
  if (!userId) return false;
  try {
    const at = Number(localStorage.getItem(keyFor(userId)));
    return Number.isFinite(at) && at > 0 && at <= now && now - at < PASSKEY_LATER_MS;
  } catch { return false; }
}

export function clearPasskeyStepDeferral(userId: string): void {
  if (!userId) return;
  try { localStorage.removeItem(keyFor(userId)); } catch { /* nothing to clear */ }
}
