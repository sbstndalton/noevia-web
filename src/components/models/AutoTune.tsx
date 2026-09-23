import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

type Step = { kind: string; id: string; label: string; status: string; reason?: string; score?: number; promptPerSecond?: number; seconds?: number; reused?: boolean;
  workloads?: { workload: string; gen: number; drafted: number; accepted: number }[] };
type Extension = { id: string; action: string; why: string; from?: number; to?: number };
type Result = { spec: string; specLabel: string; generation: number; generationOff: number; gain: number; perWorkload: Record<string, string>;
  ubatch: number | null; promptPerSecond: number | null; extensions: Extension[]; loaded?: boolean; kv?: string; context?: number; acceptance?: number | null };
type Job = { id: string; model: string; status: string; phase: string; steps: Step[]; result?: Result; error?: string; restored?: boolean; resume?: boolean; resumed?: boolean; calibration?: string; extendContext?: boolean;
  progress?: { done: number; total: number; percent: number }; startedAt?: number; log?: { at: number; text: string }[];
  queue?: { model: string; status: string; error?: string }[]; queueProgress?: { done: number; total: number } };
type Past = Result & { at: number };

const acceptance = (w: { drafted: number; accepted: number }) => (w.drafted ? `${Math.round((w.accepted / w.drafted) * 100)}%` : '—');

/** A complete, server-owned tune, for one model or all untuned chat models. */
export function AutoTune({ model = '', onChanged }: { model?: string; onChanged: () => void }): JSX.Element {
  const [job, setJob] = useState<Job | null>(null), [history, setHistory] = useState<Past[]>([]);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [scan, setScan] = useState<{ models: string[]; skipped: { model: string; reason: string }[] } | null>(null);
  const done = useRef('');
  const request = useRef(0);
  const scanRequest = useRef(0);
  const mutating = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [statusError, setStatusError] = useState('');
  const refreshScan = useCallback(async () => {
    if (model) return;
    const current = ++scanRequest.current;
    try {
      const r = await apiFetch('/api/models/autotune/untuned'), v = await r.json();
      if (current !== scanRequest.current) return;
      if (!r.ok) throw Error(v.error || 'Untuned models are unavailable.');
      setScan(v);
    } catch (e) {
      if (current === scanRequest.current) setError(e instanceof Error ? e.message : 'Untuned models are unavailable.');
    }
  }, [model]);
  const refresh = useCallback(async (notify = false) => {
    if (mutating.current) return;
    const current = ++request.current;
    try {
      const r = await apiFetch('/api/models/autotune?model=' + encodeURIComponent(model)), v = await r.json();
      if (current !== request.current) return;
      if (!r.ok) throw Error(v.error || 'Auto-tune status is unavailable.');
      const next = (v.job || null) as Job | null;
      setJob(next); setHistory(Array.isArray(v.history) ? v.history : []); setStatusError('');
      if (notify && next && next.status !== 'running' && done.current !== next.id) {
        done.current = next.id;
        changed.current();
        void refreshScan();
      }
    } catch (e) {
      if (current === request.current) setStatusError(e instanceof Error ? e.message : 'Auto-tune status is unavailable.');
    }
  }, [model, refreshScan]);
  useEffect(() => {
    done.current = '';
    mutating.current = false;
    setJob(null); setHistory([]); setScan(null); setConfirmed(false); setBusy(false); setError(''); setStatusError('');
    void refresh();
    void refreshScan();
    return () => { ++request.current; ++scanRequest.current; };
  }, [model, refresh, refreshScan]);
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => { void refresh(true); }, 1000);
    return () => clearInterval(timer);
  }, [running, busy, refresh]);
  const start = async () => {
    const current = ++request.current;
    mutating.current = true;
    setBusy(true); setError(''); setStatusError('');
    try {
      const r = await apiFetch('/api/models/autotune', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, confirmPause: confirmed, untuned: !model }) });
      const v = await r.json();
      if (current !== request.current) return;
      if (!r.ok) throw Error(v.error || 'Auto-tune could not start.');
      setJob(v);
    } catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : 'Auto-tune could not start.'); }
    finally { if (current === request.current) { mutating.current = false; setBusy(false); } }
  };
  const cancel = async () => {
    const current = ++request.current;
    mutating.current = true;
    setBusy(true); setError(''); setStatusError('');
    try {
      const r = await apiFetch('/api/models/autotune/cancel', { method: 'POST' }); const v = await r.json();
      if (current !== request.current) return;
      if (!r.ok) throw Error(v.error || 'Cancellation failed.');
      setJob(v);
    } catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : 'Cancellation failed.'); }
    finally { if (current === request.current) { mutating.current = false; setBusy(false); } }
  };
  const mine = job && (!model || job.model === model) ? job : null;
  const other = model && job && job.model !== model && running;
  const last = history[0];

  return <div className="mm-autotune">
    <p className="mm-note">Measures context, KV cache (f16, q8, q4), three MTP draft settings, n-gram and batch sizes. Applies the fastest complete profile that passes three quality probes and long-context recall. Draft acceptance of 60–70% is a target, not a pass requirement: measured speed decides.</p>
    <p className="mm-note">These are smoke tests, not a guarantee of quality for every task. Each context test has a 120-second prompt budget; the full run may take considerably longer.</p>
    {!model && scan && !running && <p className="mm-note" role="status">{scan.models.length} model{scan.models.length === 1 ? '' : 's'} need tuning{scan.models.length ? `: ${scan.models.join(', ')}` : '.'} {scan.skipped.length} skipped (already tuned or not configured for chat).</p>}
    {last && !running && <p className="mm-note" role="status">Last tuned {new Date(last.at).toLocaleString()}: <strong>{last.specLabel}</strong>, {last.generation} tokens/s{last.kv ? `, ${last.kv} KV, ${last.context?.toLocaleString()} context` : ` (${last.gain >= 0 ? '+' : ''}${last.gain}% vs off)`}{last.ubatch ? `, micro-batch ${last.ubatch}` : ''}.</p>}
    {mine && <div aria-live="polite">
      {mine.queue && <ul className="mm-list" aria-label="Auto-tune queue">{mine.queue.map(item => <li key={item.model}><span>{item.model}<small>{item.status}{item.error ? ` — ${item.error}` : ''}</small></span></li>)}</ul>}
      {mine.queueProgress && <p className="mm-note">Models completed: {mine.queueProgress.done} of {mine.queueProgress.total}. {running ? `Now tuning ${mine.model}.` : ''}</p>}
      <p className="mm-note"><strong>{mine.status === 'running' ? mine.phase : mine.status === 'passed' ? 'Tuned' : mine.status === 'cancelled' ? 'Cancelled' : 'Failed'}</strong>{mine.error ? ` — ${mine.error}` : ''}{mine.restored ? ' The original settings were restored.' : ''}
        {mine.resume && mine.resumed === false ? ' No earlier measurements were reusable, so everything is being measured again.' : ''}</p>
      {mine.progress && <label className="mm-progress">
        <span className="sr-only">Auto-tune progress</span>
        <progress value={mine.progress.percent} max={100}/>
        <span aria-hidden="true">{mine.progress.percent}% of this model{mine.status === 'cancelled' ? ' — start again to remeasure' : ''}</span>
      </label>}
      {running && <button className="modal-btn secondary mm-cancel-action" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Cancel auto-tune'}</button>}
      {mine.log && mine.log.length > 0 && (running
        ? <ActivityLog lines={mine.log} startedAt={mine.startedAt ?? mine.log[0].at} live/>
        : <details className="mm-activity-details"><summary>What it did ({mine.log.length} lines)</summary>
            <ActivityLog lines={mine.log} startedAt={mine.startedAt ?? mine.log[0].at}/>
          </details>)}
      {mine.steps.length > 0 && <div className="mm-table-wrap" role="region" aria-label="Auto-tune steps" tabIndex={0}><table className="mm-table">
        <thead><tr><th>Test</th><th>Result</th><th>Tokens/s</th><th>Drafts accepted</th></tr></thead>
        <tbody>{mine.steps.map((s, i) => <tr key={i}>
          <td>{s.label}</td>
          <td>{s.status === 'measured' ? (s.reused ? 'measured earlier' : 'measured') : s.reason || s.status}</td>
          <td className="mm-mono">{s.kind === 'spec' ? (s.score ?? '—') : (s.promptPerSecond ? `${s.promptPerSecond} prompt` : '—')}</td>
          <td className="mm-mono">{s.workloads ? s.workloads.map((w) => `${w.workload} ${acceptance(w)}`).join(' · ') : '—'}</td>
        </tr>)}</tbody>
      </table></div>}
      {mine.result && <div className="mm-easy-result" role="status"><div className="mm-easy-result-text">
        <p>Saved: <strong>{mine.result.specLabel}</strong> at {mine.result.generation} tokens/s{!mine.result.kv ? ` (${mine.result.gain >= 0 ? '+' : ''}${mine.result.gain}% over off)` : ''}{mine.result.ubatch ? `, micro-batch ${mine.result.ubatch} (${mine.result.promptPerSecond} prompt tokens/s)` : ''}.</p>
        {mine.result.kv && <p className="mm-note">KV cache: {mine.result.kv}. Context: {mine.result.context?.toLocaleString()} tokens. Draft acceptance: {mine.result.acceptance == null ? 'not applicable' : `${mine.result.acceptance}%`}. All three quality probes passed.</p>}
        {mine.result.extensions.map((e) => <p key={e.id} className="mm-note">{
          e.id === 'context' ? `Context can likely grow from ${(e.from || 0).toLocaleString('en-US')} to about ${(e.to || 0).toLocaleString('en-US')} tokens: ${e.why}.`
            : e.id === 'context-too-large' ? `Context is set to ${(e.from || 0).toLocaleString('en-US')} tokens but only about ${(e.to || 0).toLocaleString('en-US')} can be filled in time: ${e.why}. Measure context to set a size that works.`
              : `Suggested: ${e.why}.`}</p>)}
        {mine.calibration && <p className="mm-note">{mine.calibration === 'started' ? 'Context measurement started; see Measure context below.' : `Context measurement ${mine.calibration}.`}</p>}
      </div></div>}
    </div>}
    {other && <p className="mm-note">Auto-tune is running for {job?.model}.</p>}
    {!running && <>
      <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Chat pauses for everyone while this runs. I have stopped Diary background jobs and other programs that use the model server.</label>
      <button className="modal-btn primary" disabled={busy || !confirmed || (!model && !scan?.models.length)} onClick={() => void start()}>{busy ? 'Starting…' : model ? 'Auto-tune and apply' : 'Tune untuned models and apply'}</button>
    </>}
    {error && <p role="alert" className="modal-err">{error}</p>}
    {statusError && <p role="alert" className="modal-err">{statusError} <button className="modal-btn secondary" disabled={busy} onClick={() => void refresh(running)}>Retry status</button></p>}
  </div>;
}

const clock = (ms: number) => { const total = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

/**
 * What auto-tune is doing right now, line by line. A run is minutes of a progress bar that can
 * sit still for a whole minute while the engine loads; without this, a person watching sees a
 * frozen screen and reasonably concludes nothing is happening.
 *
 * It follows the newest line unless the reader has scrolled up to look at an older one.
 */
function ActivityLog({ lines, startedAt, live = false }: { lines: { at: number; text: string }[]; startedAt: number; live?: boolean }): JSX.Element {
  const box = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return <ol ref={box} className="mm-activity" role="log" aria-label="What auto-tune is doing" aria-live={live ? 'polite' : 'off'}
    tabIndex={0}
    onScroll={(e) => { const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
    {lines.map((line, i) => <li key={i} className={line.text.startsWith('— ') ? 'is-heading' : line.text.startsWith('still ') ? 'is-waiting' : undefined}>
      <time>{clock(line.at - startedAt)}</time><span>{line.text}</span>
    </li>)}
    {live && <li className="is-now" aria-hidden="true"><time>{clock(Date.now() - startedAt)}</time><span className="mm-activity-cursor">working</span></li>}
  </ol>;
}
