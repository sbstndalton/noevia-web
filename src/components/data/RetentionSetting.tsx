import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { ConfirmDialog } from '../ContextMenu';
import { notifyWorkspaceChanged, useWorkspaceChanged } from './workspace-changed';
import { useT } from '../../i18n';

const LOAD_ERROR = 'load';
type State = { days: number; periods: number[]; preview: Record<string, number> };

/** Delete old chats: off by default; turning it on shows how many chats go right away and asks first. */
export function RetentionSetting(): JSX.Element {
  const t = useT();
  const [state, setState] = useState<State | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch('/api/account/retention').then(async (r) => { if (!r.ok) throw Error(); setState(await r.json()); })
      .catch(() => setError(LOAD_ERROR));
  }, []);
  useEffect(load, [load]);
  useWorkspaceChanged(load);

  const apply = async (days: number, confirmDeletes = 0) => {
    setBusy(true); setError(''); setStatus('');
    try {
      const r = await apiFetch('/api/account/retention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days, confirmDeletes }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || t('common.saveFailed'));
      setStatus(days ? [t('data.retentionOn', { days }), body.deleted ? t('data.deletedNow', { count: body.deleted }) : '', t('data.pinnedKept')].filter(Boolean).join(' ') : t('data.retentionOff'));
      if (body.deleted) notifyWorkspaceChanged(); else load();
    } catch (e) { setError(e instanceof Error ? e.message : t('common.saveFailed')); }
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
    } catch { setError(t('data.retentionCheckError')); }
    finally { setBusy(false); }
  };

  return <>
    <div className="set-row">
      <div className="set-row-text"><span className="set-row-label">{t('data.deleteOld')}</span><span className="set-row-desc">{t('data.deleteOldDesc')}</span></div>
      <div className="set-row-control">
        <select aria-label={t('data.deleteOld')} value={state?.days ?? 0} disabled={!state || busy} onChange={(e) => void choose(Number(e.currentTarget.value))}>
          <option value={0}>{t('data.never')}</option>
          {(state?.periods || [30, 90, 365]).map((days) => <option key={days} value={days}>{t('data.afterDays', { days })}</option>)}
        </select>
      </div>
    </div>
    {status && <p className="route-note" role="status">{status}</p>}
    {error && <p className="modal-err" role="alert">{error === LOAD_ERROR ? t('data.retentionLoadError') : error}</p>}
    {pending !== null && state && <ConfirmDialog danger
      title={t.plural('data.confirmTitle', state.preview[String(pending)] || 0)}
      body={t.plural('data.confirmBody', state.preview[String(pending)] || 0, { days: pending })}
      confirmLabel={t('data.deleteOld')} onConfirm={() => void apply(pending, state.preview[String(pending)] || 0)} onCancel={() => setPending(null)} />}
  </>;
}
