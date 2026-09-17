import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

type Step = { kind: 'spec' | 'prompt'; id: string; label: string; status: string; reason?: string; score?: number; promptPerSecond?: number; seconds?: number; reused?: boolean;
  workloads?: { workload: string; gen: number; drafted: number; accepted: number }[] };
type Extension = { id: string; action: string; why: string; from?: number; to?: number };
type Result = { spec: string; specLabel: string; generation: number; generationOff: number; gain: number; perWorkload: Record<string, string>;
  ubatch: number | null; promptPerSecond: number | null; extensions: Extension[]; loaded?: boolean };
type Job = { id: string; model: string; status: string; phase: string; steps: Step[]; result?: Result; error?: string; restored?: boolean; resume?: boolean; resumed?: boolean; calibration?: string; extendContext?: boolean;
  progress?: { done: number; total: number; percent: number } };
type Past = Result & { at: number };

const acceptance = (w: { drafted: number; accepted: number }) => (w.drafted ? `${Math.round((w.accepted / w.drafted) * 100)}%` : '—');

/** Measured speed tuning for one model: speculative decoding and micro-batch, then optional context. */
export function AutoTune({ model, onChanged }: { model: string; onChanged: () => void }): JSX.Element {
  const [job, setJob] = useState<Job | null>(null), [history, setHistory] = useState<Past[]>([]);
  const [confirmed, setConfirmed] = useState(false), [extend, setExtend] = useState(true), [fresh, setFresh] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const done = useRef('');
  const refresh = async () => {
    const r = await apiFetch('/api/models/autotune?model=' + encodeURIComponent(model)), v = await r.json();
    if (!r.ok) throw Error(v.error || 'Auto-tune status is unavailable.');
    setJob(v.job || null); setHistory(Array.isArray(v.history) ? v.history : []);
    return v.job as Job | null;
  };
  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Auto-tune status is unavailable.')); }, [model]);
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void refresh().then((next) => { if (next && next.status !== 'running' && done.current !== next.id) { done.current = next.id; onChanged(); } }).catch(() => {}); }, 2000);
    return () => clearInterval(timer);
  }, [running]);
  const start = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/models/autotune', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, confirmPause: confirmed, extendContext: extend, resume: !fresh }) });
      const v = await r.json(); if (!r.ok) throw Error(v.error || 'Auto-tune could not start.'); setJob(v);
    } catch (e) { setError(e instanceof Error ? e.message : 'Auto-tune could not start.'); } finally { setBusy(false); }
  };
  const cancel = async () => { setBusy(true); try { const r = await apiFetch('/api/models/autotune/cancel', { method: 'POST' }); setJob(await r.json()); } finally { setBusy(false); } };
  const mine = job && job.model === model ? job : null;
  const other = job && job.model !== model && running;
  const last = history[0];

  return <div className="mm-autotune">
    <p className="mm-note">Tries speculative decoding (off, MTP drafts, n-gram) and batch sizes on this machine, keeps the fastest setting that gives the same answers, then can measure the longest context that still reads in time.</p>
    {last && !running && <p className="mm-note" role="status">Last tuned {new Date(last.at).toLocaleString()}: <strong>{last.specLabel}</strong>, {last.generation} tokens/s ({last.gain >= 0 ? '+' : ''}{last.gain}% vs off){last.ubatch ? `, micro-batch ${last.ubatch}` : ''}.</p>}
    {mine && <div aria-live="polite">
      <p className="mm-note"><strong>{mine.status === 'running' ? mine.phase : mine.status === 'passed' ? 'Tuned' : mine.status === 'cancelled' ? 'Cancelled' : 'Failed'}</strong>{mine.error ? ` — ${mine.error}` : ''}{mine.restored ? ' The original settings were restored.' : ''}
        {mine.resume && mine.resumed === false ? ' No earlier measurements were reusable, so everything is being measured again.' : ''}</p>
      {mine.progress && <label className="mm-progress">
        <span className="sr-only">Auto-tune progress</span>
        <progress value={mine.progress.percent} max={100}/>
        <span aria-hidden="true">{mine.progress.done} of {mine.progress.total} tests{mine.status === 'cancelled' ? ' — measurements so far are kept; starting again continues from here' : ''}</span>
      </label>}
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
        <p>Saved: <strong>{mine.result.specLabel}</strong> at {mine.result.generation} tokens/s ({mine.result.gain >= 0 ? '+' : ''}{mine.result.gain}% over off){mine.result.ubatch ? `, micro-batch ${mine.result.ubatch} (${mine.result.promptPerSecond} prompt tokens/s)` : ''}.</p>
        {mine.result.extensions.map((e) => <p key={e.id} className="mm-note">{
          e.id === 'context' ? `Context can likely grow from ${(e.from || 0).toLocaleString('en-US')} to about ${(e.to || 0).toLocaleString('en-US')} tokens: ${e.why}.`
            : e.id === 'context-too-large' ? `Context is set to ${(e.from || 0).toLocaleString('en-US')} tokens but only about ${(e.to || 0).toLocaleString('en-US')} can be filled in time: ${e.why}. Measure context to set a size that works.`
              : `Suggested: ${e.why}.`}</p>)}
        {mine.calibration && <p className="mm-note">{mine.calibration === 'started' ? 'Context measurement started; see Measure context below.' : `Context measurement ${mine.calibration}.`}</p>}
      </div></div>}
      {running && <button className="modal-btn secondary" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Cancel auto-tune'}</button>}
    </div>}
    {other && <p className="mm-note">Auto-tune is running for {job?.model}.</p>}
    {!running && <>
      <label className="mm-check"><input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} />Then measure the longest usable context</label>
      <label className="mm-check"><input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />Re-measure everything, ignoring saved progress</label>
      <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Chat pauses for everyone while this runs (about 5–15 minutes). I have stopped Diary background jobs and other programs that use the model server.</label>
      <button className="modal-btn primary" disabled={busy || !confirmed} onClick={() => void start()}>{busy ? 'Starting…' : 'Start auto-tune'}</button>
    </>}
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div>;
}
