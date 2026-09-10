import { useEffect, useState, type JSX } from 'react';
import { apiFetch } from '../api';

type Credential = { id: string; name: string; scope: 'lan' | 'public'; createdAt: number; lastUsedAt: number | null };
export default function AppPasswords(): JSX.Element {
  const [items, setItems] = useState<Credential[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'lan' | 'public'>('lan');
  const [secret, setSecret] = useState<{ id: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    const r = await apiFetch('/api/profile/app-passwords');
    if (!r.ok) throw Error('Could not load app passwords.');
    setItems((await r.json()).appPasswords);
  };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/profile/app-passwords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scope }) });
      const value = await r.json();
      if (!r.ok) throw Error(value.error || 'Could not create app password.');
      setSecret({ id: value.id, password: value.password }); setName('');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create app password.'); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch(`/api/profile/app-passwords/${id}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw Error('Could not revoke app password.');
      if (secret?.id === id) setSecret(null);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not revoke app password.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="App passwords" style={{ marginTop: 24 }}>
    <div className="rail-label">App passwords</div>
    <p className="route-note">Device credentials for your diary files. Enable file sharing separately in Diary & storage. Creating a password does not enable it. These passwords cannot sign in to noevia.</p>
    <div className="card-list">
      {items.map(item => <div className="model-row" key={item.id}>
        <div className="model-name-group">
          <span className="model-name">{item.name}</span>
          <span className="model-quant">{item.scope === 'lan' ? 'LAN scope' : 'Public scope'} · created {new Date(item.createdAt).toLocaleDateString()} · {item.lastUsedAt ? `used ${new Date(item.lastUsedAt).toLocaleString()}` : 'never used'}</span>
        </div>
        <button className="popup-tab" disabled={busy} aria-label={`Revoke ${item.name}`} onClick={() => void revoke(item.id)}>Revoke</button>
      </div>)}
      {!items.length && <p className="route-note">No app passwords.</p>}
      {secret && <div role="status">
        <p className="route-note">Save this password now. It will not be shown again after you leave or dismiss this panel.</p>
        <input className="modal-input" aria-label="New app password" value={secret.password} readOnly autoComplete="off" onFocus={e => e.currentTarget.select()} />
        <button className="popup-tab" onClick={() => setSecret(null)}>Dismiss password</button>
      </div>}
      <label className="route-note">Device name<input className="modal-input" value={name} maxLength={80} disabled={busy || !!secret} onChange={e => setName(e.target.value)} placeholder="e.g. Laptop" /></label>
      <label className="route-note">Credential scope<select aria-label="Credential scope" className="modal-input" value={scope} disabled={busy || !!secret} onChange={e => setScope(e.target.value as 'lan' | 'public')}><option value="lan">LAN</option><option value="public">Public (HTTPS)</option></select></label>
      <button className="modal-btn secondary" disabled={busy || !!secret || !name.trim()} onClick={() => void create()}>{busy ? 'Saving…' : 'Generate app password'}</button>
    </div>
    {error && <p className="route-note" role="alert">{error}</p>}
  </section>;
}
