import { useEffect, useState, type JSX } from 'react';
import { apiFetch } from '../api';
import { ConfirmDialog } from './ContextMenu';

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

  const load = async () => {
    try {
      const r = await apiFetch('/api/profile/diary-connectors');
      const v = await r.json();
      if (!r.ok) throw Error(v.error || 'Could not load connectors.');
      setConnectors(v.connectors || []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load connectors.'); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/profile/diary-connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
      const v = await r.json();
      if (!r.ok) throw Error(v.error || 'Could not create that connector.');
      setMade({ id: v.id, token: v.token, url: new URL('/api/diary-connector', window.location.origin).toString() });
      setName('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create that connector.'); }
    finally { setBusy(false); }
  };

  const revoke = async (connector: Connector) => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch(`/api/profile/diary-connectors/${connector.id}`, { method: 'DELETE' });
      if (!r.ok) throw Error('Could not revoke that connector.');
      if (made?.id === connector.id) setMade(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not revoke that connector.'); }
    finally { setBusy(false); }
  };

  return <section aria-label="Diary connectors" style={{ marginTop: 24 }}>
    <div className="rail-label">Connected apps</div>
    <p className="route-note">
      A connector lets one other app read and write this account&rsquo;s Diary files. It carries no
      other access — not your chats, not your projects, not your settings — and you can revoke it
      here at any time.
    </p>

    {connectors === null ? <p className="route-note">Loading…</p>
      : connectors.length === 0 ? <p className="route-note">No app is connected.</p>
      : <div className="card-list">
          {connectors.map((c) => (
            <div className="model-row" key={c.id}>
              <div className="model-name-group">
                <span className="model-name">{c.name}</span>
                <span className="model-quant">Added {new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRevoking(c)}>Revoke</button>
            </div>
          ))}
        </div>}

    <div className="source-actions" style={{ marginTop: 12 }}>
      <input
        className="modal-input"
        aria-label="Name this connector"
        placeholder="Name this connector — e.g. Diary on my phone"
        maxLength={80}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
      />
      <button className="btn btn-secondary btn-sm connector-add" disabled={busy || !name.trim()} onClick={() => void create()}>
        {busy ? 'Adding…' : 'Add connector'}
      </button>
    </div>

    {/* Shown once. noevia keeps only a hash of it, so there is no "show it again". */}
    {made && <div className="group surface" style={{ marginTop: 12, padding: 'var(--space-4)' }} role="status">
      <p className="route-note"><strong>Copy this now.</strong> It is shown once, because noevia stores only a fingerprint of it.</p>
      <label className="route-note">Address<input className="modal-input" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} aria-label="Connector address"/></label>
      <label className="route-note">Credential<input className="modal-input" readOnly value={made.token} onFocus={(e) => e.currentTarget.select()} aria-label="Connector credential"/></label>
      <button className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(made.token).catch(() => undefined); }}>Copy credential</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setMade(null)}>Done</button>
    </div>}

    {error && <p role="alert" className="route-note">{error}</p>}

    {revoking && <ConfirmDialog
      title={`Revoke ${revoking.name}?`}
      body="That app stops being able to read or write your Diary immediately. Anything it has already copied stays where it is."
      confirmLabel="Revoke"
      danger
      onCancel={() => setRevoking(null)}
      onConfirm={() => { const c = revoking; setRevoking(null); void revoke(c); }}
    />}
  </section>;
}
