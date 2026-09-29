// Settings → Security and login: the native apps signed in with a device code (#555), each with
// its last-used time and a Revoke button. Revoking deletes the device's tokens on the server, so
// its very next request is refused. Rendered only while the nativeClientAuth feature is on.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import { appLocale } from '../../user-preferences';
import { listDevices, revokeDevice } from './device-api';
import type { SignedInDevice } from './device-api';

export default function SignedInDevices(): JSX.Element {
  const t = useT();
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => { setDevices(await listDevices()); };
  useEffect(() => { void refresh().catch(() => setError(t('security.devices.loadError'))); }, []);

  const revoke = async (device: SignedInDevice) => {
    if (busy) return;
    setBusy(device.id); setError(''); setNotice('');
    try {
      await revokeDevice(device.id);
      setNotice(t('security.devices.revoked', { name: device.clientName }));
      await refresh();
    } catch { setError(t('security.devices.revokeError')); }
    finally { setBusy(''); }
  };

  const when = (ms: number) => new Date(ms).toLocaleString(appLocale());
  return <section aria-label={t('security.devices.title')} style={{ marginTop: 24 }}>
    <div className="rail-label">{t('security.devices.title')}</div>
    <p className="route-note">{t('security.devices.intro')}</p>
    <div className="card-list">
      {devices?.map((device) => <div className="model-row" key={device.id}>
        <div className="model-name-group">
          <span className="model-name">{device.clientName}</span>
          <span className="model-quant">{t('security.devices.lastUsed', { date: when(device.lastUsedAt) })} · {t('security.devices.signedIn', { date: when(device.createdAt) })}{device.ip ? ` · ${device.ip}` : ''}</span>
        </div>
        <button className="popup-tab" disabled={!!busy} aria-label={t('security.devices.revokeNamed', { name: device.clientName })} onClick={() => void revoke(device)}>
          {busy === device.id ? t('security.devices.revoking') : t('security.devices.revoke')}
        </button>
      </div>)}
      {devices && !devices.length && <p className="route-note">{t('security.devices.empty')}</p>}
      {!devices && !error && <p className="route-note" role="status">{t('security.devices.loading')}</p>}
    </div>
    {notice && <p className="route-note" role="status">{notice}</p>}
    {error && <p className="route-note" role="alert">{error}</p>}
  </section>;
}
