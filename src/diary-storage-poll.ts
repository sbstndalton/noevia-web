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
