import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { ctxShort, errorText, mm, tokens } from './mm';

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
  current_diff: string[]; displaced: string[]; presets: Preset[]; frontier: Preset[]; fits_full_gpu: boolean; native_ctx: number; current_preset: string; active_preset: string;
  spec_profiles: Spec[]; active_spec_profile: string; current_spec_profile: string; spec_head_rel: string; error: string; vision_available: string; vision: boolean };
type Measured = { n: number; gen_p50: number; gen_p25: number; gen_p75: number; prompt_p50: number; draft_acc_p50: number | null };
type Run = Measured & { instance: string; is_current: boolean; diff: Record<string, string>; rel_pct: number };
type Auto = { error?: string; section: string; arch: string; params: string; fileBytes: number; model: string; recommendation: Rec; measured: Measured; history: Run[] };

export function ConfigureTab({ initial, onSaved, onSelect }: { initial?: string; onSaved: () => void; onSelect?: (name: string) => void }) {
  const [list, setList] = useState<SectionsResponse | null>(null), [selected, setSelected] = useState(initial || ''), [error, setError] = useState('');
  const load = async () => { try { setList(await mm<SectionsResponse>('sections')); } catch (e) { setError(errorText(e, 'Model settings are unavailable.')); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (initial) setSelected(initial); }, [initial]);
  const names = list?.sections.map(s => s.name) || [];
  return <div className="mm-tab">
    <p className="mm-lede">Per-model settings for the llama.cpp engine (its models.ini). Each entry's name is the model id chat uses. Changes apply the next time the model loads.</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    <div className="mm-row">
      <label className="mm-grow">Model<select value={selected} onChange={e => { setSelected(e.target.value); onSelect?.(e.target.value); }}>
        <option value="">Choose a model…</option>
        <optgroup label="Configured">{names.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
        {!!list?.unregistered.length && <optgroup label="Files without settings">{list.unregistered.map(n => <option key={n} value={n}>{n} (new)</option>)}</optgroup>}
        {selected && !names.includes(selected) && !list?.unregistered.includes(selected) && <option value={selected}>{selected} (new)</option>}
      </select></label>
    </div>
    {selected && list && <SectionEditor key={selected} name={selected} row={list.sections.find(s => s.name === selected)} onChanged={async (renamed) => { await load(); if (renamed !== undefined) { setSelected(renamed); onSelect?.(renamed); } onSaved(); }}/>}
    {list && !selected && <ul className="mm-list">{list.sections.map(s => <li key={s.name}><span>{s.name}<small>{s.hasFile ? s.file : 'model file not found'}</small></span><button className="modal-btn secondary" onClick={() => { setSelected(s.name); onSelect?.(s.name); }}>Edit</button></li>)}</ul>}
    {list && <details className="mm-disclosure"><summary>Raw file &amp; backups</summary><div className="mm-form">
      <pre className="mm-raw mm-mono" aria-label="models.ini contents">{list.raw || '(empty)'}</pre>
      {list.backups.length > 0
        ? <><p className="mm-note">{list.backups.length} automatic backups are kept on the server, newest first. Restoring one is an operator task on the server.</p>
          <ul className="mm-hints mm-mono">{list.backups.map(([file, mtime, size]) => <li key={file}>{file} · {new Date(mtime * 1000).toLocaleString()} · {size} B</li>)}</ul></>
        : <p className="mm-note">No backups yet. One is created on the next save.</p>}
    </div></details>}
  </div>;
}

function SectionEditor({ name, row, onChanged }: { name: string; row?: SectionRow; onChanged: (renamed?: string) => Promise<void> }) {
  const [data, setData] = useState<SectionResponse | null>(null), [draft, setDraft] = useState<Record<string, string>>({}), [extras, setExtras] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [conflict, setConflict] = useState(false);
  const [rename, setRename] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const read = async (defaults = false) => {
    setError(''); setConflict(false);
    try { const v = await mm<SectionResponse>(`sections/${encodeURIComponent(name)}${defaults ? '?defaults=true' : ''}`); setData(v); setDraft(v.values); if (!defaults) setExtras(v.extras); setMessage(defaults ? 'Filled with defaults derived from the model file. Nothing is saved until you save.' : ''); }
    catch (e) { setError(errorText(e, 'Could not read these settings')); }
  };
  useEffect(() => { void read(); }, [name]);
  const save = async (values = draft, extraText = extras) => {
    if (!data) return; setBusy('save'); setError(''); setMessage('');
    try { const v = await mm<{ revision: string }>(`sections/${encodeURIComponent(name)}`, { method: 'PUT', body: { baseRevision: data.revision, values, extras: extraText } }); setData({ ...data, revision: v.revision, exists: true }); await onChanged(); await apply(false); }
    catch (e) { if ((e as { status?: number }).status === 409) setConflict(true); setError(errorText(e, 'Save failed')); } finally { setBusy(''); }
  };
  const [pending, setPending] = useState<string[]>([]);
  // The engine reads its settings file only on reload; apply now, or say what is waiting.
  const apply = async (unload: boolean) => {
    setBusy('apply');
    try {
      const r = await apiFetch('/api/models/presets/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload }) });
      const v = await r.json().catch(() => ({}));
      if (r.status === 409 && Array.isArray(v.loaded)) { setPending(v.loaded); setMessage(`Saved. ${v.loaded.join(', ')} is loaded, so the engine keeps the old settings until it is unloaded.`); return; }
      if (!r.ok) throw Error(v.error || 'The engine did not reload');
      setPending([]); setMessage(unload && v.unloaded?.length ? `Saved and applied. ${v.unloaded.join(', ')} was unloaded and loads with the new settings next time.` : 'Saved and applied. The engine uses the new settings from the next load.');
    } catch (e) { setError(errorText(e, 'Saved, but the engine did not reload')); } finally { setBusy(''); }
  };
  const doRename = async () => {
    if (!data) return; setBusy('rename'); setError('');
    try { await mm(`sections/${encodeURIComponent(name)}/rename`, { body: { newName: rename.trim(), baseRevision: data.revision } }); await apply(false); await onChanged(rename.trim()); }
    catch (e) { setError(errorText(e, 'Rename failed')); } finally { setBusy(''); }
  };
  const doDelete = async () => {
    if (!data) return; setBusy('delete'); setError('');
    try { await mm(`sections/${encodeURIComponent(name)}?baseRevision=${data.revision}`, { method: 'DELETE' }); await apply(false); await onChanged(''); }
    catch (e) { setError(errorText(e, 'Delete failed')); } finally { setBusy(''); }
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
    setMessage('Autoconfig values filled in. Review them, then save.');
  };
  const useTuned = async (values: Record<string, string>, displaced: string[]) => {
    const { next, extraText } = merge(values, displaced);
    setDraft(next); setExtras(extraText);
    await save(next, extraText);
  };
  const [mode, setModeState] = useState<'easy' | 'advanced'>(() => { try { return localStorage.getItem('noevia:model-settings-mode') === 'advanced' ? 'advanced' : 'easy'; } catch { return 'easy'; } });
  const setMode = (next: 'easy' | 'advanced') => { setModeState(next); try { localStorage.setItem('noevia:model-settings-mode', next); } catch { /* optional */ } };
  if (!data) return error ? <p role="alert" className="modal-err">{error}</p> : <p role="status">Reading settings…</p>;
  return <section className="mm-panel" aria-labelledby="mm-section-title">
    <header className="mm-panel-head"><div><h3 id="mm-section-title">{name}</h3><p className="mm-note">{data.exists ? (row?.hasFile ? row.file : 'Model file not found for these settings') : 'New settings: not saved yet'}</p></div></header>
    <div className="mm-mode" role="group" aria-label="Settings detail">
      {(['easy', 'advanced'] as const).map(m => <button key={m} aria-pressed={mode === m} className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>{m === 'easy' ? 'Easy' : 'Advanced'}</button>)}
    </div>
    {mode === 'easy' ? <EasySettings name={name} draft={draft} busy={busy !== ''} onChange={(patch) => setDraft({ ...draft, ...patch })} onUseTuned={useTuned}/> : <>
    {data.hints.length > 0 && <ul className="mm-hints">{data.hints.map(h => <li key={h}>{h}</li>)}</ul>}
    <AutoconfigPanel name={name} onFill={fill}/>
    <div className="mm-form">
      {data.schema.map(t => <details key={t.tier} className="mm-tier" open={t.open || t.fields.some(f => draft[f.key])}>
        <summary>{t.tier}{t.fields.some(f => draft[f.key]) ? <small>{t.fields.filter(f => draft[f.key]).length} set</small> : null}</summary>
        <div className="mm-fields">{t.fields.map(f => <FieldInput key={f.key} field={f} value={draft[f.key] || ''} onChange={v => setDraft({ ...draft, [f.key]: v })}/>)}</div>
      </details>)}
      <label>Other options, one per line (key = value)<textarea rows={4} className="mm-mono" value={extras} onChange={e => setExtras(e.target.value)} placeholder="e.g. override-tensor = exps=CPU"/></label>
    </div>
    </>}
    {conflict && <p role="alert" className="modal-err">The settings file changed since you opened it (another save, a calibration or an edit on the server). <button className="modal-btn secondary" onClick={() => void read()}>Reload latest</button> Your unsaved changes will be replaced.</p>}
    {error && !conflict && <p role="alert" className="modal-err">{error}</p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    {pending.length > 0 && <div className="mm-actions"><button className="modal-btn secondary" disabled={busy !== ''} onClick={() => void apply(true)}>{busy === 'apply' ? 'Applying…' : 'Apply now (unloads the model)'}</button></div>}
    <div className="mm-actions">
      <button className="modal-btn primary" disabled={busy !== ''} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : data.exists ? 'Save settings' : 'Create settings'}</button>
      <button className="modal-btn secondary" disabled={busy !== ''} onClick={() => void read(true)}>Reset to model-file defaults</button>
      {row?.cli && <button className="modal-btn secondary" onClick={() => void navigator.clipboard?.writeText(row.cli).then(() => setMessage('Command line copied.'))}>Copy command line</button>}
    </div>
    {data.exists && <details className="mm-disclosure"><summary>Rename or delete</summary><div className="mm-form">
      <p className="mm-note">The name is the model id that chat, projects and the Diary refer to. Renaming keeps the same file.</p>
      <div className="mm-row"><label className="mm-grow">New name<input value={rename} onChange={e => setRename(e.target.value)} placeholder={name}/></label><button className="modal-btn secondary" disabled={!rename.trim() || rename.trim() === name || busy !== ''} onClick={() => void doRename()}>Rename</button></div>
      {confirmDelete ? <div className="mm-actions"><p>Remove these settings? The model file stays; the engine stops offering this model.</p><button className="modal-btn primary" disabled={busy !== ''} onClick={() => void doDelete()}>Remove settings</button><button className="modal-btn secondary" onClick={() => setConfirmDelete(false)}>Keep</button></div>
        : <button className="modal-btn secondary" onClick={() => setConfirmDelete(true)}>Remove these settings…</button>}
    </div></details>}
  </section>;
}

const SPEC_CHOICES: [string, string, string][] = [
  ['', 'Engine default', 'Leave speculative decoding to the engine.'],
  ['none', 'Off', 'No speculative decoding.'],
  ['draft-mtp', 'MTP draft head', 'Uses the model\'s MTP prediction head. Tune for this machine fills in the head file when one sits beside the model.'],
  ['ngram-simple', 'N-gram (no extra model)', 'Guesses from text already in the conversation. Helps with repetitive output.'],
];
const KV_CHOICES: [string, string][] = [['', 'Engine default'], ['f16', 'Full precision (f16)'], ['q8_0', 'Balanced (q8_0)'], ['q4_0', 'Smallest (q4_0)']];

// The common path: let autoconfig size the context to this machine's memory, and
// expose only the two choices people actually weigh. Advanced keeps every field.
function EasySettings({ name, draft, busy, onChange, onUseTuned }: { name: string; draft: Record<string, string>; busy: boolean; onChange: (patch: Record<string, string>) => void; onUseTuned: (values: Record<string, string>, displaced: string[]) => Promise<void> }) {
  const [auto, setAuto] = useState<Auto | null>(null), [tuning, setTuning] = useState(false), [error, setError] = useState('');
  const tune = async () => {
    setTuning(true); setError('');
    const spec = ({ 'draft-mtp': 'balanced', 'ngram-simple': 'ngram', none: 'off' } as Record<string, string>)[draft['spec-type'] || ''] || '';
    try { setAuto(await mm<Auto>(`sections/${encodeURIComponent(name)}/autoconfig?${new URLSearchParams({ sessions: '1', spec })}`)); }
    catch (e) { setError(errorText(e, 'Tuning failed')); } finally { setTuning(false); }
  };
  const rec = auto?.recommendation;
  const failure = auto?.error || rec?.error || error;
  const kv = draft['cache-type-k'] === draft['cache-type-v'] ? draft['cache-type-k'] || '' : 'mixed';
  const spec = SPEC_CHOICES.find(c => c[0] === (draft['spec-type'] || ''));
  return <div className="mm-form mm-easy">
    <div className="mm-easy-row">
      <div><strong>Context</strong><p className="mm-note">{draft['ctx-size'] ? `${ctxShort(Number(draft['ctx-size']))} tokens` : 'Engine default'}. Tuning estimates the largest context that fits this server's GPU memory; Measure context under a model's details verifies it on the engine.</p></div>
      <button className="modal-btn secondary" disabled={tuning || busy} onClick={() => void tune()}>{tuning ? 'Measuring…' : 'Tune for this machine'}</button>
    </div>
    {failure && <p role="alert" className="modal-err">{failure}</p>}
    {rec && !failure && <div className="mm-easy-result" role="status">
      <p>Recommended: <strong>{ctxShort(rec.recommended_ctx)} tokens</strong> on {rec.recommended_backend}{rec.fits_full_gpu ? ', entirely on the GPU' : ''}.</p>
      <button className="modal-btn primary" disabled={busy} onClick={() => void onUseTuned(rec.values, rec.displaced)}>Use and save</button>
    </div>}
    <label>Speculative decoding (MTP)<select value={draft['spec-type'] || ''} onChange={e => onChange({ 'spec-type': e.target.value })}>
      {SPEC_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      {!spec && <option value={draft['spec-type']}>{draft['spec-type']} (set in Advanced)</option>}
    </select><small>{spec ? spec[2] : 'A custom strategy is set; change it in Advanced.'}</small></label>
    <label>KV cache quantisation<select value={kv} onChange={e => onChange({ 'cache-type-k': e.target.value, 'cache-type-v': e.target.value })}>
      {KV_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      {kv === 'mixed' && <option value="mixed" disabled>Different K and V (set in Advanced)</option>}
      {kv !== 'mixed' && !KV_CHOICES.some(c => c[0] === kv) && <option value={kv}>{kv}</option>}
    </select><small>Smaller cache types fit more context in the same memory at a small quality cost.</small></label>
  </div>;
}

function FieldInput({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const id = `mm-field-${f.key}`;
  return <div className="mm-field">
    {f.kind === 'bool'
      ? <label className="mm-check"><input id={id} type="checkbox" checked={['true', 'on', '1'].includes(value)} onChange={e => onChange(e.target.checked ? 'true' : '')}/>{f.label}</label>
      : <label htmlFor={id}>{f.label}</label>}
    {f.kind === 'select' && <select id={id} value={value} onChange={e => onChange(e.target.value)}>{f.choices.map(c => <option key={c} value={c}>{c || 'Default'}</option>)}</select>}
    {(f.kind === 'int' || f.kind === 'text') && <input id={id} inputMode={f.kind === 'int' ? 'numeric' : undefined} value={value} placeholder={f.placeholder} onChange={e => onChange(e.target.value)}/>}
    {f.help && <small>{f.help}</small>}
  </div>;
}

function AutoconfigPanel({ name, onFill }: { name: string; onFill: (values: Record<string, string>, displaced: string[]) => void }) {
  const [sessions, setSessions] = useState(1), [preset, setPreset] = useState(''), [spec, setSpec] = useState(''), [vision, setVision] = useState(true), [point, setPoint] = useState<number | null>(null);
  const [data, setData] = useState<Auto | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try { setData(await mm<Auto>(`sections/${encodeURIComponent(name)}/autoconfig?${new URLSearchParams({ sessions: String(sessions), preset, spec, vision: String(vision) })}`)); setPoint(null); }
    catch (e) { setError(errorText(e, 'Autoconfig failed')); } finally { setBusy(false); }
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
    <summary>Autoconfig: work out settings that fit this machine</summary>
    <div className="mm-form">
      <p className="mm-note">Reads the model file and this server's GPU memory, then proposes a context size, GPU placement, cache type and related settings. Nothing changes until you fill the form and save. For a measured answer, use Measure context in the Library.</p>
      <div className="mm-row">
        <label>Chats at once<select value={sessions} onChange={e => setSessions(Number(e.target.value))}>{[1, 2, 3, 4, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        {data?.recommendation?.vision_available && <label className="mm-check"><input type="checkbox" checked={vision} onChange={e => setVision(e.target.checked)}/>Vision (image input)</label>}
        <button className="modal-btn secondary" disabled={busy} onClick={() => void run()}>{busy ? 'Working…' : data ? 'Recalculate' : 'Run autoconfig'}</button>
      </div>
      {error && <p role="alert" className="modal-err">{error}</p>}
      {data?.error && <p role="alert" className="modal-err">{data.error}</p>}
      {rec?.error && <p role="alert" className="modal-err">{rec.error}</p>}
      {rec && !rec.error && <>
        <p><strong>{data?.arch}{data?.params ? ` · ${data.params}` : ''}</strong> · recommended {ctxShort(rec.recommended_ctx)} tokens per chat{rec.n_sessions > 1 ? ` (${ctxShort(rec.recommended_total_ctx)} total)` : ''} on {rec.recommended_backend}{rec.native_ctx ? ` · trained for ${ctxShort(rec.native_ctx)}` : ''}</p>
        {!vision && rec.vision_available && <p className="mm-note">Vision off: the projector is not loaded and its memory goes to context. Saving removes image input for this model.</p>}
        {rec.presets.length > 1 && <fieldset className="mm-chips"><legend>Priority</legend>{rec.presets.map(p => <button key={p.key} aria-pressed={(preset || rec.active_preset) === p.key} className={(preset || rec.active_preset) === p.key ? 'is-active' : ''} onClick={() => setPreset(p.key)}>
          <strong>{p.label}{rec.current_preset === p.key ? ' (current)' : ''}</strong><small>{ctxShort(p.ctx)} tokens · {p.gpu_layers}/{p.total_layers} layers on GPU · ~{Math.round(p.speed_score * 100)}% speed</small></button>)}</fieldset>}
        {rec.fits_full_gpu && <p className="mm-note">Fits entirely on the GPU at its full trained context, so there is nothing to trade off.</p>}
        {rec.frontier.length > 2 && <label>Fine-tune: {chosen ? `${ctxShort(chosen.ctx)} tokens, ${chosen.gpu_layers}/${chosen.total_layers} layers on GPU, ~${Math.round(chosen.speed_score * 100)}% speed` : 'use the priority above'}
          <input type="range" min={0} max={rec.frontier.length - 1} value={point ?? 0} onChange={e => setPoint(Number(e.target.value))}/></label>}
        {rec.spec_profiles.length > 0 && <fieldset className="mm-chips"><legend>Speculative decoding</legend>{rec.spec_profiles.map(s => {
          const unusable = s.needs_head && !rec.spec_head_rel;
          return <button key={s.key} disabled={unusable} aria-pressed={(spec || rec.active_spec_profile) === s.key} className={(spec || rec.active_spec_profile) === s.key ? 'is-active' : ''} onClick={() => setSpec(s.key)} title={unusable ? 'Needs a draft or MTP head next to the model file' : s.blurb}>
            <strong>{s.label}{rec.current_spec_profile === s.key ? ' (current)' : ''}</strong><small>{unusable ? 'No prediction head found' : s.blurb}</small></button>;
        })}</fieldset>}
        {rec.plans.map(p => <div key={p.name} className="mm-table-wrap"><table className="mm-table">
          <caption>{p.name}: {p.vram_gb.toFixed(1)} GiB budget{p.fits_at_all ? `, up to ${ctxShort(p.max_ctx)} tokens` : ', does not fit'}</caption>
          <thead><tr><th scope="col">Context</th><th scope="col">Weights</th><th scope="col">KV cache</th><th scope="col">Total</th><th scope="col">Fits</th></tr></thead>
          <tbody>{p.rows.filter(r => columns.includes(r.ctx)).map(r => <tr key={r.ctx}><td>{ctxShort(r.ctx)}</td><td>{r.model_gb} GiB</td><td>{r.kv_gb} GiB</td><td>{r.total_gb} GiB</td>
            <td>{r.fits ? (r.offload_kind ? `Yes, ${r.offload_kind === 'ngl' ? `${100 - r.gpu_pct}% of weights on CPU` : 'with expert offload'}` : 'Yes') : 'No'}</td></tr>)}</tbody>
        </table></div>)}
        {data && data.measured.n > 0 && <p className="mm-note">Measured on this server: {data.measured.gen_p50.toFixed(1)} tokens/s generating (typically {data.measured.gen_p25.toFixed(1)}–{data.measured.gen_p75.toFixed(1)}), {data.measured.prompt_p50.toFixed(0)} tokens/s reading prompts{data.measured.draft_acc_p50 != null ? `, ${Math.round(data.measured.draft_acc_p50 * 100)}% of predicted tokens accepted` : ''} across {data.measured.n} requests.</p>}
        {data && data.history.length > 0 && <div className="mm-table-wrap"><table className="mm-table"><caption>Configurations this model has run under</caption>
          <thead><tr><th scope="col">Settings that differ</th><th scope="col">Generation</th><th scope="col">Requests</th></tr></thead>
          <tbody>{data.history.map(h => <tr key={h.instance}><td>{Object.entries(h.diff).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}{h.is_current ? ' (current)' : ''}</td><td>{h.gen_p50.toFixed(1)} tokens/s ({h.rel_pct}%)</td><td>{h.n}</td></tr>)}</tbody></table></div>}
        {rec.current_diff.length > 0 && <details className="mm-disclosure"><summary>{rec.current_diff.length} changes from the saved settings</summary><ul className="mm-hints mm-mono">{rec.current_diff.map(d => <li key={d}>{d}</li>)}</ul></details>}
        {rec.quirks.length > 0 && <details className="mm-disclosure"><summary>Notes for this model ({rec.quirks.length})</summary><ul className="mm-hints">{rec.quirks.map(q => <li key={q}>{q}</li>)}</ul></details>}
        <button className="modal-btn primary" onClick={() => onFill(values, rec.displaced)}>Fill the form with these values</button>
        <p className="mm-note">Values: {Object.entries(values).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}{data && data.fileBytes ? ` · model ${tokens(Math.round(data.fileBytes / 1024 ** 2))} MiB` : ''}</p>
      </>}
    </div>
  </details>;
}
