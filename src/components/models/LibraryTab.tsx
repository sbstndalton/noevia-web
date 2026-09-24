import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, fetchInstalledModels } from '../../api';
import type { InstalledModel } from '../../types';
import { MtpControl } from '../MtpControl';
import { NativeCalibration } from '../NativeCalibration';
import { EvidenceList } from './EvidenceList';
import { errorText, mm, tokens } from './mm';
import { registerNewFolderModels } from './register';
import { useModelsChanged } from '../../models-changed';
import { MiddleTruncate } from '../MiddleTruncate';
import { AutoTune } from './AutoTune';
import { isSystemModel, SYSTEM_MODEL_LABEL } from '../../model-system';

type FileEntry = { key: string; name: string; subdir: string; bytes: number; size: string; modified: string; sharded: boolean; parts: number;
  projector: { name: string; bytes: number } | null; sections: string[]; modelId: string; file: string;
  shape: { arch: string; moe: boolean; experts: number; active: number; label: string } | null; loadedOn: string[];
  fit: { name: string; verdict: string; ratio_pct: number }[]; badges: { category: string; rating: number; note: string }[] };
type Update = { status: string; remote: string; delta_days: number | null };
type Detail = FileEntry & { path: string; summary: { arch: string; general: Record<string, unknown>; model: Record<string, unknown>; chat_template_features: Record<string, boolean> } };
const BADGE: Record<string, string> = { coding: 'Coding', writing: 'Creative writing', reasoning: 'Reasoning', tools: 'Tool use', vision: 'Vision' };

export function LibraryTab({ onConfigure, onChanged, query = '', sort = 'name', filter = 'all' }: {
  onConfigure: (section: string) => void; onChanged: () => void;
  query?: string; sort?: 'name' | 'size' | 'modified'; filter?: 'all' | 'loaded' | 'vision' | 'unconfigured';
}) {
  const [models, setModels] = useState<InstalledModel[] | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [unregistered, setUnregistered] = useState<string[]>([]);
  const [updates, setUpdates] = useState<Record<string, Update>>({});
  const [disk, setDisk] = useState<{ freeH: string; totalH: string; usedPct: number } | null>(null);
  const [scanned, setScanned] = useState(false);
  const [canTune, setCanTune] = useState(false), [showTune, setShowTune] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(''), [filesNote, setFilesNote] = useState(''), [runtimeOptions, setRuntimeOptions] = useState(false);
  // The parent passes a fresh callback each render; the refresh below must stay stable.
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  // The engine's list answers in milliseconds; the file scan behind it can take seconds. Show the
  // list as soon as it arrives and let file details, updates and disk space fill in after.
  const refresh = useCallback(async () => {
    setError('');
    const listed = fetchInstalledModels().then((installed) => { setModels(installed); return installed; });
    const local = mm<{ models: FileEntry[]; unregistered: string[] }>('models').catch(() => null);
    void mm<{ status: Record<string, Update> }>('models/updates').then((u) => setUpdates(u.status)).catch(() => undefined);
    void apiFetch('/api/models/capabilities').then(r => r.json()).then((caps) => { setRuntimeOptions(caps?.runtimeOptions === true); setCanTune(caps?.admin === true && caps?.autotune === true); }).catch(() => undefined);
    void mm<{ modelsDir?: { disk?: { freeH: string; totalH: string; usedPct: number } | null } }>('overview').then((o) => setDisk(o?.modelsDir?.disk ?? null)).catch(() => undefined);
    try {
      await listed;
      const scan = await local;
      setFiles(scan?.models || []); setUnregistered(scan?.unregistered || []); setScanned(true);
      if (scan?.unregistered?.length) {
        const synced = await registerNewFolderModels(scan.unregistered);
        if (synced.text) setMessage(synced.text);
        if (synced.added.length) { changedRef.current(); return; }   // models-changed refetches this list
      }
      setFilesNote(scan ? '' : 'File details, downloads and settings need the model management service, which is not available on this server.');
    } catch (e) { setError(errorText(e, 'The model library is unavailable.')); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // Tabs mount per selection, so a mount-only fetch left this list showing
  // whatever was true when the tab was last opened.
  useModelsChanged(useCallback(() => { void refresh(); }, [refresh]));
  const fileFor = (name: string) => files.find(f => f.sections.includes(name) || f.modelId === name);
  const act = async (verb: 'load' | 'unload', name: string) => {
    setBusy(name); setMessage('');
    try { const r = await apiFetch(`/api/models/${verb}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); if (!r.ok) throw Error((await r.json()).error || `${verb} failed`); onChanged(); }
    catch (e) { setError(errorText(e, 'Model operation failed')); } finally { setBusy(''); }
  };
  const checkUpdates = async () => {
    setBusy('updates'); setMessage('');
    try { const v = await mm<{ checked: number; status: Record<string, Update> }>('models/check-updates', { body: {} }); setUpdates(v.status); setMessage(`Checked ${v.checked} downloaded file${v.checked === 1 ? '' : 's'} against Hugging Face.`); }
    catch (e) { setError(errorText(e, 'Update check failed')); } finally { setBusy(''); }
  };
  // Hex names are Hugging Face cache artefacts, not something anyone chose to
  // install, and they cannot be configured usefully.
  const installed = (models || []).filter(m => !/^[0-9a-f]{32,40}$/i.test(m.name));
  const needle = query.trim().toLowerCase();
  const servable = installed
    .filter(m => !needle || m.name.toLowerCase().includes(needle))
    .filter(m => {
      if (filter === 'loaded') return m.loaded;
      if (filter === 'vision') return !!fileFor(m.name)?.projector || m.labels.includes('vision');
      // "Needs setup" means the engine lists it but no models.ini section
      // points at a file, so it cannot actually be served.
      if (filter === 'unconfigured') return !fileFor(m.name);
      return true;
    })
    .sort((a, b) => {
      if (sort === 'size') return (fileFor(b.name)?.bytes ?? b.sizeGB ?? 0) - (fileFor(a.name)?.bytes ?? a.sizeGB ?? 0);
      if (sort === 'modified') return (fileFor(b.name)?.modified || '').localeCompare(fileFor(a.name)?.modified || '');
      return a.name.localeCompare(b.name);
    });
  const shownFiles = new Set(servable.map(m => fileFor(m.name)?.key).filter(Boolean));
  const orphanFiles = files.filter(f => !shownFiles.has(f.key));
  return <div className="mm-tab">
    <div className="mm-library-bar">
      <p className="mm-note" role="status">{models ? <>{servable.length} of {installed.length} {installed.length === 1 ? 'model' : 'models'}{needle ? ` matching “${query.trim()}”` : ''}{filter !== 'all' ? ' after filtering' : ''}</> : 'Loading models…'}
        {disk && <> · <span data-testid="models-disk">Models folder: {disk.freeH} free of {disk.totalH} ({disk.usedPct.toFixed(0)}% used).</span></>}
        {models && !scanned && <span className="mm-scanning"> · Reading model files…</span>}</p>
      <button className="btn btn-secondary btn-sm" disabled={busy === 'updates'} onClick={() => void checkUpdates()}>{busy === 'updates' ? 'Checking…' : 'Check for updates'}</button>
      {canTune && <button className="btn btn-secondary btn-sm" aria-expanded={showTune} aria-controls="library-autotune" onClick={() => setShowTune(v => !v)}>Tune untuned models</button>}
    </div>
    {showTune && <section className="mm-panel" id="library-autotune"><h3>Automatic tuning</h3><AutoTune onChanged={onChanged}/></section>}
    {error && <p role="alert" className="modal-err">{error}</p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    {filesNote && <p className="mm-note">{filesNote}</p>}
    {models && !servable.length && installed.length > 0 && <p className="mm-note">Nothing matches. Clear the search or choose All models.</p>}
    <div className="model-grid">
    {servable.map(m => <ModelCard key={m.name} runtimeOptions={runtimeOptions} onRefresh={() => void refresh()} model={m} file={fileFor(m.name)} update={updates[fileFor(m.name)?.name || '']} busy={busy === m.name}
      onToggle={() => void act(m.loaded ? 'unload' : 'load', m.name)} onConfigure={() => onConfigure(m.name)} onDeleted={onChanged}/>)}
    </div>
    {orphanFiles.length > 0 && <section className="mm-panel"><h3>Files without a model entry</h3>
      <p className="mm-note">These files are in the model folder but no settings point to them, so the engine cannot serve them yet.</p>
      <ul className="mm-list">{orphanFiles.map(f => <li key={f.key}><span>{f.name}<small>{f.size}{f.subdir ? ` · ${f.subdir}/` : ''}</small></span>
        <button className="modal-btn secondary" onClick={() => onConfigure(f.name.replace(/\.gguf$/i, ''))}>Create settings</button></li>)}</ul></section>}
    {unregistered.length > 0 && orphanFiles.length === 0 && <p className="mm-note">Unconfigured files: {unregistered.join(', ')}</p>}
  </div>;
}

function ModelCard({ model: m, file, update, busy, onToggle, onConfigure, onDeleted, runtimeOptions, onRefresh }: { model: InstalledModel; file?: FileEntry; update?: Update; busy: boolean; onToggle: () => void; onConfigure: () => void; onDeleted: () => void; runtimeOptions: boolean; onRefresh: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null), [open, setOpen] = useState(false);
  const state = m.failed ? 'failed' : m.loaded ? 'loaded' : 'unloaded';
  useEffect(() => { if (open && file && !detail) void mm<Detail>(`models/detail?key=${encodeURIComponent(file.key)}`).then(setDetail).catch(() => {}); }, [open, file, detail]);
  const model = detail?.summary?.model || {};
  const system = isSystemModel(m.name);
  return <article className={`model-card surface${open ? ' is-open' : ''}`} data-state={state} aria-label={m.name}>
    <header className="model-card-head"><h3 className="model-card-name"><MiddleTruncate text={m.name}/></h3><span className="model-card-state">{m.failed ? 'Failed to load' : m.loaded ? 'Loaded' : 'Unloaded'}</span></header>
    <p className="model-card-meta">
      {(file?.size || m.sizeGB != null) && <span>{file?.size || `${m.sizeGB} GB`}</span>}
      {m.maxContext != null && <span>trained for {tokens(m.maxContext)} tokens</span>}
      {file?.shape && <span>{file.shape.label}</span>}
      {file?.projector && <span className="model-card-tag">vision</span>}
      {system && <span className="model-card-tag" title="Used internally for message routing; not tuned or configured by hand.">{SYSTEM_MODEL_LABEL}</span>}
      {m.labels.filter(l => l !== 'vision').map(l => <span key={l} className="model-card-tag">{l}</span>)}
      {m.source && <span>{m.source === 'preset' ? 'model folder' : m.source === 'cache' ? 'downloaded' : m.source}</span>}
      {update?.status === 'stale' && <span className="mm-pill is-warn">Update available ({update.remote})</span>}
    </p>
    {file?.badges && file.badges.length > 0 && <p className="model-card-meta">{file.badges.map(b => <span key={b.category} className="model-card-tag">{BADGE[b.category] || b.category} {b.rating}/5</span>)}</p>}
    <div className="model-card-actions">
      <button className="popup-tab" disabled={busy} onClick={onToggle}>{busy ? 'Working…' : m.loaded ? 'Unload' : 'Load'}</button>
      {!system && <button className="popup-tab" onClick={onConfigure}>Tune</button>}
      <button className="popup-tab" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button>
      {!system && <DeleteModel model={m} file={file} onDeleted={onDeleted}/>}
    </div>
    {runtimeOptions && <MtpControl model={m} onChanged={onRefresh}/>}
    {open && <div className="mm-detail">
      {!detail && file && <p role="status">Reading the model file…</p>}
      {!file && <p className="mm-note">This model is served from the download cache; its file details are not in the model folder.</p>}
      {detail && <dl className="mm-facts">
        <div><dt>Architecture</dt><dd>{detail.summary.arch || '—'}</dd></div>
        <div><dt>Parameters</dt><dd>{String(detail.summary.general?.params || '—')}</dd></div>
        <div><dt>Quantisation</dt><dd>{String(detail.summary.general?.quant || '—')}</dd></div>
        <div><dt>Trained context</dt><dd>{tokens(model.context_length as number)}</dd></div>
        <div><dt>Layers</dt><dd>{tokens(model.block_count as number)}</dd></div>
        <div><dt>Attention heads (KV)</dt><dd>{tokens(model.attention_head_count as number)} ({typeof model.attention_head_count_kv === 'number' ? model.attention_head_count_kv : 'varies'})</dd></div>
        {file?.shape?.moe && <div><dt>Experts</dt><dd>{file.shape.experts} ({file.shape.active} active per token)</dd></div>}
        {detail.projector && <div><dt>Vision projector</dt><dd>{detail.projector.name}</dd></div>}
        <div><dt>File</dt><dd className="mm-mono">{detail.file}{detail.sharded ? ` (${detail.parts} parts)` : ''}</dd></div>
        <div><dt>Modified</dt><dd>{detail.modified}</dd></div>
        {Object.entries(detail.summary.chat_template_features || {}).some(([, v]) => v) && <div><dt>Chat template</dt><dd>{Object.entries(detail.summary.chat_template_features).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' ')).join(', ')}</dd></div>}
      </dl>}
      <EvidenceList model={m.name}/>
      <NativeCalibration model={m.name} onChanged={() => {}}/>
    </div>}
  </article>;
}

function DeleteModel({ model: m, file, onDeleted }: { model: InstalledModel; file?: FileEntry; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false), [removeSettings, setRemoveSettings] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      if (m.canDelete !== false && m.source !== 'preset') {
        const r = await apiFetch('/api/models/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: m.name }) });
        if (!r.ok) throw Error((await r.json()).error || 'Delete failed');
      } else if (file) {
        const v = await mm<{ results: { ok: boolean; message: string }[] }>('models/delete', { body: { models: [file.key] } });
        if (!v.results[0]?.ok) throw Error(v.results[0]?.message || 'Delete failed');
        if (removeSettings && file.sections.length) {
          const { revision } = await mm<{ revision: string }>('sections');
          let rev = revision;
          for (const section of file.sections) rev = (await mm<{ revision: string }>(`sections/${encodeURIComponent(section)}?baseRevision=${rev}`, { method: 'DELETE' })).revision;
        }
      } else throw Error('This model has no deletable files.');
      setConfirming(false); onDeleted();
    } catch (e) { setError(errorText(e, 'Delete failed')); } finally { setBusy(false); }
  };
  if (!confirming) return <button className="popup-tab model-card-danger" onClick={() => setConfirming(true)}>Delete</button>;
  return <div className="model-card-confirm" role="group" aria-label={`Delete ${m.name}`}>
    <p>Delete {file ? `${file.name} (${file.size}${file.projector ? ', with its vision projector' : ''})` : 'the downloaded files for this model'}? This cannot be undone.</p>
    {file && file.sections.length > 0 && <label className="mm-check"><input type="checkbox" checked={removeSettings} onChange={e => setRemoveSettings(e.target.checked)}/>Also remove its settings ({file.sections.join(', ')})</label>}
    <button className="popup-tab model-card-danger" disabled={busy} onClick={() => void run()}>{busy ? 'Deleting…' : 'Delete files'}</button>
    <button className="popup-tab" onClick={() => setConfirming(false)}>Keep</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div>;
}
