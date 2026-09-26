import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { useT } from '../i18n';

type Step = { ctx: number; kind: 'load' | 'long'; status: 'running' | 'passed' | 'failed' | 'skipped'; reason?: string; seconds?: number; minAvailableGib?: number; progress?: number; etaSeconds?: number; promptPerSecond?: number; promptSeconds?: number };
type Job = { id: string; model: string; promptBudgetSeconds?: number; status: 'running' | 'passed' | 'failed' | 'cancelled' | 'interrupted'; phase: string; steps: Step[]; result?: { loadCtx?: number; verifiedCtx?: number; appliedCtx?: number; loaded?: boolean }; error?: string; restored?: boolean; memoryGuard?: string; memoryFloorGib?: number };
type HistoryEntry = { at: number; promptBudgetSeconds?: number; loadCtx?: number; verifiedCtx?: number; appliedCtx?: number; slots?: number };
import { appLocale } from '../user-preferences';
const tokens = (n: number) => new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 0 }).format(n);

export function NativeCalibration({ model, onChanged, autoFocus = false }: { model: string; onChanged: () => void; autoFocus?: boolean }) {
  const [job, setJob] = useState<Job | null>(null), [history, setHistory] = useState<HistoryEntry[]>([]);
  const [budget, setBudget] = useState(120), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const t = useT();
  const tRef = useRef(t); tRef.current = t;
  const finishedRef = useRef<string>('');
  const refresh = async (isLive?: () => boolean) => {
    const r = await apiFetch('/api/models/calibration?model=' + encodeURIComponent(model)), v = await r.json();
    if (!r.ok) throw Error(v.error || tRef.current('mm.calibration.statusUnavailable'));
    if (isLive && !isLive()) return v.job as Job | null;
    setJob(v.job || null); setHistory(Array.isArray(v.history) ? v.history : []);
    return v.job as Job | null;
  };
  useEffect(() => {
    let live = true;
    void refresh(() => live).catch(e => { if (live) setError(e instanceof Error ? e.message : tRef.current('mm.calibration.statusUnavailable')); });
    return () => { live = false; };
  }, [model]);
  useEffect(() => { if (autoFocus) heading.current?.scrollIntoView({ block: 'nearest' }); }, [autoFocus]);
  const mine = job && job.model === model ? job : null;
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    let live = true;
    const timer = setInterval(() => {
      void refresh(() => live).then(next => {
        if (!live) return;
        if (next && next.status !== 'running' && finishedRef.current !== next.id) { finishedRef.current = next.id; onChanged(); }
      }).catch(() => {});
    }, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [running, model]);
  const start = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/models/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, promptBudgetSeconds: budget, confirmPause: confirmed }) }), v = await r.json();
      if (!r.ok) throw Error(v.error || t('mm.calibration.startFailed'));
      setJob(v); setConfirmed(false);
      // The POST can return a job that already finished (e.g. a cached/instant
      // result) rather than one still running. Without this, ConfigureTab's
      // measured context stays stale until the next unrelated refresh.
      if (v && v.status !== 'running' && finishedRef.current !== v.id) { finishedRef.current = v.id; onChanged(); }
    } catch (e) { setError(e instanceof Error ? e.message : t('mm.calibration.startFailed')); } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError('');
    try { const r = await apiFetch('/api/models/calibration/cancel', { method: 'POST' }), v = await r.json(); if (!r.ok) throw Error(v.error || t('mm.calibration.cancelFailed')); setJob(v); }
    catch (e) { setError(e instanceof Error ? e.message : t('mm.calibration.cancelFailed')); } finally { setBusy(false); }
  };
  const last = history[0];
  return <section className="native-calibration" aria-labelledby={`calibration-${model}`}>
    <h4 id={`calibration-${model}`} ref={heading} tabIndex={-1}>{t('mm.calibration.title')}</h4>
    <p>{t('mm.calibration.intro')}</p>
    {last && !running && <p className="native-calibration-last">{t('mm.calibration.lastBefore', { date: new Date(last.at).toLocaleString(appLocale()) })}<strong>{t('mm.tokensCount', { tokens: tokens(last.appliedCtx || 0) })}</strong>{t('mm.calibration.lastAfter', { seconds: last.promptBudgetSeconds || 120 })}</p>}
    {running && !mine && <p role="status">{t('mm.calibration.otherModel', { model: job?.model ?? '' })}</p>}
    {mine && <div className="native-calibration-job" aria-live="polite">
      <p role="status"><strong>{mine.status === 'running' ? mine.phase : mine.status === 'passed' ? t('mm.calibration.saved', { tokens: tokens(mine.result?.appliedCtx || 0) }) : mine.status === 'cancelled' ? t('mm.queue.cancelled') : mine.status === 'interrupted' ? t('mm.autotune.interrupted') : t('mm.calibration.failed')}</strong>
        {mine.status === 'passed' && <> · {t('mm.calibration.passed', { load: tokens(mine.result?.loadCtx || 0), verified: tokens(mine.result?.verifiedCtx || 0) })} {mine.result?.loaded ? t('mm.calibration.loaded') : t('mm.calibration.notLoaded')}</>}</p>
      {mine.error && <p role="alert">{mine.error}{mine.restored ? ` ${t('mm.calibration.restored')}` : ''}</p>}
      {mine.status === 'cancelled' && mine.restored && <p>{t('mm.calibration.restored')}</p>}
      {mine.memoryGuard === 'unavailable' && <p>{t('mm.calibration.noGuard')}</p>}
      {mine.steps.length > 0 && <div className="native-calibration-steps" role="region" aria-label={t('mm.calibration.steps')}><table>
        <thead><tr><th scope="col">{t('mm.easy.context')}</th><th scope="col">{t('mm.bench.test')}</th><th scope="col">{t('mm.calibration.result')}</th><th scope="col">{t('mm.calibration.time')}</th></tr></thead>
        <tbody>{mine.steps.map((step, i) => <tr key={i} data-status={step.status}>
          <td>{tokens(step.ctx)}</td><td>{step.kind === 'long' ? t('mm.calibration.long') : t('mm.card.load')}</td>
          <td>{step.status === 'running' ? (step.progress != null ? t('mm.calibration.prompt', { pct: step.progress }) + (step.etaSeconds != null ? ` · ${t('mm.calibration.left', { seconds: step.etaSeconds })}` : '') : t('mm.test.running')) : step.status === 'passed' ? t('mm.calibration.stepPassed') : step.status === 'skipped' ? t('mm.calibration.stepSkipped') : t('mm.hw.status.dead')}{step.reason ? <small>{step.reason}</small> : null}{step.promptSeconds ? <small>{t('mm.calibration.fullPrompt', { seconds: step.promptSeconds })}</small> : null}{step.promptPerSecond ? <small>{t('mm.calibration.readRate', { rate: tokens(step.promptPerSecond) })}</small> : null}{step.minAvailableGib != null ? <small>{t('mm.calibration.lowestFree', { gib: step.minAvailableGib })}</small> : null}</td>
          <td>{step.seconds != null ? `${step.seconds}s` : ''}</td></tr>)}</tbody></table></div>}
      {mine.status === 'running' && <button className="popup-tab" disabled={busy} onClick={() => void cancel()}>{busy ? t('mm.cancelling') : t('mm.calibration.cancel')}</button>}
    </div>}
    {!running && <>
      <label className="native-calibration-budget">{t('mm.calibration.budget')}
        <select value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))}>
          {[1, 2, 5, 10].map(n => <option key={n} value={n * 60}>{t.plural('mm.calibration.minutes', n)}</option>)}
        </select>
        <small>{t('mm.calibration.budgetHelp')}</small>
      </label>
      <label className="native-profile-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>{t('mm.calibration.confirm')}</label>
      <button className="popup-tab" disabled={busy || !confirmed} onClick={() => void start()}>{busy ? t('mm.starting') : t('mm.calibration.start')}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
