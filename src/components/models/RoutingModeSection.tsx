// #778 (features.routingModes): Settings → Models & routing → where Auto sends chats. The account's
// own mode (local / cloud / hybrid, or not chosen = as before), what hybrid does with a
// sensitive-looking message, and the cloud provider and models. Administrators also choose which
// modes accounts may pick. Flag off: the server answers { enabled: false } and nothing renders.
// The mode and sensitive-handling controls are RoutingModeChoice, shared with the chat model
// picker (#1007); the cloud model fields list the provider's own models (#1009).
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchProviderModels, fetchProviders, fetchRoutingMode, saveAllowedRoutingModes, saveRoutingMode } from '../../api';
import type { RoutingModeSettings } from '../../api';
import type { Provider } from '../../types';
import { RoutingModeChoice, ROUTING_MODES, useRoutingModeLabel } from '../RoutingModeChoice';
import { ModelCombobox } from './ModelCombobox';
import { useT } from '../../i18n';

type Mode = 'local' | 'cloud' | 'hybrid';
const MODES: Mode[] = ROUTING_MODES;
const EMPTY_CLOUD = { providerId: '', fast: '', smart: '', code: '' };

export function RoutingModeSection(): JSX.Element | null {
  const t = useT();
  const [info, setInfo] = useState<RoutingModeSettings | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mode, setMode] = useState<Mode | ''>('');
  const [whenSensitive, setWhenSensitive] = useState<'ask' | 'local'>('ask');
  const [cloud, setCloud] = useState(EMPTY_CLOUD);
  const [allowed, setAllowed] = useState<Mode[]>(MODES);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const modeLabel = useRoutingModeLabel();
  // #1009: the chosen provider's model ids, fetched and cached by the server.
  const [listed, setListed] = useState<{ providerId: string; models: string[]; error: string; loading: boolean }>({ providerId: '', models: [], error: '', loading: false });
  const loadModels = (providerId: string, refresh = false) => {
    if (!providerId) { setListed({ providerId: '', models: [], error: '', loading: false }); return; }
    setListed((l) => ({ providerId, models: l.providerId === providerId ? l.models : [], error: '', loading: true }));
    fetchProviderModels(providerId, refresh)
      .then((r) => setListed((l) => (l.providerId === providerId ? { providerId, models: r.models, error: '', loading: false } : l)))
      .catch((e) => setListed((l) => (l.providerId === providerId ? { providerId, models: [], error: e instanceof Error ? e.message : String(e), loading: false } : l)));
  };
  const needsList = mode === 'cloud' || mode === 'hybrid';
  useEffect(() => { if (needsList) loadModels(cloud.providerId); }, [cloud.providerId, needsList]);

  useEffect(() => {
    let live = true;
    fetchRoutingMode().then((v) => {
      if (!live) return;
      setInfo(v);
      if (!v.enabled) return;
      setMode((v.storedMode !== undefined ? v.storedMode : v.mode) ?? ''); setWhenSensitive(v.whenSensitive ?? 'ask'); setCloud({ ...EMPTY_CLOUD, ...(v.cloud ?? {}) }); setAllowed(v.allowed ?? MODES);
      fetchProviders().then((p) => { if (live) setProviders(p.providers.filter((row) => !row.isDefault)); }).catch(() => undefined);
    }).catch(() => { if (live) setError(t('mm.rmode.loadError')); });
    return () => { live = false; };
  }, []);

  if (!info?.enabled) return error ? <p role="alert" className="modal-err">{error}</p> : null;
  const needsCloud = mode === 'cloud' || mode === 'hybrid';
  const save = async () => {
    setStatus(''); setError('');
    if (mode === 'cloud' && !(cloud.providerId && (cloud.smart || cloud.fast))) { setError(t('mm.rmode.needsCloud')); return; }
    setBusy(true);
    try {
      const next = await saveRoutingMode({ mode: mode || null, whenSensitive, cloud });
      setInfo(next); setStatus(t('mm.rmode.saved'));
      window.dispatchEvent(new Event('noevia:routing-mode-updated'));
    } catch (e) { setError(e instanceof Error ? e.message : t('mm.saveError')); }
    finally { setBusy(false); }
  };
  const saveAllowed = async () => {
    setStatus(''); setError(''); setBusy(true);
    try { const r = await saveAllowedRoutingModes(allowed); setAllowed(r.allowed); setStatus(t('mm.rmode.allowedSaved')); window.dispatchEvent(new Event('noevia:routing-mode-updated')); }
    catch (e) { setError(e instanceof Error ? e.message : t('mm.saveError')); }
    finally { setBusy(false); }
  };
  const serverAllowed = info.allowed ?? MODES;

  return (
    <section className="mm-panel" data-testid="routing-mode-section">
      <div className="mm-panel-head"><h3>{t('mm.rmode.title')}</h3></div>
      <p className="mm-note">{t('mm.rmode.intro')}</p>
      <RoutingModeChoice mode={mode} whenSensitive={whenSensitive} allowed={serverAllowed} disabled={busy}
        unsetLabel={t('rmode.unset')} unsetHint={t('rmode.unsetHint')} onMode={setMode} onSensitive={setWhenSensitive} />
      {needsCloud && (
        <div className="mm-form route-roles">
          {providers.length === 0 && <p className="mm-note">{t('mm.rmode.noProviders')}</p>}
          <label>{t('mm.rmode.provider')}
            <select value={cloud.providerId} disabled={busy} onChange={(e) => setCloud((c) => ({ ...c, providerId: e.target.value }))}>
              <option value="">{t('mm.rmode.providerPick')}</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {cloud.providerId && <div className="mm-actions model-list-status">
            <span className="mm-note" role="status">{listed.loading ? t('mm.loading')
              : listed.error ? t('mm.rmode.listError', { error: listed.error })
              : listed.models.length ? t('mm.rmode.listCount', { count: listed.models.length, provider: providers.find((p) => p.id === cloud.providerId)?.label ?? '' })
              : t('mm.rmode.listEmpty')}</span>
            <button type="button" className="modal-btn secondary" disabled={busy || listed.loading} onClick={() => loadModels(cloud.providerId, true)}>{listed.loading ? t('mm.rmode.refreshing') : t('mm.rmode.refresh')}</button>
          </div>}
          {(['fast', 'smart', 'code'] as const).map((role) => (
            <ModelCombobox key={role} label={t(role === 'fast' ? 'mm.rmode.modelFast' : role === 'smart' ? 'mm.rmode.modelSmart' : 'mm.rmode.modelCode')}
              value={cloud[role]} disabled={busy} options={listed.providerId === cloud.providerId ? listed.models : []}
              onChange={(v) => setCloud((c) => ({ ...c, [role]: v }))} />
          ))}
        </div>
      )}
      <div className="mm-actions">
        <button className="modal-btn primary" disabled={busy} onClick={() => void save()}>{busy ? t('mm.saving') : t('mm.rmode.save')}</button>
        {status && <span role="status" className="mm-note">{status}</span>}
        {error && <span role="alert" className="modal-err">{error}</span>}
      </div>
      {info.admin && (
        <fieldset className="route-mode" disabled={busy}>
          <legend>{t('mm.rmode.allowedTitle')}</legend>
          <p className="mm-note">{t('mm.rmode.allowedScope')}</p>
          {MODES.map((m) => (
            <label key={m}><input type="checkbox" checked={allowed.includes(m)} onChange={(e) => setAllowed((list) => (e.target.checked ? [...list, m] : list.filter((x) => x !== m)))} /> {modeLabel(m)}</label>
          ))}
          <div className="mm-actions"><button className="modal-btn secondary" onClick={() => void saveAllowed()}>{t('mm.rmode.allowedSave')}</button></div>
        </fieldset>
      )}
    </section>
  );
}
