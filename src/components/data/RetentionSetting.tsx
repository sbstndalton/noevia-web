import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { ConfirmDialog } from '../ContextMenu';
import { notifyWorkspaceChanged, useWorkspaceChanged } from './workspace-changed';

type State = { days: number; periods: number[]; preview: Record<string, number> };

/** Delete old chats: off by default; turning it on shows how many chats go right away and asks first. */
export function RetentionSetting(): JSX.Element {
  const [state, setState] = useState<State | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch('/api/account/retention').then(async (r) => { if (!r.ok) throw Error(); setState(await r.json()); })
      .catch(() => setError('The retention setting could not be loaded.'));
  }, []);
  useEffect(load, [load]);
  useWorkspaceChanged(load);

  const apply = async (days: number, confirmDeletes = 0) => {
    setBusy(true); setError(''); setStatus('');
    try {
      const r = await apiFetch('/api/account/retention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days, confirmDeletes }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || 'Could not save. Try again.');
      setStatus(days ? `Chats not updated for ${days} days are deleted automatically.${body.deleted ? ` Deleted ${body.deleted} now.` : ''} Pinned chats are kept.` : 'Old chats are kept.');
      if (body.deleted) notifyWorkspaceChanged(); else load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); setPending(null); }
  };

  // Always count again at the moment of choosing: chats may have aged or arrived since the page loaded.
  const choose = async (days: number) => {
    if (!days) { void apply(0); return; }
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/account/retention');
      if (!r.ok) throw Error();
      const fresh: State = await r.json();
      setState(fresh);
      if ((fresh.preview[String(days)] || 0) > 0) setPending(days); else void apply(days);
    } catch { setError('The retention setting could not be checked. Try again.'); }
    finally { setBusy(false); }
  };

  return <>
    <div className="set-row">
      <div className="set-row-text"><span className="set-row-label">Delete old chats</span><span className="set-row-desc">Chats not updated for the chosen time are deleted for good, including from other devices. Pinned chats are always kept. Export first if you want a copy.</span></div>
      <div className="set-row-control">
        <select aria-label="Delete old chats" value={state?.days ?? 0} disabled={!state || busy} onChange={(e) => void choose(Number(e.currentTarget.value))}>
          <option value={0}>Never</option>
          {(state?.periods || [30, 90, 365]).map((days) => <option key={days} value={days}>After {days} days</option>)}
        </select>
      </div>
    </div>
    {status && <p className="route-note" role="status">{status}</p>}
    {error && <p className="modal-err" role="alert">{error}</p>}
    {pending !== null && state && <ConfirmDialog danger
      title={`Delete ${state.preview[String(pending)]} old chat${state.preview[String(pending)] === 1 ? '' : 's'} now?`}
      body={`${state.preview[String(pending)]} chat${state.preview[String(pending)] === 1 ? ' has' : 's have'} not been updated for ${pending} days and will be deleted now, and others as they reach that age. This cannot be undone.`}
      confirmLabel="Delete old chats" onConfirm={() => void apply(pending, state.preview[String(pending)] || 0)} onCancel={() => setPending(null)} />}
  </>;
}
