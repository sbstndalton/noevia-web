import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { isSystemModel, SYSTEM_MODEL_LABEL } from '../../model-system';

type Step = { id: string; label: string; status: string; reason?: string; generation?: number; promptPerSecond?: number; ctx?: number };
type Extension = { id: string; action: string; why: string; from?: number; to?: number };
type Result = { spec: string; specLabel: string; generation: number; ubatch: number | null; promptPerSecond: number | null;
  extensions: Extension[]; loaded?: boolean; kv?: string; context?: number; acceptance?: number | null };
type TunePhase = { id: string; label: string; status: string; steps: Step[]; value?: Record<string, unknown>; reason?: string };
type TuneModel = { model: string; status: string; phases: TunePhase[]; result?: Result; error?: string };
type Job = { id: string; model: string; status: string; phase: string; models?: TuneModel[]; error?: string; waiting?: boolean;
  startedAt?: number; log?: { at: number; text: string }[]; queueProgress?: { done: number; total: number };
  queue?: { model: string; status: string; error?: string }[]; steps?: Step[]; result?: Result; restored?: boolean };
type Past = Result & { at: number };

const savedSummary = (value: Record<string, unknown>) => Object.entries(value)
  .filter(([key]) => ['kv', 'context', 'specLabel', 'ubatch', 'batch', 'generation', 'promptPerSecond', 'acceptance'].includes(key))
  .map(([key, item]) => key + ' ' + String(item)).join(' · ');

/** A server-owned tune, for one model or all untuned chat models. */
export function AutoTune({ model = '', onChanged }: { model?: string; onChanged: () => void }): JSX.Element {
  const [job, setJob] = useState<Job | null>(null), [history, setHistory] = useState<Past[]>([]);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [scan, setScan] = useState<{ models: string[]; skipped: { model: string; reason: string }[] } | null>(null);
  const done = useRef(''), request = useRef(0), scanRequest = useRef(0), mutating = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
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
        done.current = next.id; changed.current(); void refreshScan();
      }
    } catch (e) {
      if (current === request.current) setStatusError(e instanceof Error ? e.message : 'Auto-tune status is unavailable.');
    }
  }, [model, refreshScan]);
  useEffect(() => {
    done.current = ''; mutating.current = false;
    setJob(null); setHistory([]); setScan(null); setConfirmed(false); setBusy(false); setError(''); setStatusError('');
    void refresh(); void refreshScan();
    return () => { ++request.current; ++scanRequest.current; };
  }, [model, refresh, refreshScan]);
  const system = !!model && isSystemModel(model);
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => { void refresh(true); }, 1000);
    return () => clearInterval(timer);
  }, [running, busy, refresh]);
  const mutate = async (path: string, body?: Record<string, unknown>) => {
    const current = ++request.current;
    mutating.current = true; setBusy(true); setError(''); setStatusError('');
    try {
      const r = await apiFetch(path, { method: 'POST', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const v = await r.json();
      if (current !== request.current) return;
      if (!r.ok) throw Error(v.error || 'Auto-tune request failed.');
      if (path.endsWith('/resume')) done.current = '';
      setJob(v);
    } catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : 'Auto-tune request failed.'); }
    finally { if (current === request.current) { mutating.current = false; setBusy(false); } }
  };
  const mine = job && (!model || (job.models?.some(item => item.model === model) ?? job.model === model)) ? job : null;
  const other = model && job && !(job.models?.some(item => item.model === model) ?? job.model === model) && running;
  const shownModels = (mine?.models || []).filter(item => !model || item.model === model);
  const last = history[0];
  const complete = shownModels.reduce((sum, item) => sum + item.phases.filter(phase => phase.status === 'passed').length, 0);
  const resumable = !!mine?.models && ['cancelled', 'interrupted', 'failed'].includes(mine.status);
  const actions = !running && <div className="mm-autotune-actions">
    <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Chat pauses while each model is tuned. I have stopped Diary background jobs and other programs that use the model server.</label>
    <div className="mm-actions">
      {resumable && <button className="modal-btn primary" disabled={busy || !confirmed} onClick={() => void mutate('/api/models/autotune/resume', { confirmPause: confirmed })}>{busy ? 'Resuming…' : 'Resume auto-tune'}</button>}
      <button className={'modal-btn ' + (resumable ? 'secondary' : 'primary')} disabled={busy || !confirmed || (!model && !scan?.models.length)} onClick={() => void mutate('/api/models/autotune', { model, confirmPause: confirmed, untuned: !model })}>{busy ? 'Starting…' : model ? 'Auto-tune and apply' : 'Tune untuned models and apply'}</button>
    </div>
  </div>;
  if (system) return <p className="mm-note" role="status">{SYSTEM_MODEL_LABEL} — used internally for message routing; it fits the system rather than being tuned.</p>;
  return <div className="mm-autotune">
    {!model && scan && !running && <p className="mm-note" role="status">{scan.models.length} model{scan.models.length === 1 ? '' : 's'} need tuning{scan.models.length ? ': ' + scan.models.join(', ') : '.'} {scan.skipped.length} skipped (already tuned or not configured for chat).</p>}
    {last && !running && <p className="mm-note" role="status">Last tuned {new Date(last.at).toLocaleString()}: <strong>{last.specLabel}</strong>, {last.generation} tokens/s{last.kv ? ', ' + last.kv + ' KV, ' + last.context?.toLocaleString() + ' context' : ''}{last.ubatch ? ', micro-batch ' + last.ubatch : ''}.</p>}
    {mine && <div>
      <div className="mm-autotune-status" aria-live="polite">
        <p className="mm-note"><strong>{mine.status === 'running' ? mine.phase : mine.status === 'passed' ? 'Tuned' : mine.status === 'cancelled' ? 'Cancelled' : mine.status === 'interrupted' ? 'Interrupted' : 'Failed'}</strong>{mine.error ? ' — ' + mine.error : ''}</p>
        {mine.queueProgress && <p className="mm-note">Models completed: {mine.queueProgress.done} of {mine.queueProgress.total}. {running ? 'Now tuning ' + mine.model + '.' : ''}</p>}
        {mine.models && <label className="mm-progress"><span className="sr-only">Auto-tune progress</span>
          <progress value={complete} max={Math.max(1, shownModels.length * 4)}/><span aria-hidden="true">{complete} of {shownModels.length * 4} settings saved</span>
        </label>}
        {running && <button className="modal-btn secondary mm-cancel-action" disabled={busy} onClick={() => void mutate('/api/models/autotune/cancel')}>{busy ? 'Cancelling…' : 'Cancel auto-tune'}</button>}
      </div>
      {actions}
      {mine.log && mine.log.length > 0 && (running
        ? <ActivityLog lines={mine.log} startedAt={mine.startedAt ?? mine.log[0].at} live/>
        : <details className="mm-activity-details"><summary>What it did ({mine.log.length} lines)</summary>
            <ActivityLog lines={mine.log} startedAt={mine.startedAt ?? mine.log[0].at}/>
          </details>)}
      {!mine.models && <div>
        {mine.queue && <ul className="mm-list" aria-label="Auto-tune queue">{mine.queue.map(item => <li key={item.model}>{item.model} · {item.status}{item.error ? ' — ' + item.error : ''}</li>)}</ul>}
        {mine.steps && mine.steps.length > 0 && <div className="mm-table-wrap" role="region" aria-label="Auto-tune steps" tabIndex={0}><table className="mm-table"><thead><tr><th>Test</th><th>State</th></tr></thead>
          <tbody>{mine.steps.map((row, index) => <tr key={row.id || index}><td>{row.label}</td><td>{row.reason || row.status}</td></tr>)}</tbody></table></div>}
        {mine.result && <p className="mm-note">Saved: {mine.result.specLabel}, {mine.result.generation} tokens/s.</p>}
        {mine.status === 'interrupted' && <p className="mm-note">This older run cannot resume. Start a new tune after reviewing its settings.</p>}
      </div>}
      <div className="mm-autotune-models" aria-label="Auto-tune models">{shownModels.map(item => <details key={item.model} className="mm-autotune-model" open={item.status === 'running' || item.status === 'failed' || item.status === 'interrupted'}>
        <summary><strong>{item.model}</strong><span>{item.status}{item.error ? ' — ' + item.error : ''}</span></summary>
        <ol className="mm-autotune-phases" aria-label={item.model + ' phases'}>{item.phases.map(phase => <li key={phase.id}>
          <details className="mm-autotune-phase" open={phase.status === 'running' || phase.status === 'failed' || phase.status === 'interrupted'}>
            <summary><strong>{phase.label}</strong><span>{phase.status}{phase.reason ? ' — ' + phase.reason : ''}</span>
              {phase.value && <small>Saved: {savedSummary(phase.value)}</small>}</summary>
          {phase.steps.length > 0 && <div className="mm-table-wrap" role="region" aria-label={item.model + ' ' + phase.label + ' steps'} tabIndex={0}><table className="mm-table">
            <thead><tr><th>Test</th><th>State</th><th>Measured</th></tr></thead>
            <tbody>{phase.steps.map(row => <tr key={row.id}><td>{row.label}</td><td>{row.status}{row.reason ? ' — ' + row.reason : ''}</td>
              <td className="mm-mono">{row.generation ? row.generation + ' tokens/s' : row.promptPerSecond ? row.promptPerSecond + ' prompt tokens/s' : row.ctx ? row.ctx + ' tokens' : '—'}</td></tr>)}</tbody>
          </table></div>}
          </details>
        </li>)}</ol>
        {item.result && <div className="mm-easy-result" role="status"><div className="mm-easy-result-text">
          <p>Saved: <strong>{item.result.specLabel}</strong> at {item.result.generation} tokens/s{item.result.ubatch ? ', micro-batch ' + item.result.ubatch + ' (' + item.result.promptPerSecond + ' prompt tokens/s)' : ''}.</p>
          <p className="mm-note">KV cache: {item.result.kv}. Context: {item.result.context?.toLocaleString()} tokens. Draft acceptance: {item.result.acceptance == null ? 'not applicable' : item.result.acceptance + '%'}. All three quality probes passed.</p>
        </div></div>}
      </details>)}</div>
    </div>}
    {other && <p className="mm-note">Auto-tune is running for {job?.model}.</p>}
    {!mine && actions}
    {error && <p role="alert" className="modal-err">{error}</p>}
    {statusError && <p role="alert" className="modal-err">{statusError} <button className="modal-btn secondary" disabled={busy} onClick={() => void refresh(running)}>Retry status</button></p>}
    <details className="mm-autotune-help"><summary>How automatic tuning works</summary>
      <p className="mm-note">Tunes one model at a time: KV cache, context size, drafting, then batch size. Each measured setting is saved before the next begins. Three quality probes and long-context recall are smoke tests, not a general quality guarantee.</p>
      <p className="mm-note">Chat pauses during each model and becomes available between models. If chat is active, tuning waits for it to finish. Each context test has a 120-second prompt budget.</p>
    </details>
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
