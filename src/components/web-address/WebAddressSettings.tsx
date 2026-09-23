import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

interface Address { origin: string; source: 'settings' | 'environment' | 'setup' | 'none'; previous: string[]; rpId: string }

async function call<T>(url: string, body?: unknown): Promise<{ ok: boolean; body: T & { error?: string; unreachable?: boolean } }> {
  const r = await apiFetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // An HTTP error without JSON still gets the usual fallback message. A successful response
  // without readable JSON must fail instead of being treated as a saved address.
  const result = await r.json().catch(() => {
    if (r.ok) throw new Error('The response could not be read. Please try again.');
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
      const r = await call<Address>('/api/admin/web-address');
      if (!mounted.current || attempt !== loadAttempt.current) return;
      if (r.ok) { setCurrent(r.body); setValue(v => v || r.body.origin); }
      else setError(r.body.error || 'The web address could not be loaded. Please try again.');
    } catch {
      if (mounted.current && attempt === loadAttempt.current) setError('The web address could not be loaded. Please try again.');
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
      const r = await call<Address>('/api/admin/web-address', { origin: next, force });
      if (!mounted.current || attempt !== saveAttempt.current) return;
      if (!r.ok) { setError(r.body.error || 'Could not save. Please try again.'); setUnreachable(!!r.body.unreachable); return; }
      setCurrent(r.body); setValue(r.body.origin);
      setSaved(r.body.origin);
    } catch {
      if (mounted.current && attempt === saveAttempt.current) setError('Could not save. Please try again.');
    } finally {
      if (mounted.current && attempt === saveAttempt.current) setBusy(false);
    }
  };

  const moved = saved && saved !== window.location.origin;
  return <>
    <div className="settings-title"><h1>Web address</h1><p>The address people use to open noevia. Change it here after pointing the new name at this server (for example a Cloudflare tunnel route).</p></div>
    {!current ? <div className="settings-section">
      {error ? <><p className="route-note" role="alert">{error}</p><button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>Retry</button></> : <p className="preview-footnote">Loading…</p>}
    </div> : <>
      <div className="set-rows">
        <div className="set-row set-row-inline"><div className="set-row-text"><span className="set-row-label">Current address</span></div><div className="set-row-value">{current.origin || 'Not set'}</div></div>
        {current.previous.length > 0 && <div className="set-row set-row-inline"><div className="set-row-text"><span className="set-row-label">Earlier addresses</span><span className="set-row-desc">Still accepted for signing in, so nobody is locked out during a move.</span></div><div className="set-row-value">{current.previous.join(', ')}</div></div>}
      </div>
      <form className="settings-section web-address-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2>Change address</h2>
        <label htmlFor="web-address">New address</label>
        <div className="web-address-field">
          <input id="web-address" type="text" inputMode="url" autoComplete="off" spellCheck={false} value={value} placeholder="https://noevia.example.com" onChange={(e) => { setValue(e.target.value); setSaved(''); }}/>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Check and save'}</button>
        </div>
        <p className="gdrive-note">noevia first opens the new address itself to make sure it reaches this server. After the change, everyone signs in again at the new address. Existing passkeys keep working there in Chrome, Edge and Safari (the old address must stay routed to this server); in Firefox, sign in with your password.</p>
        {error && <p className="route-note" role="alert">{error}</p>}
        {unreachable && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save(true)}>Save anyway</button>}
        {saved && <p className="route-note" role="status">Saved. noevia now lives at <strong>{saved}</strong>.{moved && <> <a href={saved}>Open it there</a> and sign in.</>}</p>}
      </form>
    </>}
  </>;
}
