import { useEffect, useState, type JSX } from 'react';
import { apiFetch } from '../api';
import { ConfirmDialog } from './ContextMenu';
import { useT } from '../i18n';

type Connector = { id: string; name: string; createdAt: number };

/**
 * Connectors let another app — a companion on a phone, a desktop assistant — read and write this
 * account's Diary files over one narrow endpoint. Until now the only way to make one was a
 * command-line script on the server, which is exactly the kind of setup noevia does not ask for.
 *
 * The credential is shown once, here, and never again: noevia keeps only its hash.
 */
export default function DiaryConnectors(): JSX.Element {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ id: string; token: string; url: string } | null>(null);
  const [revoking, setRevoking] = useState<Connector | null>(null);
  const t = useT();

  const load = async () => {
    try {
      const r = await apiFetch('/api/profile/diary-connectors');
      const v = await r.json();
      if (!r.ok) throw Error(v.error || t('diarySettings.connectors.loadError'));
      setConnectors(v.connectors || []);
    } catch (e) { setError(e instanceof Error ? e.message : t('diarySettings.connectors.loadError')); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/profile/diary-connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
      const v = await r.json();
      if (!r.ok) throw Error(v.error || t('diarySettings.connectors.createError'));
      setMade({ id: v.id, token: v.token, url: new URL('/api/diary-connector', window.location.origin).toString() });
      setName('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t('diarySettings.connectors.createError')); }
    finally { setBusy(false); }
  };

  const revoke = async (connector: Connector) => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch(`/api/profile/diary-connectors/${connector.id}`, { method: 'DELETE' });
      if (!r.ok) throw Error(t('diarySettings.connectors.revokeError'));
      if (made?.id === connector.id) setMade(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t('diarySettings.connectors.revokeError')); }
    finally { setBusy(false); }
  };

  return <section aria-label={t('diarySettings.connectors.label')} style={{ marginTop: 24 }}>
    <div className="rail-label">{t('settings.section.connectors')}</div>
    <p className="route-note">{t('diarySettings.connectors.intro')}</p>

    {connectors === null ? <p className="route-note">{t('diarySettings.connectors.loading')}</p>
      : connectors.length === 0 ? <p className="route-note">{t('diarySettings.connectors.none')}</p>
      : <div className="card-list">
          {connectors.map((c) => (
            <div className="model-row" key={c.id}>
              <div className="model-name-group">
                <span className="model-name">{c.name}</span>
                <span className="model-quant">{t('diarySettings.connectors.added', { date: new Date(c.createdAt).toLocaleDateString(t.locale) })}</span>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRevoking(c)}>{t('diarySettings.connectors.revoke')}</button>
            </div>
          ))}
        </div>}

    <div className="source-actions" style={{ marginTop: 12 }}>
      <input
        className="modal-input"
        aria-label={t('diarySettings.connectors.name')}
        placeholder={t('diarySettings.connectors.namePlaceholder')}
        maxLength={80}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
      />
      <button className="btn btn-secondary btn-sm connector-add" disabled={busy || !name.trim()} onClick={() => void create()}>
        {busy ? t('diarySettings.connectors.adding') : t('diarySettings.connectors.add')}
      </button>
    </div>

    {/* Shown once. noevia keeps only a hash of it, so there is no "show it again". */}
    {made && <div className="group surface" style={{ marginTop: 12, padding: 'var(--space-4)' }} role="status">
      <p className="route-note"><strong>{t('diarySettings.connectors.copyNow')}</strong> {t('diarySettings.connectors.shownOnce')}</p>
      <label className="route-note">{t('diarySettings.connectors.address')}<input className="modal-input" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} aria-label={t('diarySettings.connectors.addressLabel')}/></label>
      <label className="route-note">{t('diarySettings.connectors.credential')}<input className="modal-input" readOnly value={made.token} onFocus={(e) => e.currentTarget.select()} aria-label={t('diarySettings.connectors.credentialLabel')}/></label>
      <button className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(made.token).catch(() => undefined); }}>{t('diarySettings.connectors.copy')}</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setMade(null)}>{t('diarySettings.connectors.done')}</button>
    </div>}

    {error && <p role="alert" className="route-note">{error}</p>}

    {revoking && <ConfirmDialog
      title={t('diarySettings.connectors.revokeTitle', { name: revoking.name })}
      body={t('diarySettings.connectors.revokeBody')}
      confirmLabel={t('diarySettings.connectors.revoke')}
      danger
      onCancel={() => setRevoking(null)}
      onConfirm={() => { const c = revoking; setRevoking(null); void revoke(c); }}
    />}
  </section>;
}
