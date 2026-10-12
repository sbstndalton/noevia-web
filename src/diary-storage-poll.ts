export type StorageBackup = 'not_configured' | 'pending' | 'failed' | 'complete';
export type PollStatus = { backup: StorageBackup } | null;

/**
 * Pure decision of whether the diary storage status should keep being polled.
 * Polling should only continue while a backup is pending or failed (or the
 * status hasn't loaded yet), and only while the tab is visible.
 */
export function shouldPoll(status: PollStatus, visible: boolean): boolean {
  if (!visible) return false;
  if (status === null) return true;
  return status.backup === 'pending' || status.backup === 'failed';
}

/**
 * #1508: how long to wait before the next storage-status read, or null when polling should stop.
 * A backup that is running is read every 5 s; a failed one, every 15 s (nothing changes faster
 * than the user acts on it). A status that has not loaded, or a read that keeps failing, backs
 * off from 3 s, doubling per consecutive failure up to 60 s, instead of hitting the server every
 * 3 s for as long as the Settings page stays open.
 */
export function storagePollDelayMs(status: PollStatus, visible: boolean, consecutiveFailures: number): number | null {
  if (!shouldPoll(status, visible)) return null;
  if (status?.backup === 'pending') return 5000;
  if (status?.backup === 'failed') return 15000;
  return Math.min(60000, 3000 * 2 ** Math.max(0, Math.min(consecutiveFailures, 5)));
}
