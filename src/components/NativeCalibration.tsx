import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

type Step = { ctx: number; kind: 'load' | 'long'; status: 'running' | 'passed' | 'failed' | 'skipped'; reason?: string; seconds?: number; minAvailableGib?: number; progress?: number; etaSeconds?: number; promptPerSecond?: number; promptSeconds?: number };
type Job = { id: string; model: string; promptBudgetSeconds?: number; status: 'running' | 'passed' | 'failed' | 'cancelled' | 'interrupted'; phase: string; steps: Step[]; result?: { loadCtx?: number; verifiedCtx?: number; appliedCtx?: number; loaded?: boolean }; error?: string; restored?: boolean; memoryGuard?: string; memoryFloorGib?: number };
type HistoryEntry = { at: number; promptBudgetSeconds?: number; loadCtx?: number; verifiedCtx?: number; appliedCtx?: number; slots?: number };
const tokens = (n: number) => n.toLocaleString('en-US');

export function NativeCalibration({ model, onChanged, autoFocus = false }: { model: string; onChanged: () => void; autoFocus?: boolean }) {
  const [job, setJob] = useState<Job | null>(null), [history, setHistory] = useState<HistoryEntry[]>([]);
  const [budget, setBudget] = useState(120), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const finishedRef = useRef<string>('');
  const refresh = async () => {
    const r = await apiFetch('/api/models/calibration?model=' + encodeURIComponent(model)), v = await r.json();
    if (!r.ok) throw Error(v.error || 'Calibration status unavailable');
    setJob(v.job || null); setHistory(Array.isArray(v.history) ? v.history : []);
    return v.job as Job | null;
  };
  useEffect(() => { void refresh().catch(e => setError(e instanceof Error ? e.message : 'Calibration status unavailable')); }, [model]);
  useEffect(() => { if (autoFocus) heading.current?.scrollIntoView({ block: 'nearest' }); }, [autoFocus]);
  const mine = job && job.model === model ? job : null;
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    let live = true;
    const timer = setInterval(() => {
      void refresh().then(next => {
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
      if (!r.ok) throw Error(v.error || 'Calibration could not start');
      setJob(v); setConfirmed(false);
      // The POST can return a job that already finished (e.g. a cached/instant
      // result) rather than one still running. Without this, ConfigureTab's
      // measured context stays stale until the next unrelated refresh.
      if (v && v.status !== 'running' && finishedRef.current !== v.id) { finishedRef.current = v.id; onChanged(); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Calibration could not start'); } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError('');
    try { const r = await apiFetch('/api/models/calibration/cancel', { method: 'POST' }), v = await r.json(); if (!r.ok) throw Error(v.error || 'Could not cancel'); setJob(v); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel'); } finally { setBusy(false); }
  };
  const last = history[0];
  return <section className="native-calibration" aria-labelledby={`calibration-${model}`}>
    <h4 id={`calibration-${model}`} ref={heading} tabIndex={-1}>Measure context on this machine</h4>
    <p>noevia finds the largest context this machine can actually use. Quick load checks find the ceiling, then near-full prompts are tested from the middle of the range upward. A size counts only if a full prompt finishes within your time limit and the model still remembers its start. It measures the real engine, so it works on any GPU or CPU.</p>
    {last && !running && <p className="native-calibration-last">Last measured {new Date(last.at).toLocaleString()}: <strong>{tokens(last.appliedCtx || 0)} tokens</strong> saved, full prompt within {last.promptBudgetSeconds || 120} s.</p>}
    {running && !mine && <p role="status">Another model ({job?.model}) is being calibrated. Chat is paused until it finishes.</p>}
    {mine && <div className="native-calibration-job" aria-live="polite">
      <p role="status"><strong>{mine.status === 'running' ? mine.phase : mine.status === 'passed' ? `Saved ${tokens(mine.result?.appliedCtx || 0)} tokens` : mine.status === 'cancelled' ? 'Cancelled' : mine.status === 'interrupted' ? 'Interrupted' : 'Calibration failed'}</strong>
        {mine.status === 'passed' && <> · loads up to {tokens(mine.result?.loadCtx || 0)}; a full prompt fits the time limit up to {tokens(mine.result?.verifiedCtx || 0)}. {mine.result?.loaded ? 'The model is loaded with the new profile.' : 'The new profile is saved; the model loads on the next chat.'}</>}</p>
      {mine.error && <p role="alert">{mine.error}{mine.restored ? ' The original profile was restored.' : ''}</p>}
      {mine.status === 'cancelled' && mine.restored && <p>The original profile was restored.</p>}
      {mine.memoryGuard === 'unavailable' && <p>noevia cannot read this host's memory, so the low-memory guard is off. Failed loads still stop each step.</p>}
      {mine.steps.length > 0 && <div className="native-calibration-steps" role="region" aria-label="Calibration steps"><table>
        <thead><tr><th scope="col">Context</th><th scope="col">Test</th><th scope="col">Result</th><th scope="col">Time</th></tr></thead>
        <tbody>{mine.steps.map((step, i) => <tr key={i} data-status={step.status}>
          <td>{tokens(step.ctx)}</td><td>{step.kind === 'long' ? 'Long prompt' : 'Load'}</td>
          <td>{step.status === 'running' ? (step.progress != null ? `Prompt ${step.progress}%${step.etaSeconds != null ? ` · about ${step.etaSeconds} s left` : ''}` : 'Running…') : step.status === 'passed' ? 'Passed' : step.status === 'skipped' ? 'Skipped' : 'Failed'}{step.reason ? <small>{step.reason}</small> : null}{step.promptSeconds ? <small>Full prompt in {step.promptSeconds} s</small> : null}{step.promptPerSecond ? <small>Read the prompt at {tokens(step.promptPerSecond)} tokens/s (answers generate far slower)</small> : null}{step.minAvailableGib != null ? <small>Lowest free memory {step.minAvailableGib} GiB</small> : null}</td>
          <td>{step.seconds != null ? `${step.seconds}s` : ''}</td></tr>)}</tbody></table></div>}
      {mine.status === 'running' && <button className="popup-tab" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Cancel calibration'}</button>}
    </div>}
    {!running && <>
      <label className="native-calibration-budget">Longest acceptable wait for a full prompt
        <select value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))}>
          <option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option>
        </select>
        <small>Sizes that take longer than this to fill are treated as too large, even if they load.</small>
      </label>
      <label className="native-profile-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>Chat pauses for everyone while this runs. I have stopped Diary background jobs and other programs that use the model server.</label>
      <button className="popup-tab" disabled={busy || !confirmed} onClick={() => void start()}>{busy ? 'Starting…' : 'Start calibration'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
