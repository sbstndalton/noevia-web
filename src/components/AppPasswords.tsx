import { appLocale } from '../user-preferences';
import { useEffect, useState, type JSX } from 'react';
import { apiFetch } from '../api';
import { useT } from '../i18n';

type Credential = { id: string; name: string; scope: 'lan' | 'public'; createdAt: number; lastUsedAt: number | null };
export default function AppPasswords(): JSX.Element {
  const t = useT();
  const [items, setItems] = useState<Credential[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'lan' | 'public'>('lan');
  const [secret, setSecret] = useState<{ id: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    const r = await apiFetch('/api/profile/app-passwords');
    if (!r.ok) throw Error(t('appPasswords.loadError'));
    const body = await r.json().catch(() => null) as { appPasswords?: unknown } | null;
    if (!Array.isArray(body?.appPasswords)) throw Error(t('appPasswords.readError'));
    setItems(body.appPasswords as Credential[]);
  };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/profile/app-passwords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scope }) });
      const value = await r.json();
      if (!r.ok) throw Error(value.error || t('appPasswords.createError'));
      setSecret({ id: value.id, password: value.password }); setName('');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : t('appPasswords.createError')); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch(`/api/profile/app-passwords/${id}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw Error(t('appPasswords.revokeError'));
      if (secret?.id === id) setSecret(null);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : t('appPasswords.revokeError')); }
    finally { setBusy(false); }
  };
  return <section aria-label={t('appPasswords.title')} style={{ marginTop: 24 }}>
    <div className="rail-label">{t('appPasswords.title')}</div>
    <p className="route-note">{t('appPasswords.intro')}</p>
    <div className="card-list">
      {items.map(item => <div className="model-row" key={item.id}>
        <div className="model-name-group">
          <span className="model-name">{item.name}</span>
          <span className="model-quant">{item.scope === 'lan' ? t('appPasswords.lanScope') : t('appPasswords.publicScope')} · {t('appPasswords.created', { date: new Date(item.createdAt).toLocaleDateString(appLocale()) })} · {item.lastUsedAt ? t('appPasswords.used', { date: new Date(item.lastUsedAt).toLocaleString(appLocale()) }) : t('appPasswords.neverUsed')}</span>
        </div>
        <button className="popup-tab" disabled={busy} aria-label={t('appPasswords.revokeNamed', { name: item.name })} onClick={() => void revoke(item.id)}>{t('appPasswords.revoke')}</button>
      </div>)}
      {!items.length && <p className="route-note">{t('appPasswords.empty')}</p>}
      {secret && <div role="status">
        <p className="route-note">{t('appPasswords.saveNow')}</p>
        <input className="modal-input" aria-label={t('appPasswords.newPassword')} value={secret.password} readOnly autoComplete="off" onFocus={e => e.currentTarget.select()} />
        <button className="popup-tab" onClick={() => setSecret(null)}>{t('appPasswords.dismiss')}</button>
      </div>}
      <label className="route-note">{t('appPasswords.deviceName')}<input className="modal-input" value={name} maxLength={80} disabled={busy || !!secret} onChange={e => setName(e.target.value)} placeholder={t('appPasswords.deviceNamePlaceholder')} /></label>
      <label className="route-note">{t('appPasswords.scope')}<select aria-label={t('appPasswords.scope')} className="modal-input" value={scope} disabled={busy || !!secret} onChange={e => setScope(e.target.value as 'lan' | 'public')}><option value="lan">LAN</option><option value="public">{t('appPasswords.publicHttps')}</option></select></label>
      <button className="modal-btn secondary" disabled={busy || !!secret || !name.trim()} onClick={() => void create()}>{busy ? t('common.saving') : t('appPasswords.generate')}</button>
    </div>
    {error && <p className="route-note" role="alert">{error}</p>}
  </section>;
}
