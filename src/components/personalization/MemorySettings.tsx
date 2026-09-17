import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

type Saved = { memories: string[]; useProjectMemories: boolean; updatedAt: number | null; maxItems: number; maxItemChars: number };
const lines = (text: string) => [...new Set(text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean))];

/** Settings → Personalization → Memory: account-wide facts, and whether project memory is used. */
export function MemorySettings(): JSX.Element {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState('');
  const [useProject, setUseProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    apiFetch('/api/account/memory').then(async (r) => {
      if (!r.ok) throw Error();
      const body: Saved = await r.json();
      if (live) { setSaved(body); setDraft(body.memories.join('\n')); setUseProject(body.useProjectMemories); }
    }).catch(() => { if (live) setError('Your memory settings could not be loaded.'); });
    return () => { live = false; };
  }, []);

  const current = lines(draft);
  const maxItems = saved?.maxItems ?? 50;
  const maxChars = saved?.maxItemChars ?? 300;
  const tooLong = current.some((l) => l.length > maxChars);
  const changed = saved !== null && (current.join('\n') !== saved.memories.join('\n') || useProject !== saved.useProjectMemories);
  const save = async () => {
    setBusy(true); setStatus(''); setError('');
    try {
      const r = await apiFetch('/api/account/memory', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memories: current, useProjectMemories: useProject }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || 'Could not save. Try again.');
      setSaved(body); setDraft(body.memories.join('\n')); setUseProject(body.useProjectMemories);
      setStatus('Saved. New messages use this memory.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };

  return <section className="settings-section">
    <h2>Memory</h2>
    <label className="personal-instructions">
      <span className="set-row-label">What noevia remembers about you</span>
      <span className="set-row-desc">One fact per line, used in every chat except the Diary. Only what you write here is remembered; nothing is added automatically.</span>
      <textarea value={draft} rows={6} disabled={saved === null || busy}
        placeholder={'I work as a nurse in Bergen.\nMy home server runs Unraid.'}
        onChange={(e) => { setDraft(e.target.value); setStatus(''); }} />
    </label>
    <div className="set-rows">
      <div className="set-row">
        <div className="set-row-text"><span className="set-row-label">Use project memory</span><span className="set-row-desc">Also apply the memory lines saved in each project when you chat inside it.</span></div>
        <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label="Use project memory" checked={useProject} disabled={saved === null || busy} onChange={(e) => { setUseProject(e.currentTarget.checked); setStatus(''); }} /></div>
      </div>
    </div>
    <div className="personal-actions">
      <span className="personal-count" aria-live="polite">{current.length} / {maxItems}</span>
      <button className="modal-btn primary" disabled={!changed || busy || tooLong || current.length > maxItems} onClick={() => void save()}>{busy ? 'Saving…' : 'Save memory'}</button>
    </div>
    {tooLong && <p className="modal-err" role="alert">Keep each line under {maxChars} characters.</p>}
    {status && <p className="route-note" role="status">{status}</p>}
    {error && <p className="modal-err" role="alert">{error}</p>}
  </section>;
}
