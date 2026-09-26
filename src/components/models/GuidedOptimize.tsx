import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import type { InstalledModel } from '../../types';
import { isSystemModel } from '../../model-system';
import { roundModelSizeGB } from '../../model-size';
import { EvidenceList } from './EvidenceList';
import { ctxShort, num } from './mm';
import type { EstimateInputs, Hardware, Verdict } from './guided';
import { belowKvFloor, budgetFor, canPromptSuite, estimateGib, KV_FLOOR, KV_GUIDED, recommend, roleOf, TUNE_STEPS, tuneMinutes, verdictFor } from './guided';
import type { BudgetKind, Recommendation } from './guided';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';
import { appLocale } from '../../user-preferences';
import { ROLE_KEY, stuckStatus } from './mm-text';

const VERDICT: Record<Verdict, MessageKey> = { fits: 'mm.verdict.fits', tight: 'mm.verdict.tight', no: 'mm.verdict.no' };
const TUNE_STEP: Record<string, [MessageKey, MessageKey]> = {
  kv: ['mm.autoconfig.kv', 'mm.tune.step.kv'], context: ['mm.tune.step.contextLabel', 'mm.tune.step.context'],
  drafting: ['mm.tune.step.draftingLabel', 'mm.tune.step.drafting'], batch: ['mm.tune.step.batchLabel', 'mm.tune.step.batch'],
};
const BUDGET_SOURCE: Record<BudgetKind, MessageKey> = { configured: 'mm.fit.source.configured', gpu: 'mm.fit.source.gpu', 'gpu-shared': 'mm.fit.source.gpuShared', system: 'mm.fit.source.system', manual: 'mm.fit.source.manual' };
/** guided.ts recommend() in the interface language (its `text` is the English original). */
function recommendationText(t: Translate, rec: Recommendation, budgetGib: number): string {
  if (rec.kind === 'use') return t(rec.verdict === 'tight' ? 'mm.fit.rec.useTight' : 'mm.fit.rec.use', { ctx: num(rec.ctx, 0), kv: rec.kv, total: num(rec.totalGib), budget: num(budgetGib) });
  if (rec.kind === 'smaller') return t(rec.moe ? 'mm.fit.rec.smallerMoe' : 'mm.fit.rec.smaller', { floor: num(rec.floorGib), budget: num(budgetGib) });
  return rec.reason === 'not-chat' ? t('mm.fit.rec.notChat') : t('mm.fit.rec.noLayout', { arch: rec.arch || t('mm.fit.unknownArch') });
}
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
  const t = useT();
  if (isSystemModel(model)) return <section className="mm-panel mm-guided" aria-label={t('mm.guided.title')}>
    <p className="mm-note" role="status">{t('model.systemLabel')}{t('mm.guided.systemNote')}</p>
  </section>;
  return <section className="mm-panel mm-guided" aria-label={t('mm.guided.title')}>
    <div className="mm-panel-head"><h3>{t('mm.guided.title')}</h3><span className="mm-pill">{t(ROLE_KEY[role])}</span></div>
    <p className="mm-note">{t('mm.guided.intro')}</p>
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
  const t = useT();
  useEffect(() => {
    let live = true; setInputs(null); setError('');
    getJson<EstimateInputs>('/api/models/estimate?model=' + encodeURIComponent(model)).then((v) => {
      if (!live) return; setInputs(v);
      setCtx(v.current.ctx || v.rows.find((r) => r.ctx >= 16384)?.ctx || v.rows[0]?.ctx || 0);
      if (v.current.kv && v.current.kv in { f16: 1, q8_0: 1, q5_1: 1, q5_0: 1, q4_0: 1 }) setKv(v.current.kv);
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : t('mm.fit.unavailable')); });
    getJson<Hardware>('/api/models/hardware').then((v) => { if (live) setHw(v); }).catch(() => undefined);
    return () => { live = false; };
  }, [model]);
  const budget = useMemo(() => { const n = Number(manual); return n > 0 ? { gib: n, source: 'the figure you entered', kind: 'manual' as const, gpu: undefined } : budgetFor(inputs?.budgetGib, hw); }, [manual, inputs, hw]);
  const est = inputs && ctx ? estimateGib(inputs, ctx, kv) : null;
  const verdict = est && budget ? verdictFor(est.totalGib, budget.gib) : null;
  const rec = inputs && budget ? recommend(inputs, budget.gib, ctx) : null;
  return <div className="mm-guided-step">
    <h4><span className="mm-step-n" aria-hidden="true">1</span>{t('mm.fit.title')} <small>{t('mm.fit.hint')}</small></h4>
    {error && <p className="mm-note" role="status">{error} {t('mm.fit.errorHint')}</p>}
    {!inputs && !error && <p className="mm-note" role="status">{t('mm.readingFile')}</p>}
    {inputs && inputs.rows.length > 0 && <div className="mm-form mm-fit-form">
      <label>{t('mm.easy.context')}<select value={ctx} onChange={(e) => setCtx(Number(e.target.value))}>
        {inputs.rows.map((r) => <option key={r.ctx} value={r.ctx}>{t('mm.tokensCount', { tokens: ctxShort(r.ctx) })}{r.ctx === inputs.current.ctx ? ` ${t('mm.current')}` : ''}</option>)}
      </select></label>
      <label>{t('mm.autoconfig.kv')}<select value={kv} onChange={(e) => setKv(e.target.value)}>
        {KV_GUIDED.map((k) => <option key={k} value={k}>{k}{k === inputs.current.kv ? ` ${t('mm.current')}` : ''}</option>)}
        <option value="q4_0">{t('mm.fit.belowFloorOption')}{inputs.current.kv === 'q4_0' ? ` ${t('mm.current')}` : ''}</option>
      </select></label>
      <label>{t('mm.fit.memory')}<input inputMode="decimal" value={manual} placeholder={budget ? String(budget.gib) : t('mm.fit.memoryPlaceholder')} onChange={(e) => setManual(e.target.value.replace(/[^\d.]/g, ''))}/></label>
    </div>}
    {est && budget && verdict && <div className="mm-fit" data-verdict={verdict} role="status">
      <strong className="mm-fit-verdict">{t(VERDICT[verdict])}</strong>
      <span>{t('mm.fit.aboutBefore')}<strong>{num(est.totalGib)} GiB</strong>{t('mm.fit.aboutAfter', { budget: num(budget.gib), source: t(BUDGET_SOURCE[budget.kind], { gpu: budget.gpu ?? '' }) })}</span>
      <small>{[t('mm.fit.model', { gib: num(inputs!.modelGib) }), t('mm.fit.kv', { gib: num(est.kvGib) }), ...(inputs!.pinnedGib ? [t('mm.fit.projector', { gib: num(inputs!.pinnedGib) })] : []), t('mm.fit.reserve', { gib: num(inputs!.reserveGib) })].join(' · ')}{t('mm.fit.margin')}</small>
    </div>}
    {inputs && !budget && <p className="mm-note" role="status">{t('mm.fit.noMemory')}</p>}
    {belowKvFloor(kv) && <p className="mm-note mm-warn" role="note">{t('mm.fit.belowFloor', { floor: KV_FLOOR })}</p>}
    {rec && budget && <p className={'mm-note' + (rec.kind === 'smaller' ? ' mm-warn' : '')}><strong>{t('mm.fit.recommendation')}</strong> {recommendationText(t, rec, budget.gib)}{rec.kind === 'use' && (rec.ctx !== ctx || rec.kv !== kv) ? <> <button type="button" className="mm-guided-link" onClick={() => { setCtx(rec.ctx); setKv(rec.kv); }}>{t('mm.fit.show')}</button></> : null}</p>}
    {inputs?.rows.length ? <p className="mm-note">{t('mm.fit.accuracyBefore')}<em>{t('mm.easy.tune')}</em>{t('mm.fit.accuracyAfter')}</p> : null}
  </div>;
}

function TuneStep({ model, sizeGB, chat }: { model: string; sizeGB: number | null; chat: boolean }): JSX.Element {
  const [status, setStatus] = useState<TuneStatus | null>(null);
  const t = useT();
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
  if (!chat) return <div className="mm-guided-step"><h4><span className="mm-step-n" aria-hidden="true">2</span>{t('mm.tune.title')}</h4><p className="mm-note">{t('mm.tune.notChat')}</p></div>;
  return <div className="mm-guided-step">
    <h4><span className="mm-step-n" aria-hidden="true">2</span>{t('mm.tune.title')} <small>{t('mm.tune.hint')}</small></h4>
    {/* #443: round through the same shared math every other model-size display uses (this one
        keeps num()'s locale-aware digit formatting on top, rather than the plain string
        formatModelSizeGB returns, since this is embedded in a translated sentence). */}
    <p className="mm-note">{t('mm.tune.time', { low: time.low, high: time.high })}{sizeGB ? ` ${t('mm.tune.fileSize', { size: `${num(roundModelSizeGB(sizeGB), 1)} GB` })}` : ''}. <strong>{t('mm.tune.chatPauses')}</strong>{t('mm.tune.pauseAfter')}</p>
    <ol className="mm-preflight">{TUNE_STEPS.map((s) => <li key={s.id}><strong>{TUNE_STEP[s.id] ? t(TUNE_STEP[s.id][0]) : s.label}</strong> — {TUNE_STEP[s.id] ? t(TUNE_STEP[s.id][1]) : s.what}</li>)}</ol>
    <p className="mm-note mm-warn" role="note">{t('mm.tune.floor', { floor: KV_FLOOR })}</p>
    {last && <p className="mm-note">{t('mm.tune.last', { date: new Date(last.at).toLocaleDateString(appLocale()), result: [last.specLabel || t('mm.tune.saved'), ...(last.generation ? [t('mm.tokensPerSecond', { rate: num(last.generation) })] : []), ...(last.kv ? [t('mm.tune.kv', { kv: last.kv })] : []), ...(last.context ? [t('mm.tune.context', { tokens: num(last.context, 0) })] : [])].join(', ') })}{belowKvFloor(last.kv) ? ` ${t('mm.tune.lastBelowFloor')}` : ''}</p>}
    {failed && <p className="mm-note mm-warn" role="status">{t(mine!.error ? 'mm.tune.failedError' : 'mm.tune.failed', { status: stuckStatus(t, String(mine!.status)), error: mine!.error ?? '' })} {t(last ? 'mm.tune.failedKeepLast' : 'mm.tune.failedKeep')}</p>}
    <div className="mm-actions"><button type="button" className="modal-btn secondary" onClick={goTune}>{t('mm.tune.go')}</button></div>
  </div>;
}

function QualityStep({ model, chat, onOpenTab }: { model: string; chat: boolean; onOpenTab: (tab: 'benchmarks' | 'hardware') => void }): JSX.Element {
  const t = useT();
  return <div className="mm-guided-step">
    <h4><span className="mm-step-n" aria-hidden="true">3</span>{t('mm.overview.quality')} <small>{t('mm.quality.hint')}</small></h4>
    <EvidenceList model={model}/>
    {chat
      ? <p className="mm-note">{t('mm.quality.run')} <button type="button" className="mm-guided-link" onClick={() => onOpenTab('benchmarks')}>{t('mm.quality.open')}</button></p>
      : <p className="mm-note">{t('mm.quality.notChat')}</p>}
  </div>;
}
