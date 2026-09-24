import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import type { InstalledModel } from '../../types';
import { isSystemModel, SYSTEM_MODEL_LABEL } from '../../model-system';
import { EvidenceList } from './EvidenceList';
import { ctxShort } from './mm';
import type { EstimateInputs, Hardware, Verdict } from './guided';
import { belowKvFloor, budgetFor, canPromptSuite, estimateGib, KV_FLOOR, KV_GUIDED, recommend, ROLE_LABEL, roleOf, TUNE_STEPS, tuneMinutes, verdictFor } from './guided';

const VERDICT: Record<Verdict, string> = { fits: 'Fits', tight: 'Tight fit', no: 'Does not fit' };
type TuneStatus = { job: { model?: string; status?: string; error?: string; models?: { model: string; status: string; error?: string }[] } | null; history: { at: number; kv?: string; context?: number; specLabel?: string; generation?: number }[] };

async function getJson<T>(path: string): Promise<T> {
  const r = await apiFetch(path); const v = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error((v as { error?: string }).error || `Request failed (${r.status})`), { status: r.status });
  return v as T;
}

/** The guided path for one model (#204): estimate, then full auto-tune, then quality. Each step
 *  says whether it only measures or writes settings; nothing here starts a run by itself. */
export function GuidedOptimize({ model, installed, onOpenTab }: { model: string; installed?: InstalledModel; onOpenTab: (tab: 'benchmarks' | 'hardware') => void }): JSX.Element {
  const role = roleOf(model, installed?.labels || []);
  if (isSystemModel(model)) return <section className="mm-panel mm-guided" aria-label="Optimize this model">
    <p className="mm-note" role="status">{SYSTEM_MODEL_LABEL} — used internally for message routing; it is not estimated, tuned or calibrated here.</p>
  </section>;
  return <section className="mm-panel mm-guided" aria-label="Optimize this model">
    <div className="mm-panel-head"><h3>Optimize this model</h3><span className="mm-pill">{ROLE_LABEL[role]}</span></div>
    <p className="mm-note">Three optional steps. Each says whether it only measures or changes settings. Detailed llama.cpp fields stay in Advanced below.</p>
    <ol className="mm-guided-steps">
      <li><FitStep model={model}/></li>
      <li><TuneStep model={model} sizeGB={installed?.sizeGB ?? null} chat={canPromptSuite(role)}/></li>
      <li><QualityStep model={model} chat={canPromptSuite(role)} onOpenTab={onOpenTab}/></li>
    </ol>
  </section>;
}

function FitStep({ model }: { model: string }): JSX.Element {
  const [inputs, setInputs] = useState<EstimateInputs | null>(null), [hw, setHw] = useState<Hardware | null>(null);
  const [error, setError] = useState(''), [ctx, setCtx] = useState(0), [kv, setKv] = useState('q8_0'), [manual, setManual] = useState('');
  useEffect(() => {
    let live = true; setInputs(null); setError('');
    getJson<EstimateInputs>('/api/models/estimate?model=' + encodeURIComponent(model)).then((v) => {
      if (!live) return; setInputs(v);
      setCtx(v.current.ctx || v.rows.find((r) => r.ctx >= 16384)?.ctx || v.rows[0]?.ctx || 0);
      if (v.current.kv && v.current.kv in { f16: 1, q8_0: 1, q5_1: 1, q5_0: 1, q4_0: 1 }) setKv(v.current.kv);
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'The estimate is unavailable.'); });
    getJson<Hardware>('/api/models/hardware').then((v) => { if (live) setHw(v); }).catch(() => undefined);
    return () => { live = false; };
  }, [model]);
  const budget = useMemo(() => { const n = Number(manual); return n > 0 ? { gib: n, source: 'the figure you entered' } : budgetFor(inputs?.budgetGib, hw); }, [manual, inputs, hw]);
  const est = inputs && ctx ? estimateGib(inputs, ctx, kv) : null;
  const verdict = est && budget ? verdictFor(est.totalGib, budget.gib) : null;
  const rec = inputs && budget ? recommend(inputs, budget.gib, ctx) : null;
  return <div className="mm-guided-step">
    <h4><span className="mm-step-n" aria-hidden="true">1</span>Will it fit? <small>Estimate only · nothing is loaded or saved</small></h4>
    {error && <p className="mm-note" role="status">{error} Use Measure context below to test the real engine instead.</p>}
    {!inputs && !error && <p className="mm-note" role="status">Reading the model file…</p>}
    {inputs && inputs.rows.length > 0 && <div className="mm-form mm-fit-form">
      <label>Context<select value={ctx} onChange={(e) => setCtx(Number(e.target.value))}>
        {inputs.rows.map((r) => <option key={r.ctx} value={r.ctx}>{ctxShort(r.ctx)} tokens{r.ctx === inputs.current.ctx ? ' (current)' : ''}</option>)}
      </select></label>
      <label>KV cache<select value={kv} onChange={(e) => setKv(e.target.value)}>
        {KV_GUIDED.map((k) => <option key={k} value={k}>{k}{k === inputs.current.kv ? ' (current)' : ''}</option>)}
        <option value="q4_0">q4_0 · below the Q5 floor{inputs.current.kv === 'q4_0' ? ' (current)' : ''}</option>
      </select></label>
      <label>Memory to fit in (GiB)<input inputMode="decimal" value={manual} placeholder={budget ? String(budget.gib) : 'e.g. 16'} onChange={(e) => setManual(e.target.value.replace(/[^\d.]/g, ''))}/></label>
    </div>}
    {est && budget && verdict && <div className="mm-fit" data-verdict={verdict} role="status">
      <strong className="mm-fit-verdict">{VERDICT[verdict]}</strong>
      <span>About <strong>{est.totalGib} GiB</strong> of {budget.gib} GiB ({budget.source}).</span>
      <small>Model {inputs!.modelGib} GiB · KV cache {est.kvGib} GiB{inputs!.pinnedGib ? ` · vision projector ${inputs!.pinnedGib} GiB` : ''} · runtime reserve {inputs!.reserveGib} GiB · plus a 5% margin. One conversation slot.</small>
    </div>}
    {inputs && !budget && <p className="mm-note" role="status">This server reports no memory figure. Enter how much memory the engine may use to see a verdict.</p>}
    {belowKvFloor(kv) && <p className="mm-note mm-warn" role="note">q4_0 is below the {KV_FLOOR} floor for automatic choices (#190): it fits more context but noticeably lowers answer quality. Existing q4_0 settings keep working until you change them.</p>}
    {rec && <p className={'mm-note' + (rec.kind === 'smaller' ? ' mm-warn' : '')}><strong>Recommendation:</strong> {rec.text}{rec.kind === 'use' && (rec.ctx !== ctx || rec.kv !== kv) ? <> <button type="button" className="mm-guided-link" onClick={() => { setCtx(rec.ctx); setKv(rec.kv); }}>Show this</button></> : null}</p>}
    {inputs?.rows.length ? <p className="mm-note">Estimates can be off by a few percent. To save a context, use <em>Tune for this machine</em> or step 2, which measure on the real engine.</p> : null}
  </div>;
}

function TuneStep({ model, sizeGB, chat }: { model: string; sizeGB: number | null; chat: boolean }): JSX.Element {
  const [status, setStatus] = useState<TuneStatus | null>(null);
  useEffect(() => {
    let live = true;
    getJson<TuneStatus>('/api/models/autotune?model=' + encodeURIComponent(model)).then((v) => { if (live) setStatus(v); }).catch(() => undefined);
    return () => { live = false; };
  }, [model]);
  const time = tuneMinutes(sizeGB);
  const last = status?.history?.[0];
  const mine = status?.job && (status.job.models?.find((m) => m.model === model) || (status.job.model === model ? status.job : null));
  const failed = mine && ['failed', 'interrupted', 'cancelled'].includes(String(mine.status));
  const goTune = () => {
    const box = document.querySelector<HTMLDetailsElement>('.mm-easy-autotune');
    if (box) { box.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };
  if (!chat) return <div className="mm-guided-step"><h4><span className="mm-step-n" aria-hidden="true">2</span>Full auto-tune</h4><p className="mm-note">Auto-tune measures chat answers, so it does not apply to embedding or reranking models.</p></div>;
  return <div className="mm-guided-step">
    <h4><span className="mm-step-n" aria-hidden="true">2</span>Full auto-tune <small>Measures, then applies each setting as it passes</small></h4>
    <p className="mm-note">Expected time: about {time.low}–{time.high} minutes for this model{sizeGB ? ` (${sizeGB.toFixed(1)} GB file)` : ''}. <strong>Chat pauses</strong> while it runs; stop Diary background jobs first. You can cancel at any point and resume later.</p>
    <ol className="mm-preflight">{TUNE_STEPS.map((s) => <li key={s.id}><strong>{s.label}</strong> — {s.what}</li>)}</ol>
    <p className="mm-note mm-warn" role="note">Q5 floor (#190): the goal is never to choose a KV cache below {KV_FLOOR} automatically. This build's auto-tune still tries f16, q8_0 and q4_0; if it picks q4_0, set q5_0 or higher under KV cache below.</p>
    {last && <p className="mm-note">Last tuned {new Date(last.at).toLocaleDateString()}: {last.specLabel || 'saved'}{last.generation ? `, ${last.generation} tokens/s` : ''}{last.kv ? `, ${last.kv} KV` : ''}{last.context ? `, ${last.context.toLocaleString('en-US')} context` : ''}.{belowKvFloor(last.kv) ? ' This KV cache is below the Q5 floor.' : ''}</p>}
    {failed && <p className="mm-note mm-warn" role="status">The last run {String(mine!.status)}{mine!.error ? `: ${mine!.error}` : ''}. The settings saved before it stay active{last ? ' (last known-good result above)' : ''}, so chat still works. Resume or retry it below, or keep the current settings.</p>}
    <div className="mm-actions"><button type="button" className="modal-btn secondary" onClick={goTune}>Go to Auto-tune and apply</button></div>
  </div>;
}

function QualityStep({ model, chat, onOpenTab }: { model: string; chat: boolean; onOpenTab: (tab: 'benchmarks' | 'hardware') => void }): JSX.Element {
  return <div className="mm-guided-step">
    <h4><span className="mm-step-n" aria-hidden="true">3</span>Quality <small>Measures only</small></h4>
    <EvidenceList model={model}/>
    {chat
      ? <p className="mm-note">Run the prompt suite on fixed tasks to compare this model with the others. <button type="button" className="mm-guided-link" onClick={() => onOpenTab('benchmarks')}>Open Benchmarks</button></p>
      : <p className="mm-note">The prompt suite sends chat prompts, so it is limited to chat models.</p>}
  </div>;
}
