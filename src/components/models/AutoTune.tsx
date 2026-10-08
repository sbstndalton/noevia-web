import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch, fetchInstalledModels } from '../../api';
import { isSystemModel } from '../../model-system';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';
import { appLocale } from '../../user-preferences';
import { num, pct } from './mm';
import { probeName, specLabel, stuckStatus } from './mm-text';
import { appliedSettings, phaseState } from './guided';
import { Switch } from '../Switch';
import { SegmentedControl } from '../SegmentedControl';

type Step = { id: string; label: string; status: string; reason?: string; generation?: number; promptPerSecond?: number; ctx?: number };
type Extension = { id: string; action: string; why: string; from?: number; to?: number };
type Result = { spec: string; specLabel: string; generation: number; ubatch: number | null; promptPerSecond: number | null;
  extensions: Extension[]; loaded?: boolean; kv?: string; context?: number; acceptance?: number | null;
  /** #1057: the engine rejected bf16, so f16 stood in. */
  kvFallback?: { from: string; to: string; at?: number } };
type TunePhase = { id: string; label: string; status: string; steps: Step[]; value?: Record<string, unknown>; reason?: string };
type Baseline = { reference: string; probes: string[]; skipped: { id: string; reason?: string; answer?: string }[] };
/** #1079: a Long item tunes `base`'s long-context profile (`model` is `<base>-long`). */
type TuneModel = { model: string; status: string; phases: TunePhase[]; result?: Result & { baseline?: Baseline }; error?: string; baseline?: Baseline; base?: string; mode?: string };
type Job = { id: string; model: string; status: string; phase: string; models?: TuneModel[]; error?: string; waiting?: boolean;
  startedAt?: number; log?: { at: number; text: string }[]; queueProgress?: { done: number; total: number };
  queue?: { model: string; status: string; error?: string }[]; steps?: Step[]; result?: Result; restored?: boolean };
type Past = Result & { at: number };
/** #1079: Fast tunes the model's own settings, Long its `<model>-long` profile; the server's limits. */
type Mode = 'fast' | 'long';
type Modes = Record<Mode, { defaultSeconds: number; maxSeconds: number }>;
const MIN_SECONDS = 15;
const modesFrom = (raw: unknown): Modes | null => {
  const ok = (m: unknown) => !!m && typeof m === 'object' && Number.isInteger((m as { defaultSeconds: number }).defaultSeconds) && Number.isInteger((m as { maxSeconds: number }).maxSeconds);
  return raw && typeof raw === 'object' && ok((raw as Modes).fast) && ok((raw as Modes).long) ? raw as Modes : null;
};

// The keys stay llama.cpp's own; the drafting label and the numbers follow the interface language.
const savedSummary = (t: Translate, value: Record<string, unknown>) => value.applied && value.values && typeof value.values === 'object'
  ? Object.entries(value.values as Record<string, unknown>).map(([key, item]) => key + ' ' + (typeof item === 'number' ? num(item) : String(item))).join(' · ')
  : Object.entries(value)
  .filter(([key]) => ['kv', 'context', 'specLabel', 'ubatch', 'batch', 'generation', 'promptPerSecond', 'acceptance'].includes(key))
  .map(([key, item]) => key + ' ' + (key === 'specLabel' ? specLabel(t, typeof value.spec === 'string' ? value.spec : undefined, String(item))
    : typeof item === 'number' ? num(item) : String(item))).join(' · ');

const PHASE_STATE: Record<string, MessageKey> = { 'not-applied': 'mm.autotune.notApplied', skipped: 'mm.autotune.skippedStep' };
const phaseText = (t: Translate, state: string) => (PHASE_STATE[state] ? t(PHASE_STATE[state]) : stuckStatus(t, state));
const REFERENCE: Record<string, MessageKey> = { f16: 'mm.autotune.reference.f16', bf16: 'mm.autotune.reference.bf16', current: 'mm.autotune.reference.current' };
/** #1057: the model's own tune settings as the server reports them; null when it has none. */
type TuneSettings = { allowQ5Kv: boolean };
const settingsFrom = (raw: unknown): TuneSettings | null =>
  raw && typeof raw === 'object' && typeof (raw as TuneSettings).allowQ5Kv === 'boolean' ? { allowQ5Kv: (raw as TuneSettings).allowQ5Kv } : null;
/** #328: which probes this model's own baseline made count, and which it made moot. */
function BaselineNote({ baseline }: { baseline: Baseline }): JSX.Element {
  const t = useT();
  return <div className="mm-note mm-autotune-baseline" role="note">
    <p>{t('mm.autotune.baseline', { reference: REFERENCE[baseline.reference] ? t(REFERENCE[baseline.reference]) : baseline.reference })}</p>
    {baseline.skipped.length > 0 && <ul className="mm-hints">{baseline.skipped.map(s => <li key={s.id}>{s.answer
      ? t('mm.autotune.baselineSkippedAnswer', { probe: probeName(t, s.id), answer: s.answer })
      : t('mm.autotune.baselineSkipped', { probe: probeName(t, s.id) })}</li>)}</ul>}
  </div>;
}

/** A server-owned tune, for one model or all untuned chat models. */
export function AutoTune({ model = '', onChanged }: { model?: string; onChanged: () => void }): JSX.Element {
  const t = useT();
  const tRef = useRef(t); tRef.current = t;
  const [job, setJob] = useState<Job | null>(null), [history, setHistory] = useState<Past[]>([]);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [scan, setScan] = useState<{ models: string[]; skipped: { model: string; reason: string }[] } | null>(null);
  const done = useRef(''), request = useRef(0), scanRequest = useRef(0), mutating = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  const [statusError, setStatusError] = useState('');
  // #1057: "Allow q5 KV cache for more context", per model; shown only when the server has it.
  const [tuneSettings, setTuneSettings] = useState<TuneSettings | null>(null), [savingSettings, setSavingSettings] = useState(false), [settingsError, setSettingsError] = useState('');
  // A save in flight wins over the status poll; the counter drops replies from an earlier model.
  const settingsRequest = useRef(0), savingRef = useRef(false);
  // #551: served model names, or null when unknown. A run whose models are all uninstalled is history.
  const [installedNames, setInstalledNames] = useState<string[] | null>(null);
  // #1079: Fast or Long, and the prompt time limit for the next tune (shown when the server has modes).
  const [modes, setModes] = useState<Modes | null>(null), [mode, setMode] = useState<Mode>('fast');
  const [seconds, setSeconds] = useState<Record<Mode, string>>({ fast: '', long: '' });
  const [longId, setLongId] = useState(''), [longHistory, setLongHistory] = useState<Past[]>([]);
  const refreshScan = useCallback(async () => {
    if (model) return;
    const current = ++scanRequest.current;
    try {
      const r = await apiFetch('/api/models/autotune/untuned'), v = await r.json();
      if (current !== scanRequest.current) return;
      if (!r.ok) throw Error(v.error || tRef.current('mm.autotune.scanUnavailable'));
      setScan(v);
    } catch (e) {
      if (current === scanRequest.current) setError(e instanceof Error ? e.message : tRef.current('mm.autotune.scanUnavailable'));
    }
  }, [model]);
  const refresh = useCallback(async (notify = false) => {
    if (mutating.current) return;
    const current = ++request.current;
    // #1061: a poll sent before a save answers from before it; only its settings are dropped.
    const settingsAt = settingsRequest.current;
    try {
      const r = await apiFetch('/api/models/autotune?model=' + encodeURIComponent(model)), v = await r.json();
      if (current !== request.current) return;
      if (!r.ok) throw Error(v.error || tRef.current('mm.autotune.statusUnavailable'));
      const next = (v.job || null) as Job | null;
      setJob(next); setHistory(Array.isArray(v.history) ? v.history : []); setStatusError('');
      const m = modesFrom(v.modes);
      setModes(m); setLongId(typeof v.longId === 'string' ? v.longId : ''); setLongHistory(Array.isArray(v.longHistory) ? v.longHistory : []);
      if (m) setSeconds(prev => ({ fast: prev.fast || String(m.fast.defaultSeconds), long: prev.long || String(m.long.defaultSeconds) }));
      if (model && !savingRef.current && settingsAt === settingsRequest.current) setTuneSettings(settingsFrom(v.settings));
      if (notify && next && next.status !== 'running' && done.current !== next.id) {
        done.current = next.id; changed.current(); void refreshScan();
      }
    } catch (e) {
      if (current === request.current) setStatusError(e instanceof Error ? e.message : tRef.current('mm.autotune.statusUnavailable'));
    }
  }, [model, refreshScan]);
  useEffect(() => {
    done.current = ''; mutating.current = false;
    setJob(null); setHistory([]); setScan(null); setConfirmed(false); setBusy(false); setError(''); setStatusError('');
    setTuneSettings(null); setSavingSettings(false); setSettingsError(''); savingRef.current = false;
    setModes(null); setMode('fast'); setSeconds({ fast: '', long: '' }); setLongId(''); setLongHistory([]);
    void refresh(); void refreshScan();
    let live = true;
    fetchInstalledModels().then((v) => { if (live) setInstalledNames(v.map((m) => m.name)); }).catch(() => { if (live) setInstalledNames(null); });
    return () => { live = false; ++request.current; ++scanRequest.current; ++settingsRequest.current; savingRef.current = false; };
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
      if (!r.ok) throw Error(v.error || t('mm.autotune.requestFailed'));
      if (path.endsWith('/resume')) done.current = '';
      setJob(v);
    } catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : t('mm.autotune.requestFailed')); }
    finally { if (current === request.current) { mutating.current = false; setBusy(false); } }
  };
  // Saves the switch and shows what the server saved; a failure leaves the saved state showing.
  const saveSettings = async (allowQ5Kv: boolean) => {
    const current = ++settingsRequest.current;
    savingRef.current = true; setSavingSettings(true); setSettingsError('');
    try {
      const r = await apiFetch('/api/models/autotune/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, allowQ5Kv }) });
      const v = await r.json().catch(() => ({}));
      if (current !== settingsRequest.current) return;
      if (!r.ok) throw Error(v.error || t('mm.autotune.allowQ5Failed'));
      setTuneSettings(settingsFrom(v.settings));
    } catch (e) { if (current === settingsRequest.current) setSettingsError(e instanceof Error ? e.message : t('mm.autotune.allowQ5Failed')); }
    finally { if (current === settingsRequest.current) { savingRef.current = false; setSavingSettings(false); } }
  };
  // #1079: a Long item belongs to its model's page (its id is the model's long-context profile).
  const ofModel = (item: TuneModel) => item.model === model || item.base === model;
  const mine = job && (!model || (job.models?.some(ofModel) ?? job.model === model)) ? job : null;
  const other = model && job && !(job.models?.some(ofModel) ?? job.model === model) && running;
  const shownModels = (mine?.models || []).filter(item => !model || ofModel(item));
  const last = history[0];
  const progress = appliedSettings(shownModels);
  const resumable = !!mine?.models && ['cancelled', 'interrupted', 'failed'].includes(mine.status)
    && (!installedNames || mine.models.some(item => installedNames.includes(item.model) || (!!item.base && installedNames.includes(item.base))));
  // #1060: as the server does, locked while this model is in a running or resumable job.
  const ownRun = !!model && !!job && (running || ['cancelled', 'interrupted', 'failed'].includes(job.status))
    && (job.models ? job.models.some(item => ofModel(item) && item.status !== 'passed') : job.model === model);
  const options = !!model && tuneSettings && <div className="mm-autotune-option">
    <div className="mm-autotune-option-text">
      <span className="mm-autotune-option-label">{t('mm.autotune.allowQ5')}</span>
      <small>{t('mm.autotune.allowQ5Help')}{ownRun ? ' ' + t('mm.autotune.allowQ5Locked') : ''}</small>
    </div>
    <Switch label={t('mm.autotune.allowQ5')} checked={tuneSettings.allowQ5Kv} disabled={savingSettings || ownRun} onChange={(on) => void saveSettings(on)}/>
    {settingsError && <p role="alert" className="modal-err">{settingsError}</p>}
  </div>;
  // #1079: the mode and its time limit, for one model on a server that has modes.
  const pick = !!model && !!modes;
  const max = modes ? modes[mode].maxSeconds : 1800;
  const limit = Number(seconds[mode]);
  const limitOk = !pick || (/^\d+$/.test(seconds[mode].trim()) && limit >= MIN_SECONDS && limit <= max);
  const modeChoice = pick && !running && <div className="mm-autotune-mode">
    <div className="mm-autotune-option-text">
      <span className="mm-autotune-option-label" id="mm-autotune-mode-label">{t('mm.autotune.mode')}</span>
      <small>{mode === 'long' ? t('mm.autotune.modeLongHelp', { id: longId || model + '-long' }) : t('mm.autotune.modeFastHelp')}</small>
    </div>
    <SegmentedControl<Mode> label={t('mm.autotune.mode')} value={mode} onChange={setMode}
      options={[['fast', t('mm.autotune.modeFast')], ['long', t('mm.autotune.modeLong')]]}/>
    <label className="mm-field mm-autotune-limit">
      <span>{t('mm.autotune.timeLimit')}</span>
      <input className="modal-input" type="number" inputMode="numeric" min={MIN_SECONDS} max={max} step={1} value={seconds[mode]}
        aria-invalid={!limitOk || undefined} aria-describedby="mm-autotune-limit-help"
        onChange={(e) => { const value = e.target.value; setSeconds(prev => ({ ...prev, [mode]: value })); }}/>
      <small id="mm-autotune-limit-help">{t('mm.autotune.timeLimitHelp', { min: MIN_SECONDS, max })}</small>
    </label>
    {!limitOk && <p role="alert" className="modal-err">{t('mm.autotune.timeLimitInvalid', { min: MIN_SECONDS, max })}</p>}
  </div>;
  const startBody = () => ({ model, confirmPause: confirmed, untuned: !model, ...(pick ? { mode, promptBudgetSeconds: limit } : {}) });
  const actions = !running && <div className="mm-autotune-actions">
    {modeChoice}
    <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t('mm.autotune.confirm')}</label>
    <div className="mm-actions">
      {resumable && <button className="modal-btn primary" disabled={busy || !confirmed} onClick={() => void mutate('/api/models/autotune/resume', { confirmPause: confirmed })}>{busy ? t('mm.autotune.resuming') : t('mm.autotune.resume')}</button>}
      <button className={'modal-btn ' + (resumable ? 'secondary' : 'primary')} disabled={busy || !confirmed || !limitOk || (!model && !scan?.models.length)} onClick={() => void mutate('/api/models/autotune', startBody())}>{busy ? t('mm.starting') : model ? (pick && mode === 'long' ? t('mm.autotune.applyLong') : t('mm.autotune.apply')) : t('mm.autotune.applyUntuned')}</button>
    </div>
  </div>;
  const lastLong = longHistory[0];
  if (system) return <p className="mm-note" role="status">{t('model.systemLabel')}{t('mm.autotune.systemNote')}</p>;
  return <div className="mm-autotune">
    {options}
    {!model && scan && !running && <p className="mm-note" role="status">{scan.models.length ? t.plural('mm.autotune.needList', scan.models.length, { models: scan.models.join(', ') }) : t('mm.autotune.needNone', { count: 0 })} {t('mm.autotune.skipped', { count: scan.skipped.length })}</p>}
    {lastLong && !running && <p className="mm-note mm-autotune-long-last" role="status">{t('mm.autotune.longLast', { id: longId, date: new Date(lastLong.at).toLocaleString(appLocale()), tokens: lastLong.context != null ? num(lastLong.context, 0) : '', kv: lastLong.kv ?? '' })}</p>}
    {last && !running && <p className="mm-note" role="status">{t('mm.autotune.lastBefore', { date: new Date(last.at).toLocaleString(appLocale()) })}<strong>{specLabel(t, last.spec, last.specLabel)}</strong>{', ' + [t('mm.tokensPerSecond', { rate: num(last.generation) }), ...(last.kv ? [t('mm.tune.kv', { kv: last.kv }), t('mm.tune.context', { tokens: last.context != null ? num(last.context, 0) : '' })] : []), ...(last.ubatch ? [t('mm.autotune.ubatch', { size: last.ubatch })] : [])].join(', ')}.</p>}
    {mine && <div>
      <div className="mm-autotune-status" aria-live="polite">
        <p className="mm-note"><strong>{mine.status === 'running' ? mine.phase : mine.status === 'passed' ? t('mm.autotune.tuned') : mine.status === 'cancelled' ? t('mm.queue.cancelled') : mine.status === 'interrupted' ? t('mm.autotune.interrupted') : t('mm.hw.status.dead')}</strong>{mine.error ? ' — ' + mine.error : ''}</p>
        {mine.queueProgress && <p className="mm-note">{t('mm.autotune.completed', { done: mine.queueProgress.done, total: mine.queueProgress.total })} {running ? t('mm.autotune.now', { model: mine.model }) : ''}</p>}
        {mine.models && <label className="mm-progress"><span className="sr-only">{t('mm.autotune.progress')}</span>
          <progress value={progress.done} max={Math.max(1, progress.total)}/><span aria-hidden="true">{t('mm.autotune.saved', { done: progress.done, total: progress.total })}</span>
        </label>}
        {running && <button className="modal-btn secondary mm-cancel-action" disabled={busy} onClick={() => void mutate('/api/models/autotune/cancel')}>{busy ? t('mm.cancelling') : t('mm.autotune.cancel')}</button>}
      </div>
      {actions}
      {mine.log && mine.log.length > 0 && (running
        ? <ActivityLog lines={mine.log} startedAt={mine.startedAt ?? mine.log[0].at} live/>
        : <details className="mm-activity-details"><summary>{t.plural('mm.autotune.whatItDid', mine.log.length)}</summary>
            <ActivityLog lines={mine.log} startedAt={mine.startedAt ?? mine.log[0].at}/>
          </details>)}
      {!mine.models && <div>
        {mine.queue && <ul className="mm-list" aria-label={t('mm.autotune.queue')}>{mine.queue.map(item => <li key={item.model}>{item.model} · {item.status}{item.error ? ' — ' + item.error : ''}</li>)}</ul>}
        {mine.steps && mine.steps.length > 0 && <div className="mm-table-wrap" role="region" aria-label={t('mm.autotune.steps')} tabIndex={0}><table className="mm-table"><thead><tr><th>{t('mm.bench.test')}</th><th>{t('mm.autotune.state')}</th></tr></thead>
          <tbody>{mine.steps.map((row, index) => <tr key={row.id || index}><td>{row.label}</td><td>{row.reason || row.status}</td></tr>)}</tbody></table></div>}
        {mine.result && <p className="mm-note">{t('mm.autotune.savedResult', { spec: specLabel(t, mine.result.spec, mine.result.specLabel), rate: num(mine.result.generation) })}</p>}
        {mine.status === 'interrupted' && <p className="mm-note">{t('mm.autotune.oldRun')}</p>}
      </div>}
      <div className="mm-autotune-models" aria-label={t('mm.autotune.models')}>{shownModels.map(item => <details key={item.model} className="mm-autotune-model" open={item.status === 'running' || item.status === 'failed' || item.status === 'interrupted'}>
        <summary><strong>{item.model}</strong><span>{item.status}{item.error ? ' — ' + item.error : ''}</span></summary>
        {item.baseline && <BaselineNote baseline={item.baseline}/>}
        <ol className="mm-autotune-phases" aria-label={t('mm.autotune.phases', { model: item.model })}>{item.phases.map(phase => { const summary = phase.value ? savedSummary(t, phase.value) : ''; return <li key={phase.id}>
          <details className="mm-autotune-phase" open={phase.status === 'running' || phase.status === 'failed' || phase.status === 'interrupted'}>
            <summary><strong>{phase.label}</strong><span>{phaseText(t, phaseState(phase))}{phase.reason ? ' — ' + phase.reason : ''}</span>
              {summary && <small>{t('mm.autotune.savedSummary', { summary })}</small>}</summary>
          {phase.steps.length > 0 && <div className="mm-table-wrap" role="region" aria-label={t('mm.autotune.phaseSteps', { model: item.model, phase: phase.label })} tabIndex={0}><table className="mm-table">
            <thead><tr><th>{t('mm.bench.test')}</th><th>{t('mm.autotune.state')}</th><th>{t('mm.autotune.measured')}</th></tr></thead>
            <tbody>{phase.steps.map(row => <tr key={row.id}><td>{row.label}</td><td>{row.status}{row.reason ? ' — ' + row.reason : ''}</td>
              <td className="mm-mono">{row.generation ? t('mm.tokensPerSecond', { rate: num(row.generation) }) : row.promptPerSecond ? t('mm.autotune.promptRate', { rate: num(row.promptPerSecond) }) : row.ctx ? t('mm.tokensCount', { tokens: row.ctx }) : '—'}</td></tr>)}</tbody>
          </table></div>}
          </details>
        </li>; })}</ol>
        {item.result && <div className="mm-easy-result" role="status"><div className="mm-easy-result-text">
          <p>{t('mm.autotune.savedBefore')}<strong>{specLabel(t, item.result.spec, item.result.specLabel)}</strong>{t('mm.autotune.savedAt', { rate: num(item.result.generation) })}{item.result.ubatch ? ', ' + t('mm.autotune.ubatch', { size: item.result.ubatch }) + ' (' + t('mm.autotune.promptRate', { rate: item.result.promptPerSecond ?? '' }) + ')' : ''}.</p>
          <p className="mm-note">{t(item.result.baseline?.skipped.length ? 'mm.autotune.resultNoteSkipped' : 'mm.autotune.resultNote', { kv: item.result.kv ?? '', tokens: item.result.context != null ? num(item.result.context, 0) : '', acceptance: item.result.acceptance == null ? t('mm.autotune.notApplicable') : pct(item.result.acceptance),
            probes: (item.result.baseline?.skipped || []).map(s => probeName(t, s.id)).join(', ') })}</p>
          {item.result.kvFallback?.from === 'bf16' && <p className="mm-note">{t('mm.autotune.kvFallback', { kv: item.result.kvFallback.to })}</p>}
        </div></div>}
      </details>)}</div>
    </div>}
    {other && <p className="mm-note">{t('mm.autotune.otherRunning', { model: job?.model ?? '' })}</p>}
    {!mine && actions}
    {error && <p role="alert" className="modal-err">{error}</p>}
    {statusError && <p role="alert" className="modal-err">{statusError} <button className="modal-btn secondary" disabled={busy} onClick={() => void refresh(running)}>{t('mm.autotune.retryStatus')}</button></p>}
    <details className="mm-autotune-help"><summary>{t('mm.autotune.how')}</summary>
      <p className="mm-note">{t('mm.autotune.how1')}</p>
      <p className="mm-note">{t('mm.autotune.how2')}</p>
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
  const t = useT();
  useEffect(() => {
    const el = box.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return <ol ref={box} className="mm-activity" role="log" aria-label={t('mm.autotune.log')} aria-live={live ? 'polite' : 'off'}
    tabIndex={0}
    onScroll={(e) => { const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
    {lines.map((line, i) => <li key={i} className={line.text.startsWith('— ') ? 'is-heading' : line.text.startsWith('still ') ? 'is-waiting' : undefined}>
      <time>{clock(line.at - startedAt)}</time><span>{line.text}</span>
    </li>)}
    {live && <li className="is-now" aria-hidden="true"><time>{clock(Date.now() - startedAt)}</time><span className="mm-activity-cursor">{t('mm.autotune.working')}</span></li>}
  </ol>;
}
