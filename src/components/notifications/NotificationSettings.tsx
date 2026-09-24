import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { notificationsEnabled, setNotificationsEnabled } from './notify';
import { NOTIFICATION_EVENTS, savePreferences, useAccountPreferences } from '../../user-preferences';
import type { NotificationEvent } from '../../user-preferences';

type Permission = 'granted' | 'denied' | 'default' | 'unsupported';
const readPermission = (): Permission => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission as Permission : 'unsupported');
const PERMISSION_TEXT: Record<Permission, string> = {
  granted: 'Allowed by this browser.',
  default: 'Not asked yet. Turning notifications on asks the browser once.',
  denied: 'Blocked by this browser. Open the site settings (the icon left of the address), allow notifications for this site, then come back.',
  unsupported: 'This browser does not support notifications.',
};

/** Settings → Notifications (#227). Two layers, labelled as such: whether THIS DEVICE may show
 *  browser notifications (permission is per device), and which events you want them for (saved
 *  to your account, so every device you allow follows the same choice). */
export function NotificationSettings(): JSX.Element {
  const [permission, setPermission] = useState<Permission>(readPermission);
  const [device, setDevice] = useState(() => readPermission() === 'granted' && notificationsEnabled());
  const prefs = useAccountPreferences();
  const [saving, setSaving] = useState<NotificationEvent | null>(null);
  const [error, setError] = useState('');

  // The permission can change in another tab or the site settings; re-read when we come back.
  useEffect(() => {
    const again = () => { const p = readPermission(); setPermission(p); if (p !== 'granted') setDevice(false); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, []);

  const toggleDevice = async (next: boolean) => {
    if (permission === 'unsupported') return;
    if (!next) { setNotificationsEnabled(false); setDevice(false); return; }
    const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPermission(result as Permission);
    if (result !== 'granted') { setNotificationsEnabled(false); setDevice(false); return; }
    setNotificationsEnabled(true); setDevice(true);
  };

  const toggleEvent = async (id: NotificationEvent, on: boolean) => {
    setSaving(id); setError('');
    try { await savePreferences({ notifications: { [id]: on } }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setSaving(null); }
  };

  const delivering = device && permission === 'granted';
  return <>
    <div className="settings-title"><h1>Notifications</h1><p>Browser notifications for work that finishes while noevia is in another tab. They never include what you or noevia wrote.</p></div>
    <section className="settings-section">
      <h2>This device</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Browser notifications on this device</span><span className="set-row-desc" role="status">{PERMISSION_TEXT[permission]}</span></div>
          <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label="Browser notifications on this device" checked={delivering} disabled={permission === 'unsupported' || permission === 'denied'} onChange={(e) => void toggleDevice(e.currentTarget.checked)} /></div>
        </div>
      </div>
    </section>
    <section className="settings-section">
      <h2>Events</h2>
      <p className="set-row-desc">Saved to your account and used on every device where notifications are on.{delivering ? '' : ' Nothing is delivered here until this device is turned on above.'}</p>
      <div className="set-rows">
        {NOTIFICATION_EVENTS.map((event) => <div className="set-row" key={event.id}>
          <div className="set-row-text"><span className="set-row-label">{event.label}</span><span className="set-row-desc">{event.description}</span></div>
          <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label={event.label} checked={prefs.notifications[event.id]} disabled={saving !== null} onChange={(e) => void toggleEvent(event.id, e.currentTarget.checked)} /></div>
        </div>)}
      </div>
      {error && <p className="modal-err" role="alert">{error}</p>}
      <p className="route-note">In-app status, such as a source that could not sync, always appears inside noevia and is not affected by these switches.</p>
    </section>
  </>;
}
