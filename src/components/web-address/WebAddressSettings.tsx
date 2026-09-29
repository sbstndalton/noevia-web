import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { useT } from '../../i18n';
import { around } from '../../text-around';

interface Address { origin: string; source: 'settings' | 'environment' | 'setup' | 'none'; previous: string[]; rpId: string }

async function call<T>(url: string, unreadable: string, body?: unknown): Promise<{ ok: boolean; body: T & { error?: string; unreachable?: boolean } }> {
  const r = await apiFetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // An HTTP error without JSON still gets the usual fallback message. A successful response
  // without readable JSON must fail instead of being treated as a saved address.
  const result = await r.json().catch(() => {
    if (r.ok) throw new Error(unreadable);
    return {};
  });
  return { ok: r.ok, body: result };
}

/**
 * Settings → Web address. Renaming the site is a setting, not a server file edit. Before saving,
 * the server fetches the new address and checks it reaches this same noevia, so a typo or a
 * missing DNS/tunnel route can't lock anyone out. Earlier addresses keep working for sign-in.
 */
export function WebAddressSettings(): JSX.Element {
  const t = useT();
  // The load and save callbacks read the current translator without changing identity, so a
  // catalogue arriving late does not re-run the load effect (an extra request).
  const tRef = useRef(t);
  tRef.current = t;
  const [current, setCurrent] = useState<Address | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unreachable, setUnreachable] = useState(false);
  const [saved, setSaved] = useState('');
  const mounted = useRef(false);
  const loadAttempt = useRef(0);
  const saveAttempt = useRef(0);
  const load = useCallback(async () => {
    const attempt = ++loadAttempt.current;
    setLoading(true);
    setError('');
    try {
      const r = await call<Address>('/api/admin/web-address', tRef.current('webAddress.readError'));
      if (!mounted.current || attempt !== loadAttempt.current) return;
      if (r.ok) { setCurrent(r.body); setValue(v => v || r.body.origin); }
      else setError(r.body.error || tRef.current('webAddress.loadError'));
    } catch {
      if (mounted.current && attempt === loadAttempt.current) setError(tRef.current('webAddress.loadError'));
    } finally {
      if (mounted.current && attempt === loadAttempt.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; loadAttempt.current++; saveAttempt.current++; };
  }, [load]);

  const save = async (force = false) => {
    const attempt = ++saveAttempt.current;
    setBusy(true); setError(''); setSaved(''); setUnreachable(false);
    const next = value.trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
    try {
      const r = await call<Address>('/api/admin/web-address', tRef.current('webAddress.readError'), { origin: next, force });
      if (!mounted.current || attempt !== saveAttempt.current) return;
      if (!r.ok) { setError(r.body.error || tRef.current('webAddress.saveError')); setUnreachable(!!r.body.unreachable); return; }
      setCurrent(r.body); setValue(r.body.origin);
      setSaved(r.body.origin);
    } catch {
      if (mounted.current && attempt === saveAttempt.current) setError(tRef.current('webAddress.saveError'));
    } finally {
      if (mounted.current && attempt === saveAttempt.current) setBusy(false);
    }
  };

  const moved = saved && saved !== window.location.origin;
  return <>
    <div className="settings-title"><h1>{t('settings.section.address')}</h1><p>{t('webAddress.intro')}</p></div>
    {!current ? <div className="settings-section">
      {error ? <><p className="route-note" role="alert">{error}</p><button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>{t('webAddress.retry')}</button></> : <p className="preview-footnote">{t('admin.loading')}</p>}
    </div> : <>
      <div className="set-rows">
        <div className="set-row set-row-inline"><div className="set-row-text"><span className="set-row-label">{t('webAddress.current')}</span></div><div className="set-row-value">{current.origin || t('webAddress.notSet')}</div></div>
        {current.previous.length > 0 && <div className="set-row set-row-inline"><div className="set-row-text"><span className="set-row-label">{t('webAddress.earlier')}</span><span className="set-row-desc">{t('webAddress.earlierDesc')}</span></div><div className="set-row-value">{current.previous.join(', ')}</div></div>}
      </div>
      <form className="settings-section web-address-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2>{t('webAddress.change')}</h2>
        <label htmlFor="web-address">{t('webAddress.new')}</label>
        <div className="web-address-field">
          <input id="web-address" type="text" inputMode="url" autoComplete="off" spellCheck={false} value={value} placeholder="https://noevia.example.com" onChange={(e) => { setValue(e.target.value); setSaved(''); }}/>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>{busy ? t('common.checking') : t('webAddress.check')}</button>
        </div>
        <p className="gdrive-note">{t('webAddress.note')}</p>
        {error && <p className="route-note" role="alert">{error}</p>}
        {unreachable && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save(true)}>{t('webAddress.saveAnyway')}</button>}
        {saved && <p className="route-note" role="status">{around(t('webAddress.saved'), 'address')[0]}<strong>{saved}</strong>{around(t('webAddress.saved'), 'address')[1]}{moved && <> <a href={saved}>{t('webAddress.openThere')}</a> {t('webAddress.andSignIn')}</>}</p>}
      </form>
    </>}
  </>;
}
