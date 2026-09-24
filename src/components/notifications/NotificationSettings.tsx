import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { notificationsEnabled, setNotificationsEnabled } from './notify';
import { NOTIFICATION_EVENTS, savePreferences, useAccountPreferences } from '../../user-preferences';
import type { NotificationEvent } from '../../user-preferences';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

type Permission = 'granted' | 'denied' | 'default' | 'unsupported';
const readPermission = (): Permission => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission as Permission : 'unsupported');
const PERMISSION_TEXT: Record<Permission, MessageKey> = {
  granted: 'notifications.permission.granted',
  default: 'notifications.permission.default',
  denied: 'notifications.permission.denied',
  unsupported: 'notifications.permission.unsupported',
};
const EVENT_TEXT: Record<NotificationEvent, [MessageKey, MessageKey]> = {
  replyFinished: ['notifications.event.replyFinished', 'notifications.event.replyFinishedDesc'],
  approvalNeeded: ['notifications.event.approvalNeeded', 'notifications.event.approvalNeededDesc'],
};

/** Settings → Notifications (#227). Two layers, labelled as such: whether THIS DEVICE may show
 *  browser notifications (permission is per device), and which events you want them for (saved
 *  to your account, so every device you allow follows the same choice). */
export function NotificationSettings(): JSX.Element {
  const [permission, setPermission] = useState<Permission>(readPermission);
  const [device, setDevice] = useState(() => readPermission() === 'granted' && notificationsEnabled());
  const prefs = useAccountPreferences();
  const t = useT();
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
    catch (e) { setError(e instanceof Error ? e.message : t('common.saveFailed')); }
    finally { setSaving(null); }
  };

  const delivering = device && permission === 'granted';
  return <>
    <div className="settings-title"><h1>{t('settings.section.notifications')}</h1><p>{t('notifications.intro')}</p></div>
    <section className="settings-section">
      <h2>{t('notifications.device')}</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('notifications.deviceToggle')}</span><span className="set-row-desc" role="status">{t(PERMISSION_TEXT[permission])}</span></div>
          <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label={t('notifications.deviceToggle')} checked={delivering} disabled={permission === 'unsupported' || permission === 'denied'} onChange={(e) => void toggleDevice(e.currentTarget.checked)} /></div>
        </div>
      </div>
    </section>
    <section className="settings-section">
      <h2>{t('notifications.events')}</h2>
      <p className="set-row-desc">{t('notifications.eventsNote')}{delivering ? '' : ` ${t('notifications.eventsOff')}`}</p>
      <div className="set-rows">
        {NOTIFICATION_EVENTS.map((event) => <div className="set-row" key={event.id}>
          <div className="set-row-text"><span className="set-row-label">{t(EVENT_TEXT[event.id][0])}</span><span className="set-row-desc">{t(EVENT_TEXT[event.id][1])}</span></div>
          <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label={t(EVENT_TEXT[event.id][0])} checked={prefs.notifications[event.id]} disabled={saving !== null} onChange={(e) => void toggleEvent(event.id, e.currentTarget.checked)} /></div>
        </div>)}
      </div>
      {error && <p className="modal-err" role="alert">{error}</p>}
      <p className="route-note">{t('notifications.inAppNote')}</p>
    </section>
  </>;
}
