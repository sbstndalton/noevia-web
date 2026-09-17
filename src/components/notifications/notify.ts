/** Opt-in system notifications for work that finishes while noevia is in the background.
 *  Per device (browser permission is per device), so the choice lives in localStorage. */
export const NOTIFY_KEY = 'noevia:notify';

export type NotifyEnv = { enabled: boolean; permission: string; hidden: boolean };

/** Only when the user opted in, the browser allowed it, and the page is not being looked at. */
export function shouldNotify(env: NotifyEnv): boolean {
  return env.enabled && env.permission === 'granted' && env.hidden;
}

export function notificationsEnabled(): boolean {
  try { return localStorage.getItem(NOTIFY_KEY) === '1'; } catch { return false; }
}

export function setNotificationsEnabled(on: boolean): void {
  try { if (on) localStorage.setItem(NOTIFY_KEY, '1'); else localStorage.removeItem(NOTIFY_KEY); } catch { /* private mode */ }
}

/** Title is short; body never includes message content (lock screens are not private). */
export function notifyIfAway(title: string, body: string, tag: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (!shouldNotify({ enabled: notificationsEnabled(), permission: Notification.permission, hidden: document.visibilityState === 'hidden' })) return;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}
