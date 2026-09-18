import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

interface Address { origin: string; source: 'settings' | 'environment' | 'setup' | 'none'; previous: string[]; rpId: string }

async function call<T>(url: string, body?: unknown): Promise<{ ok: boolean; body: T & { error?: string; unreachable?: boolean } }> {
  const r = await apiFetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
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
  const [error, setError] = useState('');
  const [unreachable, setUnreachable] = useState(false);
  const [saved, setSaved] = useState('');
  const load = useCallback(async () => {
    const r = await call<Address>('/api/admin/web-address');
    if (r.ok) { setCurrent(r.body); setValue(v => v || r.body.origin); } else setError(r.body.error || 'The web address could not be loaded.');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (force = false) => {
    setBusy(true); setError(''); setSaved(''); setUnreachable(false);
    const next = value.trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
    const r = await call<Address>('/api/admin/web-address', { origin: next, force });
    setBusy(false);
    if (!r.ok) { setError(r.body.error || 'Could not save.'); setUnreachable(!!r.body.unreachable); return; }
    setCurrent(r.body); setValue(r.body.origin);
    setSaved(r.body.origin);
  };

  const moved = saved && saved !== window.location.origin;
  return <>
    <div className="settings-title"><h1>Web address</h1><p>The address people use to open noevia. Change it here after pointing the new name at this server (for example a Cloudflare tunnel route).</p></div>
    {!current ? <p className="preview-footnote">{error || 'Loading…'}</p> : <>
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
        <p className="gdrive-note">noevia first opens the new address itself to make sure it reaches this server. After the change, everyone signs in again at the new address. Passkeys are tied to an address, so add a new one in Security afterwards; passwords keep working.</p>
        {error && <p className="route-note" role="alert">{error}</p>}
        {unreachable && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save(true)}>Save anyway</button>}
        {saved && <p className="route-note" role="status">Saved. noevia now lives at <strong>{saved}</strong>.{moved && <> <a href={saved}>Open it there</a> and sign in.</>}</p>}
      </form>
    </>}
  </>;
}
