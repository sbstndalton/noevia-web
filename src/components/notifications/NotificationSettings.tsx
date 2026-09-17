import { useState } from 'react';
import type { JSX } from 'react';
import { notificationsEnabled, setNotificationsEnabled } from './notify';

/** One switch. Asking for permission happens only when the user turns it on. */
export function NotificationSettings(): JSX.Element {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [on, setOn] = useState(() => supported && notificationsEnabled() && Notification.permission === 'granted');
  const [note, setNote] = useState(() => (supported && Notification.permission === 'denied' ? 'This browser blocks notifications from noevia. Allow them in the site settings, then try again.' : ''));

  const toggle = async (next: boolean) => {
    if (!supported) return;
    if (!next) { setNotificationsEnabled(false); setOn(false); setNote(''); return; }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') { setNotificationsEnabled(false); setOn(false); setNote('This browser blocks notifications from noevia. Allow them in the site settings, then try again.'); return; }
    setNotificationsEnabled(true); setOn(true); setNote('');
  };

  return <section className="settings-section">
    <h2>Notifications</h2>
    <div className="set-rows">
      <div className="set-row">
        <div className="set-row-text"><span className="set-row-label">Notify me when noevia is in the background</span><span className="set-row-desc">{supported ? 'When a reply finishes or a tool needs your approval. Only on this device; notifications never include what you wrote.' : 'This browser does not support notifications.'}</span></div>
        <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label="Background notifications" checked={on} disabled={!supported} onChange={(e) => void toggle(e.currentTarget.checked)} /></div>
      </div>
    </div>
    {note && <p className="route-note" role="status">{note}</p>}
  </section>;
}
