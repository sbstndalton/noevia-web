import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

type Saved = { text: string; updatedAt: number | null; maxChars: number };

/** Settings → Personalization. Custom instructions apply to every chat of this account. */
export function PersonalizationSettings(): JSX.Element {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    apiFetch('/api/account/instructions').then(async (r) => {
      if (!r.ok) throw Error();
      const body: Saved = await r.json();
      if (live) { setSaved(body); setDraft(body.text); }
    }).catch(() => { if (live) setError('Your custom instructions could not be loaded.'); });
    return () => { live = false; };
  }, []);

  const max = saved?.maxChars ?? 4000;
  const changed = saved !== null && draft.trim() !== saved.text;
  const save = async () => {
    setBusy(true); setStatus(''); setError('');
    try {
      const r = await apiFetch('/api/account/instructions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: draft }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || 'Could not save. Try again.');
      setSaved(body); setDraft(body.text);
      setStatus(body.text ? 'Saved. New messages use these instructions.' : 'Cleared. Chats no longer get custom instructions.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };

  return <>
    <div className="settings-title"><h1>Personalization</h1><p>How noevia should respond to you in every chat.</p></div>
    <section className="settings-section">
      <label className="personal-instructions">
        <span className="set-row-label">Custom instructions</span>
        <span className="set-row-desc">For example your language, units, or how much detail you like. Project instructions take precedence where they conflict. The Diary keeps its own style.</span>
        <textarea value={draft} maxLength={max} rows={8} disabled={saved === null || busy}
          placeholder="Answer in British English. Prefer metric units. Keep replies short unless I ask for detail."
          onChange={(e) => { setDraft(e.target.value); setStatus(''); }} />
      </label>
      <div className="personal-actions">
        <span className="personal-count" aria-live="polite">{draft.length} / {max}</span>
        <button className="modal-btn primary" disabled={!changed || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {status && <p className="route-note" role="status">{status}</p>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
  </>;
}
