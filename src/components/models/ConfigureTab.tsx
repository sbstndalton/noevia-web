import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { isSystemModel } from '../../model-system';
import { bytes, ctxShort, errorText, mm, num, tokens } from './mm';
import { NativeCalibration } from '../NativeCalibration';
import { AutoTune } from './AutoTune';
import { dismissFolderModel } from './register';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

type Field = { key: string; label: string; kind: 'int' | 'text' | 'bool' | 'select'; choices: string[]; placeholder: string; help: string };
type Tier = { tier: string; open: boolean; fields: Field[] };
type SectionRow = { name: string; items: [string, string][]; hasFile: boolean; file: string | null; cli: string };
type SectionsResponse = { revision: string; schema: Tier[]; sections: SectionRow[]; unregistered: string[]; backups: [string, number, number][]; raw?: string };
type SectionResponse = { name: string; exists: boolean; values: Record<string, string>; extras: string; hints: string[]; revision: string; schema: Tier[] };
type Preset = { key: string; label: string; ctx: number; n_cpu_moe: number; offload_kind: string; gpu_layers: number; total_layers: number; gpu_gb: number; kv_gb: number; speed_score: number; ngl: number };
type Row = { ctx: number; total_ctx: number; model_gb: number; kv_gb: number; total_gb: number; fits: boolean; free_gb: number; offload_kind: string; n_cpu_moe: number; gpu_pct: number };
type Plan = { name: string; vendor: string; vram_gb: number; rows: Row[]; max_ctx: number; fits_at_all: boolean };
type Spec = { key: string; label: string; blurb: string; spec_type: string; needs_head: boolean };
type Rec = { plans: Plan[]; recommended_backend: string; recommended_ctx: number; recommended_total_ctx: number; n_sessions: number; values: Record<string, string>; quirks: string[]; unavailable: string[];
  current_diff: string[]; displaced: string[]; presets: Preset[]; frontier: Preset[]; fits_full_gpu: boolean; native_ctx: number; current_preset: string; active_preset: string; estimated_ctx?: number; ctx_cap_reason?: string; warnings?: string[];
  spec_profiles: Spec[]; active_spec_profile: string; current_spec_profile: string; spec_head_rel: string; error: string; vision_available: string; vision: boolean };
type Measured = { n: number; gen_p50: number; gen_p25: number; gen_p75: number; prompt_p50: number; draft_acc_p50: number | null };
type Run = Measured & { instance: string; is_current: boolean; diff: Record<string, string>; rel_pct: number };
type Auto = { error?: string; section: string; arch: string; params: string; fileBytes: number; model: string; recommendation: Rec; measured: Measured; history: Run[] };

export function ConfigureTab({ initial, onSaved, onSelect }: { initial?: string; onSaved: () => void; onSelect?: (name: string) => void }) {
  const t = useT();
  const [list, setList] = useState<SectionsResponse | null>(null), [selected, setSelected] = useState(initial || ''), [error, setError] = useState('');
  const load = async () => {
    try {
      const v = await mm<Partial<SectionsResponse>>('sections');
      // Opened straight from chat, this may meet a server without the model manager: say so, never crash.
      if (!Array.isArray(v?.sections)) throw Error(t('mm.configure.noServer'));
      setList({ revision: v.revision || '', schema: v.schema || [], sections: v.sections, unregistered: Array.isArray(v.unregistered) ? v.unregistered : [], backups: Array.isArray(v.backups) ? v.backups : [], raw: v.raw });
    } catch (e) { setError(errorText(e, t('mm.configure.unavailable'))); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (initial) setSelected(initial); }, [initial]);
  const names = list?.sections.map(s => s.name) || [];
  return <div className="mm-tab">
    <p className="mm-lede">{t('mm.configure.lede')}</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    <div className="mm-row">
      <label className="mm-grow">{t('mm.projects.model')}<select value={selected} onChange={e => { setSelected(e.target.value); onSelect?.(e.target.value); }}>
        <option value="">{t('mm.configure.choose')}</option>
        <optgroup label={t('mm.configure.configured')}>{names.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
        {!!list?.unregistered.length && <optgroup label={t('mm.configure.withoutSettings')}>{list.unregistered.map(n => <option key={n} value={n}>{t('mm.configure.new', { model: n })}</option>)}</optgroup>}
        {selected && !names.includes(selected) && !list?.unregistered.includes(selected) && <option value={selected}>{t('mm.configure.new', { model: selected })}</option>}
      </select></label>
    </div>
    {selected && list && <SectionEditor key={selected} name={selected} row={list.sections.find(s => s.name === selected)} onChanged={async (renamed) => { await load(); if (renamed !== undefined) { setSelected(renamed); onSelect?.(renamed); } onSaved(); }}/>}
    {list && !selected && <ul className="mm-list">{list.sections.map(s => <li key={s.name}><span>{s.name}<small>{s.hasFile ? s.file : t('mm.configure.fileMissing')}</small></span><button className="modal-btn secondary" onClick={() => { setSelected(s.name); onSelect?.(s.name); }}>{t('mm.configure.edit')}</button></li>)}</ul>}
    {list && <details className="mm-disclosure"><summary>{t('mm.configure.raw')}</summary><div className="mm-form">
      <pre className="mm-raw mm-mono" aria-label={t('mm.configure.rawLabel')}>{list.raw || t('mm.configure.empty')}</pre>
      {list.backups.length > 0
        ? <><p className="mm-note">{t.plural('mm.configure.backups', list.backups.length)}</p>
          <ul className="mm-hints mm-mono">{list.backups.map(([file, mtime, size]) => <li key={file}>{file} · {new Date(mtime * 1000).toLocaleString(t.locale)} · {size} B</li>)}</ul></>
        : <p className="mm-note">{t('mm.configure.noBackups')}</p>}
    </div></details>}
  </div>;
}

function SectionEditor({ name, row, onChanged }: { name: string; row?: SectionRow; onChanged: (renamed?: string) => Promise<void> }) {
  const [data, setData] = useState<SectionResponse | null>(null), [draft, setDraft] = useState<Record<string, string>>({}), [extras, setExtras] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [conflict, setConflict] = useState(false);
  const [rename, setRename] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const t = useT();
  const read = async (defaults = false) => {
    setError(''); setConflict(false);
    try { const v = await mm<SectionResponse>(`sections/${encodeURIComponent(name)}${defaults ? '?defaults=true' : ''}`); setData(v); setDraft(v.values); if (!defaults) setExtras(v.extras); setMessage(defaults ? t('mm.editor.defaultsFilled') : ''); }
    catch (e) { setError(errorText(e, t('mm.editor.readFailed'))); }
  };
  useEffect(() => { void read(); }, [name]);
  const save = async (values = draft, extraText = extras) => {
    if (!data) return; setBusy('save'); setError(''); setMessage('');
    try { const v = await mm<{ revision: string }>(`sections/${encodeURIComponent(name)}`, { method: 'PUT', body: { baseRevision: data.revision, values, extras: extraText } }); setData({ ...data, revision: v.revision, exists: true }); await onChanged(); await apply(false); }
    catch (e) { if ((e as { status?: number }).status === 409) setConflict(true); setError(errorText(e, t('mm.editor.saveFailed'))); } finally { setBusy(''); }
  };
  const [pending, setPending] = useState<string[]>([]);
  // The engine reads its settings file only on reload; apply now, or say what is waiting.
  const apply = async (unload: boolean) => {
    setBusy('apply');
    try {
      const r = await apiFetch('/api/models/presets/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload }) });
      const v = await r.json().catch(() => ({}));
      if (r.status === 409 && Array.isArray(v.loaded)) { setPending(v.loaded); setMessage(t('mm.editor.savedLoaded', { models: v.loaded.join(', ') })); return; }
      if (!r.ok) throw Error(v.error || t('mm.editor.noReload'));
      setPending([]); setMessage(unload && v.unloaded?.length ? t('mm.editor.appliedUnloaded', { models: v.unloaded.join(', ') }) : t('mm.editor.applied'));
    } catch (e) { setError(errorText(e, t('mm.editor.savedNoReload'))); } finally { setBusy(''); }
  };
  const doRename = async () => {
    if (!data || isSystemModel(name)) return; setBusy('rename'); setError('');
    // onChanged before apply: apply() manages the shared `busy` flag itself (it sets its own
    // 'apply' value and clears it in its own finally), so if it ran first, busy would already be
    // '' — and the button re-enabled — while onChanged (which reloads the section list and the
    // selected name) was still in flight. Awaiting onChanged first closes that double-click window.
    try { await mm(`sections/${encodeURIComponent(name)}/rename`, { body: { newName: rename.trim(), baseRevision: data.revision } }); await onChanged(rename.trim()); await apply(false); }
    catch (e) { setError(errorText(e, t('mm.editor.renameFailed'))); } finally { setBusy(''); }
  };
  const doDelete = async () => {
    if (!data || isSystemModel(name)) return; setBusy('delete'); setError('');
    // See doRename above: onChanged is awaited before apply() so its own finally cannot clear
    // `busy` while onChanged is still pending.
    try { await mm(`sections/${encodeURIComponent(name)}?baseRevision=${data.revision}`, { method: 'DELETE' }); dismissFolderModel(name); await onChanged(''); await apply(false); }
    catch (e) { if ((e as { status?: number }).status === 409) setConflict(true); setError(errorText(e, t('mm.deleteFailed'))); } finally { setBusy(''); }
  };
  const merge = (values: Record<string, string>, displaced: string[]) => {
    const schemaKeys = new Set(data?.schema.flatMap(t => t.fields.map(f => f.key)) || []);
    const next = { ...draft };
    for (const key of displaced) if (schemaKeys.has(key)) next[key] = '';
    const extraLines = extras.split('\n').filter(line => { const k = line.split('=')[0]?.trim(); return !(k && (displaced.includes(k) || k in values)); });
    for (const [k, v] of Object.entries(values)) { if (schemaKeys.has(k)) next[k] = v; else if (v) extraLines.push(`${k} = ${v}`); }
    return { next, extraText: extraLines.filter(Boolean).join('\n') };
  };
  const fill = (values: Record<string, string>, displaced: string[]) => {
    const { next, extraText } = merge(values, displaced);
    setDraft(next); setExtras(extraText);
    setMessage(t('mm.editor.autoconfigFilled'));
  };
  const useTuned = async (values: Record<string, string>, displaced: string[]) => {
    const { next, extraText } = merge(values, displaced);
    setDraft(next); setExtras(extraText);
    await save(next, extraText);
  };
  const [mode, setModeState] = useState<'easy' | 'advanced'>(() => { try { return localStorage.getItem('noevia:model-settings-mode') === 'advanced' ? 'advanced' : 'easy'; } catch { return 'easy'; } });
  const setMode = (next: 'easy' | 'advanced') => { setModeState(next); try { localStorage.setItem('noevia:model-settings-mode', next); } catch { /* optional */ } };
  if (!data) return error ? <p role="alert" className="modal-err">{error}</p> : <p role="status">{t('mm.editor.reading')}</p>;
  return <section className="mm-panel" aria-labelledby="mm-section-title">
    <header className="mm-panel-head"><div><h3 id="mm-section-title">{name}</h3><p className="mm-note">{data.exists ? (row?.hasFile ? row.file : t('mm.editor.fileMissing')) : t('mm.editor.unsaved')}</p></div></header>
    <div className="mm-mode" role="group" aria-label={t('mm.editor.detail')}>
      {(['easy', 'advanced'] as const).map(m => <button key={m} aria-pressed={mode === m} className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>{m === 'easy' ? t('mm.editor.easy') : t('mm.editor.advanced')}</button>)}
    </div>
    {mode === 'easy' ? <EasySettings name={name} draft={draft} busy={busy !== ''} onChange={(patch) => setDraft({ ...draft, ...patch })} onUseTuned={useTuned} onAutoApplied={() => { void read(); void onChanged(); }}/> : <>
    {data.hints.length > 0 && <ul className="mm-hints">{data.hints.map(h => <li key={h}>{h}</li>)}</ul>}
    <AutoconfigPanel name={name} onFill={fill}/>
    <div className="mm-form">
      {data.schema.map(tier => <details key={tier.tier} className="mm-tier" open={tier.open || tier.fields.some(f => draft[f.key])}>
        <summary>{tier.tier}{tier.fields.some(f => draft[f.key]) ? <small>{t('mm.editor.set', { count: tier.fields.filter(f => draft[f.key]).length })}</small> : null}</summary>
        <div className="mm-fields">{tier.fields.map(f => <FieldInput key={f.key} field={f} value={draft[f.key] || ''} onChange={v => setDraft({ ...draft, [f.key]: v })}/>)}</div>
      </details>)}
      <label>{t('mm.editor.otherOptions')}<textarea rows={4} className="mm-mono" value={extras} onChange={e => setExtras(e.target.value)} placeholder={t('mm.editor.otherPlaceholder')}/></label>
    </div>
    </>}
    {conflict && <p role="alert" className="modal-err">{t('mm.editor.conflict')} <button className="modal-btn secondary" onClick={() => void read()}>{t('mm.editor.reloadLatest')}</button> {t('mm.editor.conflictAfter')}</p>}
    {error && !conflict && <p role="alert" className="modal-err">{error}</p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    {pending.length > 0 && <div className="mm-actions"><button className="modal-btn secondary" disabled={busy !== ''} onClick={() => void apply(true)}>{busy === 'apply' ? t('mm.editor.applying') : t('mm.editor.applyNow')}</button></div>}
    <div className="mm-actions">
      <button className="modal-btn primary" disabled={busy !== ''} onClick={() => void save()}>{busy === 'save' ? t('mm.saving') : data.exists ? t('mm.editor.save') : t('mm.createSettings')}</button>
      <button className="modal-btn secondary" disabled={busy !== ''} onClick={() => void read(true)}>{t('mm.editor.reset')}</button>
      {row?.cli && <button className="modal-btn secondary" onClick={() => void navigator.clipboard?.writeText(row.cli).then(() => setMessage(t('mm.editor.cliCopied')))}>{t('mm.editor.copyCli')}</button>}
    </div>
    {data.exists && isSystemModel(name) && <p className="mm-note" role="status">{t('model.systemLabel')}{t('mm.editor.systemNote')}</p>}
    {data.exists && !isSystemModel(name) && <details className="mm-disclosure"><summary>{t('mm.editor.renameOrDelete')}</summary><div className="mm-form">
      <p className="mm-note">{t('mm.editor.renameNote')}</p>
      <div className="mm-row"><label className="mm-grow">{t('mm.editor.newName')}<input value={rename} onChange={e => setRename(e.target.value)} placeholder={name}/></label><button className="modal-btn secondary" disabled={!rename.trim() || rename.trim() === name || busy !== ''} onClick={() => void doRename()}>{t('mm.editor.rename')}</button></div>
      {confirmDelete ? <div className="mm-actions"><p>{t('mm.editor.removeConfirm')}</p><button className="modal-btn primary" disabled={busy !== ''} onClick={() => void doDelete()}>{t('mm.editor.remove')}</button><button className="modal-btn secondary" onClick={() => setConfirmDelete(false)}>{t('mm.keep')}</button></div>
        : <button className="modal-btn secondary" onClick={() => setConfirmDelete(true)}>{t('mm.editor.removeAsk')}</button>}
    </div></details>}
  </section>;
}

const SPEC_CHOICES: [string, MessageKey, MessageKey][] = [
  ['', 'mm.easy.engineDefault', 'mm.easy.spec.defaultHelp'],
  ['none', 'mm.easy.spec.off', 'mm.easy.spec.offHelp'],
  ['draft-mtp', 'mm.easy.spec.mtp', 'mm.easy.spec.mtpHelp'],
  ['ngram-simple', 'mm.easy.spec.ngram', 'mm.easy.spec.ngramHelp'],
];
// Easy mode never offers below Q5: Q4 degrades quality too much for a routine choice.
// Advanced mode's FieldInput still lists q4_0/q4_1 via the full preset schema for expert use.
const KV_CHOICES: [string, MessageKey][] = [['', 'mm.easy.engineDefault'], ['f16', 'mm.easy.kv.f16'], ['q8_0', 'mm.easy.kv.q8'], ['q5_0', 'mm.easy.kv.q5']];

// Easy exposes speculative decoding and KV cache type; tuning must not override what was picked.
const keepChoices = (draft: Record<string, string>) => Object.fromEntries(['spec-type', 'cache-type-k', 'cache-type-v'].filter(k => draft[k]).map(k => [k, draft[k]]));
// The common path: let autoconfig size the context to this machine's memory, and
// expose only the two choices people actually weigh. Advanced keeps every field.
type DraftHeads = { local: string; builtinLayers: number; available: boolean; remote: { repo: string; path: string; size: number }[]; mtpBuild: string | null; repo: string | null; remoteError?: string };

function EasySettings({ name, draft, busy, onChange, onUseTuned, onAutoApplied }: { name: string; draft: Record<string, string>; busy: boolean; onChange: (patch: Record<string, string>) => void; onUseTuned: (values: Record<string, string>, displaced: string[]) => Promise<void>; onAutoApplied: () => void }) {
  const [auto, setAuto] = useState<Auto | null>(null), [tuning, setTuning] = useState(false), [error, setError] = useState('');
  const [verified, setVerified] = useState(0), [heads, setHeads] = useState<DraftHeads | null>(null), [headNote, setHeadNote] = useState('');
  const t = useT();
  useEffect(() => {
    let live = true;
    // A context measured on this machine bounds every estimate; newest measurement wins.
    void apiFetch('/api/models/calibration?model=' + encodeURIComponent(name)).then(r => r.json()).then((v: { history?: { at: number; appliedCtx?: number; verifiedCtx?: number }[] }) => {
      const last = (v.history || []).slice().sort((a, b) => b.at - a.at)[0];
      if (live) setVerified(last?.verifiedCtx || last?.appliedCtx || 0);
    }).catch(() => {});
    // An older model manager has no such route; treat anything malformed as "unknown", never crash.
    void mm<Partial<DraftHeads>>(`sections/${encodeURIComponent(name)}/draft-heads`).then(v => {
      if (!live || typeof v?.available !== 'boolean') return;
      setHeads({ local: v.local || '', builtinLayers: Number(v.builtinLayers) || 0, available: v.available, remote: Array.isArray(v.remote) ? v.remote : [], mtpBuild: v.mtpBuild || null, repo: v.repo || null });
    }).catch(() => {});
    return () => { live = false; };
  }, [name]);
  const tune = async () => {
    setTuning(true); setError('');
    const spec = ({ 'draft-mtp': 'balanced', 'ngram-simple': 'ngram', none: 'off' } as Record<string, string>)[draft['spec-type'] || ''] || '';
    const q = new URLSearchParams({ sessions: '1', spec, vision: String(Boolean(draft.mmproj)) });
    if (verified > 0) q.set('verified_ctx', String(verified));
    try { setAuto(await mm<Auto>(`sections/${encodeURIComponent(name)}/autoconfig?${q}`)); }
    catch (e) { setError(errorText(e, t('mm.easy.tuneFailed'))); } finally { setTuning(false); }
  };
  const downloadHead = async (path: string) => {
    setHeadNote('');
    try { await mm(`sections/${encodeURIComponent(name)}/draft-heads/download`, { body: { path } }); setHeadNote(t('mm.easy.headDownloading')); }
    catch (e) { setHeadNote(errorText(e, t('mm.easy.headFailed'))); }
  };
  const rec = auto?.recommendation;
  const failure = auto?.error || rec?.error || error;
  const kv = draft['cache-type-k'] === draft['cache-type-v'] ? draft['cache-type-k'] || '' : 'mixed';
  const spec = SPEC_CHOICES.find(c => c[0] === (draft['spec-type'] || ''));
  const mtpStatus = !heads ? '' : heads.local ? t('mm.easy.mtp.local')
    : heads.builtinLayers > 0 ? t('mm.easy.mtp.builtin')
    : heads.remote.length ? t('mm.easy.mtp.remote', { repo: heads.repo ?? '' })
    : heads.mtpBuild ? t('mm.easy.mtp.build', { build: heads.mtpBuild })
    : t('mm.easy.mtp.none');
  const system = isSystemModel(name);
  return <div className="mm-form mm-easy">
    <div className="mm-easy-row">
      <div><strong>{t('mm.easy.context')}</strong><p className="mm-note">{draft['ctx-size'] ? t('mm.tokensCount', { tokens: ctxShort(Number(draft['ctx-size'])) }) : t('mm.easy.engineDefault')}. {verified > 0 ? t('mm.easy.measured', { tokens: ctxShort(verified) }) : t('mm.easy.notMeasured')} {t('mm.easy.tuningNote')}</p></div>
      {!system && <button className="modal-btn secondary" disabled={tuning || busy} onClick={() => void tune()}>{tuning ? t('mm.easy.estimating') : t('mm.easy.tune')}</button>}
    </div>
    {system && <p className="mm-note" role="status">{t('model.systemLabel')}{t('mm.easy.systemNote')}</p>}
    {!system && failure && <p role="alert" className="modal-err">{failure}</p>}
    {!system && rec && !failure && <div className="mm-easy-result" role="status">
      <div className="mm-easy-result-text">
        <p>{t('mm.easy.recommended')}<strong>{t('mm.tokensCount', { tokens: ctxShort(rec.recommended_ctx) })}</strong>{t(rec.fits_full_gpu ? 'mm.easy.onBackendGpu' : 'mm.easy.onBackend', { backend: rec.recommended_backend })}</p>
        {rec.ctx_cap_reason && rec.estimated_ctx ? <p className="mm-note">{t('mm.easy.capped', { ctx: ctxShort(rec.estimated_ctx), reason: rec.ctx_cap_reason })}</p> : null}
        {(rec.warnings || []).map((w) => <p key={w} className="mm-note mm-warn" role="note">{w}</p>)}
      </div>
      <button className="modal-btn primary" disabled={busy} onClick={() => void onUseTuned({ ...rec.values, ...keepChoices(draft) }, rec.displaced)}>{t('mm.easy.useSave')}</button>
    </div>}
{!system && <details className="mm-disclosure mm-easy-autotune" open>
      <summary>{t('mm.autotune.apply')} <small>{t('mm.easy.autotuneHint')}</small></summary>
      <AutoTune model={name} onChanged={() => { setAuto(null); onAutoApplied(); }}/>
    </details>}
    {!system && <details className="mm-disclosure mm-easy-measure">
      <summary>{t('mm.calibration.title')} <small>{t('mm.easy.measureHint')}</small></summary>
          <NativeCalibration model={name} onChanged={() => { setAuto(null); setVerified(0); void apiFetch('/api/models/calibration?model=' + encodeURIComponent(name)).then(r => r.json()).then((v: { history?: { at: number; appliedCtx?: number; verifiedCtx?: number }[] }) => { const last = (v.history || []).slice().sort((a, b) => b.at - a.at)[0]; setVerified(last?.verifiedCtx || last?.appliedCtx || 0); }).catch(() => {}); }}/>
    </details>}
    <label>{t('mm.easy.spec')}<select value={draft['spec-type'] || ''} onChange={e => onChange({ 'spec-type': e.target.value })}>
      {SPEC_CHOICES.map(([v, label]) => <option key={v} value={v} disabled={v === 'draft-mtp' && heads !== null && !heads.available}>{t(label)}{v === 'draft-mtp' && heads?.available ? ` (${t('mm.easy.available')})` : ''}</option>)}
      {!spec && <option value={draft['spec-type']}>{t('mm.easy.setInAdvanced', { value: draft['spec-type'] })}</option>}
    </select><small>{spec ? t(spec[2]) : t('mm.easy.customSpec')}{mtpStatus ? ` ${mtpStatus}` : ''}</small></label>
    {heads && !heads.available && heads.remote[0] && <div className="mm-easy-row">
      <p className="mm-note">{heads.remote[0].path} · {bytes(heads.remote[0].size)}</p>
      <button className="modal-btn secondary" disabled={busy} onClick={() => void downloadHead(heads.remote[0].path)}>{t('mm.easy.downloadHead')}</button>
    </div>}
    {headNote && <p className="mm-note" role="status">{headNote}</p>}
    <label>{t('mm.easy.kv')}<select value={kv} onChange={e => onChange({ 'cache-type-k': e.target.value, 'cache-type-v': e.target.value })}>
      {KV_CHOICES.map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}
      {kv === 'mixed' && <option value="mixed" disabled>{t('mm.easy.kv.mixed')}</option>}
      {kv !== 'mixed' && !KV_CHOICES.some(c => c[0] === kv) && <option value={kv}>{kv}</option>}
    </select><small>{t('mm.easy.kvHelp')}</small></label>
  </div>;
}

function FieldInput({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const id = `mm-field-${f.key}`;
  const t = useT();
  return <div className="mm-field">
    {f.kind === 'bool'
      ? <label className="mm-check"><input id={id} type="checkbox" checked={['true', 'on', '1'].includes(value)} onChange={e => onChange(e.target.checked ? 'true' : '')}/>{f.label}</label>
      : <label htmlFor={id}>{f.label}</label>}
    {f.kind === 'select' && <select id={id} value={value} onChange={e => onChange(e.target.value)}>{f.choices.map(c => <option key={c} value={c}>{c || t('mm.field.default')}</option>)}</select>}
    {(f.kind === 'int' || f.kind === 'text') && <input id={id} inputMode={f.kind === 'int' ? 'numeric' : undefined} value={value} placeholder={f.placeholder} onChange={e => onChange(e.target.value)}/>}
    {f.help && <small>{f.help}</small>}
  </div>;
}

function AutoconfigPanel({ name, onFill }: { name: string; onFill: (values: Record<string, string>, displaced: string[]) => void }) {
  const [sessions, setSessions] = useState(1), [preset, setPreset] = useState(''), [spec, setSpec] = useState(''), [vision, setVision] = useState(true), [point, setPoint] = useState<number | null>(null);
  const [data, setData] = useState<Auto | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const t = useT();
  const run = async () => {
    setBusy(true); setError('');
    try { setData(await mm<Auto>(`sections/${encodeURIComponent(name)}/autoconfig?${new URLSearchParams({ sessions: String(sessions), preset, spec, vision: String(vision) })}`)); setPoint(null); }
    catch (e) { setError(errorText(e, t('mm.autoconfig.failed'))); } finally { setBusy(false); }
  };
  useEffect(() => { if (data) void run(); }, [sessions, preset, spec, vision]);
  const rec = data?.recommendation;
  const chosen = point != null && rec ? rec.frontier[point] : null;
  const values = useMemo(() => {
    if (!rec) return {};
    if (!chosen) return rec.values;
    const v: Record<string, string> = { ...rec.values, 'ctx-size': String(chosen.ctx * (rec.n_sessions || 1)) };
    if (chosen.offload_kind === 'ngl') v.ngl = String(chosen.ngl);
    return v;
  }, [rec, chosen]);
  const columns = rec ? [...new Set(rec.plans.flatMap(p => p.rows.map(r => r.ctx)))].filter(c => [8192, 32768, 65536, 131072, 262144, rec.native_ctx, ...rec.plans.map(p => p.max_ctx)].includes(c)).sort((a, b) => a - b).slice(0, 6) : [];
  return <details className="mm-disclosure mm-autoconfig" open={!!data}>
    <summary>{t('mm.autoconfig.title')}</summary>
    <div className="mm-form">
      <p className="mm-note">{t('mm.autoconfig.note')}</p>
      <div className="mm-row">
        <label>{t('mm.autoconfig.sessions')}<select value={sessions} onChange={e => setSessions(Number(e.target.value))}>{[1, 2, 3, 4, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        {data?.recommendation?.vision_available && <label className="mm-check"><input type="checkbox" checked={vision} onChange={e => setVision(e.target.checked)}/>{t('mm.autoconfig.vision')}</label>}
        <button className="modal-btn secondary" disabled={busy} onClick={() => void run()}>{busy ? t('mm.working') : data ? t('mm.autoconfig.recalculate') : t('mm.autoconfig.run')}</button>
      </div>
      {error && <p role="alert" className="modal-err">{error}</p>}
      {data?.error && <p role="alert" className="modal-err">{data.error}</p>}
      {rec?.error && <p role="alert" className="modal-err">{rec.error}</p>}
      {rec && !rec.error && <>
        <p><strong>{data?.arch}{data?.params ? ` · ${data.params}` : ''}</strong> · {t('mm.autoconfig.recommended', { tokens: ctxShort(rec.recommended_ctx) })}{rec.n_sessions > 1 ? ` (${t('mm.autoconfig.total', { tokens: ctxShort(rec.recommended_total_ctx) })})` : ''} {t('mm.autoconfig.on', { backend: rec.recommended_backend })}{rec.native_ctx ? ` · ${t('mm.autoconfig.trainedFor', { tokens: ctxShort(rec.native_ctx) })}` : ''}</p>
        {!vision && rec.vision_available && <p className="mm-note">{t('mm.autoconfig.visionOff')}</p>}
        {rec.presets.length > 1 && <fieldset className="mm-chips"><legend>{t('mm.autoconfig.priority')}</legend>{rec.presets.map(p => <button key={p.key} aria-pressed={(preset || rec.active_preset) === p.key} className={(preset || rec.active_preset) === p.key ? 'is-active' : ''} onClick={() => setPreset(p.key)}>
          <strong>{p.label}{rec.current_preset === p.key ? ` ${t('mm.current')}` : ''}</strong><small>{t('mm.tokensCount', { tokens: ctxShort(p.ctx) })} · {t('mm.layersOnGpu', { gpu: p.gpu_layers, total: p.total_layers })} · {t('mm.speedPct', { pct: Math.round(p.speed_score * 100) })}</small></button>)}</fieldset>}
        {rec.fits_full_gpu && <p className="mm-note">{t('mm.autoconfig.fitsFull')}</p>}
        {rec.frontier.length > 2 && <label>{t('mm.autoconfig.fineTune')} {chosen ? [t('mm.tokensCount', { tokens: ctxShort(chosen.ctx) }), t('mm.layersOnGpu', { gpu: chosen.gpu_layers, total: chosen.total_layers }), t('mm.speedPct', { pct: Math.round(chosen.speed_score * 100) })].join(', ') : t('mm.autoconfig.usePriority')}
          <input type="range" min={0} max={rec.frontier.length - 1} value={point ?? 0} onChange={e => setPoint(Number(e.target.value))}/></label>}
        {rec.spec_profiles.length > 0 && <fieldset className="mm-chips"><legend>{t('mm.autoconfig.spec')}</legend>{rec.spec_profiles.map(s => {
          const unusable = s.needs_head && !rec.spec_head_rel;
          return <button key={s.key} disabled={unusable} aria-pressed={(spec || rec.active_spec_profile) === s.key} className={(spec || rec.active_spec_profile) === s.key ? 'is-active' : ''} onClick={() => setSpec(s.key)} title={unusable ? t('mm.autoconfig.needsHead') : s.blurb}>
            <strong>{s.label}{rec.current_spec_profile === s.key ? ` ${t('mm.current')}` : ''}</strong><small>{unusable ? t('mm.autoconfig.noHead') : s.blurb}</small></button>;
        })}</fieldset>}
        {rec.plans.map(p => <div key={p.name} className="mm-table-wrap"><table className="mm-table">
          <caption>{t(p.fits_at_all ? 'mm.autoconfig.budgetUpTo' : 'mm.autoconfig.budgetNoFit', { name: p.name, gib: num(p.vram_gb, 1), tokens: ctxShort(p.max_ctx) })}</caption>
          <thead><tr><th scope="col">{t('mm.easy.context')}</th><th scope="col">{t('mm.autoconfig.weights')}</th><th scope="col">{t('mm.autoconfig.kv')}</th><th scope="col">{t('mm.autoconfig.totalCol')}</th><th scope="col">{t('mm.verdict.fits')}</th></tr></thead>
          <tbody>{p.rows.filter(r => columns.includes(r.ctx)).map(r => <tr key={r.ctx}><td>{ctxShort(r.ctx)}</td><td>{num(r.model_gb)} GiB</td><td>{num(r.kv_gb)} GiB</td><td>{num(r.total_gb)} GiB</td>
            <td>{r.fits ? (r.offload_kind ? (r.offload_kind === 'ngl' ? t('mm.autoconfig.yesCpu', { pct: 100 - r.gpu_pct }) : t('mm.autoconfig.yesExperts')) : t('mm.autoconfig.yes')) : t('mm.autoconfig.no')}</td></tr>)}</tbody>
        </table></div>)}
        {data && data.measured.n > 0 && <p className="mm-note">{t.plural(data.measured.draft_acc_p50 != null ? 'mm.autoconfig.measuredDraft' : 'mm.autoconfig.measured', data.measured.n, { gen: num(data.measured.gen_p50, 1), low: num(data.measured.gen_p25, 1), high: num(data.measured.gen_p75, 1), prompt: num(data.measured.prompt_p50, 0), accepted: data.measured.draft_acc_p50 != null ? Math.round(data.measured.draft_acc_p50 * 100) : 0 })}</p>}
        {data && data.history.length > 0 && <div className="mm-table-wrap"><table className="mm-table"><caption>{t('mm.autoconfig.history')}</caption>
          <thead><tr><th scope="col">{t('mm.autoconfig.differ')}</th><th scope="col">{t('mm.autoconfig.generation')}</th><th scope="col">{t('mm.autoconfig.requests')}</th></tr></thead>
          <tbody>{data.history.map(h => <tr key={h.instance}><td>{Object.entries(h.diff).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}{h.is_current ? ` ${t('mm.current')}` : ''}</td><td>{t('mm.tokensPerSecond', { rate: num(h.gen_p50, 1) })} ({h.rel_pct}%)</td><td>{h.n}</td></tr>)}</tbody></table></div>}
        {rec.current_diff.length > 0 && <details className="mm-disclosure"><summary>{t.plural('mm.autoconfig.changes', rec.current_diff.length)}</summary><ul className="mm-hints mm-mono">{rec.current_diff.map(d => <li key={d}>{d}</li>)}</ul></details>}
        {rec.quirks.length > 0 && <details className="mm-disclosure"><summary>{t('mm.autoconfig.notes', { count: rec.quirks.length })}</summary><ul className="mm-hints">{rec.quirks.map(q => <li key={q}>{q}</li>)}</ul></details>}
        <button className="modal-btn primary" onClick={() => onFill(values, rec.displaced)}>{t('mm.autoconfig.fill')}</button>
        <p className="mm-note">{t('mm.autoconfig.values', { values: Object.entries(values).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' · ') || '—' })}{data && data.fileBytes ? ` · ${t('mm.autoconfig.modelSize', { size: `${tokens(Math.round(data.fileBytes / 1024 ** 2))} MiB` })}` : ''}</p>
      </>}
    </div>
  </details>;
}
