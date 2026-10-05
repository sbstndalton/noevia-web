// #778 (features.routingModes): Settings → Models & routing → where Auto sends chats. The account's
// own mode (local / cloud / hybrid, or not chosen = as before), what hybrid does with a
// sensitive-looking message, and the cloud provider and models. Administrators also choose which
// modes accounts may pick. Flag off: the server answers { enabled: false } and nothing renders.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchProviders, fetchRoutingMode, saveAllowedRoutingModes, saveRoutingMode } from '../../api';
import type { RoutingModeSettings } from '../../api';
import type { Provider } from '../../types';
import { useT } from '../../i18n';

type Mode = 'local' | 'cloud' | 'hybrid';
const MODES: Mode[] = ['local', 'cloud', 'hybrid'];
const MODE_KEY = { local: 'mm.rmode.local', cloud: 'mm.rmode.cloud', hybrid: 'mm.rmode.hybrid' } as const;
const HINT_KEY = { local: 'mm.rmode.localHint', cloud: 'mm.rmode.cloudHint', hybrid: 'mm.rmode.hybridHint' } as const;
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
      <fieldset className="route-mode" disabled={busy}>
        <legend>{t('mm.rmode.mode')}</legend>
        <label><input type="radio" name="routing-mode" value="" checked={mode === ''} onChange={() => setMode('')} /> {t('mm.rmode.unset')}</label>
        {MODES.map((m) => (
          <label key={m}>
            <input type="radio" name="routing-mode" value={m} checked={mode === m} disabled={!serverAllowed.includes(m)} onChange={() => setMode(m)} /> {t(MODE_KEY[m])}
            {!serverAllowed.includes(m) && <small className="mm-note"> · {t('mm.rmode.notAllowed')}</small>}
          </label>
        ))}
        <p className="mm-note">{mode ? t(HINT_KEY[mode]) : t('mm.rmode.unsetHint')}</p>
      </fieldset>
      {mode === 'hybrid' && (
        <fieldset className="route-mode" disabled={busy}>
          <legend>{t('mm.rmode.whenSensitive')}</legend>
          <label><input type="radio" name="routing-sensitive" value="ask" checked={whenSensitive === 'ask'} onChange={() => setWhenSensitive('ask')} /> {t('mm.rmode.ask')}</label>
          <label><input type="radio" name="routing-sensitive" value="local" checked={whenSensitive === 'local'} onChange={() => setWhenSensitive('local')} /> {t('mm.rmode.alwaysLocal')}</label>
        </fieldset>
      )}
      {needsCloud && (
        <div className="mm-form route-roles">
          {providers.length === 0 && <p className="mm-note">{t('mm.rmode.noProviders')}</p>}
          <label>{t('mm.rmode.provider')}
            <select value={cloud.providerId} disabled={busy} onChange={(e) => setCloud((c) => ({ ...c, providerId: e.target.value }))}>
              <option value="">{t('mm.rmode.providerPick')}</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {(['fast', 'smart', 'code'] as const).map((role) => (
            <label key={role}>{t(role === 'fast' ? 'mm.rmode.modelFast' : role === 'smart' ? 'mm.rmode.modelSmart' : 'mm.rmode.modelCode')}
              <input type="text" value={cloud[role]} disabled={busy} spellCheck={false} autoComplete="off" onChange={(e) => setCloud((c) => ({ ...c, [role]: e.target.value }))} />
            </label>
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
            <label key={m}><input type="checkbox" checked={allowed.includes(m)} onChange={(e) => setAllowed((list) => (e.target.checked ? [...list, m] : list.filter((x) => x !== m)))} /> {t(MODE_KEY[m])}</label>
          ))}
          <div className="mm-actions"><button className="modal-btn secondary" onClick={() => void saveAllowed()}>{t('mm.rmode.allowedSave')}</button></div>
        </fieldset>
      )}
    </section>
  );
}
