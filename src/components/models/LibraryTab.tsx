import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, fetchInstalledModels } from '../../api';
import type { InstalledModel } from '../../types';
import { MtpControl } from '../MtpControl';
import { NativeCalibration } from '../NativeCalibration';
import { EvidenceList } from './EvidenceList';
import { errorText, filterOrphanFiles, human, mm, num, tokens } from './mm';
import { appLocale } from '../../user-preferences';
import { httpErrorMessage, readErrorBody, runDeleteModelFiles } from './delete-model-sequence';
import { registerNewFolderModels } from './register';
import { useModelsChanged } from '../../models-changed';
import { MiddleTruncate } from '../MiddleTruncate';
import { AutoTune } from './AutoTune';
import { isSystemModel } from '../../model-system';
import { isChatGenerationModel } from '../../model-kind';
import { bytesToModelSizeGB, formatModelSizeGB } from '../../model-size';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

type FileEntry = { key: string; name: string; subdir: string; bytes: number; size: string; modified: string; mtime?: number; sharded: boolean; parts: number;
  projector: { name: string; bytes: number } | null; sections: string[]; modelId: string; file: string;
  shape: { arch: string; moe: boolean; experts: number; active: number; label: string } | null; loadedOn: string[];
  fit: { name: string; verdict: string; ratio_pct: number }[]; badges: { category: string; rating: number; note: string }[] };
// #609: the chat-template capabilities arrive as flag ids (accepts_enable_thinking, ...); they are
// worded by the catalogue, with the raw ids left in the tooltip. An id this build has no words for
// is shown as its own name.
const TEMPLATE_FLAGS = new Set(['accepts_enable_thinking', 'accepts_reasoning_effort', 'accepts_preserve_thinking', 'uses_think_tags', 'uses_channel_thought']);
const templateFlags = (features: Record<string, boolean> | undefined): string[] => Object.entries(features || {}).filter(([, v]) => v).map(([k]) => k);
/** The file's modified time in the interface locale, like the other dates on the page (#609). The
 *  server's own "2026-09-25 14:30" is only the fallback when it sent no timestamp. */
function modifiedText(detail: { mtime?: number; modified: string }, locale: string | undefined): string {
  if (typeof detail.mtime !== 'number' || !Number.isFinite(detail.mtime) || detail.mtime <= 0) return detail.modified;
  try { return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(detail.mtime * 1000)); }
  catch { return detail.modified; }
}
type Update = { status: string; remote: string; delta_days: number | null };
type Detail = FileEntry & { path: string; summary: { arch: string; general: Record<string, unknown>; model: Record<string, unknown>; chat_template_features: Record<string, boolean> } };
// #587: capability tags arrive as English words from the engine ("embeddings", "reranking") and
// the model manager's shape label ("dense"); known ones are shown in the interface language,
// anything else (a MoE shape like "128 experts") is shown as reported.
const TAG: Record<string, MessageKey> = { dense: 'mm.tag.dense', embedding: 'mm.tag.embeddings', embeddings: 'mm.tag.embeddings', rerank: 'mm.tag.reranking', reranking: 'mm.tag.reranking' };
export const tagLabel = (t: (k: MessageKey) => string, label: string) => { const k = TAG[label.trim().toLowerCase()]; return k ? t(k) : label; };
const BADGE: Record<string, MessageKey> = { coding: 'mm.badge.coding', writing: 'mm.badge.writing', reasoning: 'mm.badge.reasoning', tools: 'mm.badge.tools', vision: 'mm.badge.vision' };

export function LibraryTab({ onConfigure, onChanged, query = '', sort = 'name', filter = 'all' }: {
  onConfigure: (section: string) => void; onChanged: () => void;
  query?: string; sort?: 'name' | 'size' | 'modified'; filter?: 'all' | 'loaded' | 'vision' | 'unconfigured';
}) {
  const t = useT();
  // refresh() stays stable across a language change (it would refetch everything otherwise).
  const tRef = useRef(t);
  tRef.current = t;
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
    // `u.status` is missing rather than `{}` when the endpoint answers with an unexpected body —
    // `|| {}` keeps `updates[...]` a safe lookup instead of crashing on an undefined record.
    void mm<{ status: Record<string, Update> }>('models/updates').then((u) => setUpdates(u.status || {})).catch(() => undefined);
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
      setFilesNote(scan ? '' : tRef.current('mm.library.noService'));
    } catch (e) { setError(errorText(e, tRef.current('mm.library.unavailable'))); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // Tabs mount per selection, so a mount-only fetch left this list showing
  // whatever was true when the tab was last opened.
  useModelsChanged(useCallback(() => { void refresh(); }, [refresh]));
  const fileFor = (name: string) => files.find(f => f.sections.includes(name) || f.modelId === name);
  const act = async (verb: 'load' | 'unload', name: string) => {
    setBusy(name); setMessage('');
    try { const r = await apiFetch(`/api/models/${verb}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); if (!r.ok) throw Error((await r.json()).error || t(verb === 'load' ? 'mm.library.loadFailed' : 'mm.library.unloadFailed')); onChanged(); }
    catch (e) { setError(errorText(e, t('mm.library.opFailed'))); } finally { setBusy(''); }
  };
  const checkUpdates = async () => {
    setBusy('updates'); setMessage('');
    try { const v = await mm<{ checked: number; status: Record<string, Update> }>('models/check-updates', { body: {} }); setUpdates(v.status); setMessage(t.plural('mm.library.checked', v.checked)); }
    catch (e) { setError(errorText(e, t('mm.library.updateFailed'))); } finally { setBusy(''); }
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
      // #443: sizeGB is decimal GB, not bytes — scale it up so a model with no file-scan entry
      // yet still sorts on the same axis as one that has bytes, instead of always sorting last.
      if (sort === 'size') return (fileFor(b.name)?.bytes ?? (b.sizeGB != null ? b.sizeGB * 1e9 : 0)) - (fileFor(a.name)?.bytes ?? (a.sizeGB != null ? a.sizeGB * 1e9 : 0));
      if (sort === 'modified') return (fileFor(b.name)?.modified || '').localeCompare(fileFor(a.name)?.modified || '');
      return a.name.localeCompare(b.name);
    });
  const shownFiles = new Set(servable.map(m => fileFor(m.name)?.key).filter(Boolean));
  const orphanFiles = filterOrphanFiles(files.filter(f => !shownFiles.has(f.key)), query, filter);
  return <div className="mm-tab">
    {/* #430: the page's <h1> ("Models & routing") was followed directly by each model card's
        own <h3> — no <h2> anywhere on the page. This section heading (visually hidden; the
        "Your models" tab already carries the visible label) restores a valid h1 → h2 → h3
        sequence for every card, plus the optional auto-tuning/orphan-files <h3> sections below,
        without changing what the page looks like. */}
    <h2 className="sr-only">{t('mm.tab.yours')}</h2>
    <div className="mm-library-bar">
      <p className="mm-note" role="status">{models ? <>{t.plural('mm.library.count', installed.length, { shown: servable.length })}{needle ? t('mm.library.matching', { query: query.trim() }) : ''}{filter !== 'all' ? t('mm.library.afterFiltering') : ''}</> : t('mm.library.loading')}
        {disk && <> · <span data-testid="models-disk">{t('mm.library.disk', { free: human(disk.freeH), total: human(disk.totalH), used: num(disk.usedPct, 0) })}</span></>}
        {models && !scanned && <span className="mm-scanning"> · {t('mm.library.scanning')}</span>}</p>
      <button className="btn btn-secondary btn-sm" disabled={busy === 'updates'} onClick={() => void checkUpdates()}>{busy === 'updates' ? t('mm.checking') : t('mm.library.checkUpdates')}</button>
      {canTune && <button className="btn btn-secondary btn-sm" aria-expanded={showTune} aria-controls="library-autotune" onClick={() => setShowTune(v => !v)}>{t('mm.library.tuneUntuned')}</button>}
    </div>
    {showTune && <section className="mm-panel" id="library-autotune"><h3>{t('mm.library.autoTuning')}</h3><AutoTune onChanged={onChanged}/></section>}
    {error && <p role="alert" className="modal-err">{error}</p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    {filesNote && <p className="mm-note">{filesNote}</p>}
    {models && !servable.length && !orphanFiles.length && installed.length > 0 && <p className="mm-note">{t('mm.library.nothing')}</p>}
    <div className="model-grid">
    {servable.map(m => <ModelCard key={m.name} runtimeOptions={runtimeOptions} onRefresh={() => void refresh()} model={m} file={fileFor(m.name)} update={updates[fileFor(m.name)?.name || '']} busy={busy === m.name}
      onToggle={() => void act(m.loaded ? 'unload' : 'load', m.name)} onConfigure={() => onConfigure(m.name)}
      onDeleted={(err, rolesCleared) => {
        if (err) setError(err);
        else {
          // The card leaves the list the moment the server confirms the delete — the
          // noevia:models-changed refetch below is a consistency check, not what removes it.
          setModels(prev => (prev || []).filter(x => x.name !== m.name));
          if (rolesCleared && rolesCleared.length) setMessage(t('mm.delete.rolesCleared', { roles: rolesCleared.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ') }));
        }
        onChanged();
      }}/>)}
    </div>
    {orphanFiles.length > 0 && <section className="mm-panel"><h3>{t('mm.library.orphans')}</h3>
      <p className="mm-note">{t('mm.library.orphansNote')}</p>
      {/* #443: orphan files have no InstalledModel counterpart to share sizeGB with, but the
          scan still reports a raw byte count — reformat it through the same shared math so an
          orphan's size uses the same convention as every registered model's, rather than the
          external service's own (differently-based) formatted string. */}
      <ul className="mm-list">{orphanFiles.map(f => <li key={f.key}><span>{f.name}<small>{formatModelSizeGB(bytesToModelSizeGB(f.bytes), appLocale()) || human(f.size)}{f.subdir ? ` · ${f.subdir}/` : ''}</small></span>
        <button className="modal-btn secondary" onClick={() => onConfigure(f.name.replace(/\.gguf$/i, ''))}>{t('mm.createSettings')}</button></li>)}</ul></section>}
    {unregistered.length > 0 && orphanFiles.length === 0 && <p className="mm-note">{t('mm.library.unconfigured', { files: unregistered.join(', ') })}</p>}
  </div>;
}

function ModelCard({ model: m, file, update, busy, onToggle, onConfigure, onDeleted, runtimeOptions, onRefresh }: { model: InstalledModel; file?: FileEntry; update?: Update; busy: boolean; onToggle: () => void; onConfigure: () => void; onDeleted: (error?: string | null, rolesCleared?: string[]) => void; runtimeOptions: boolean; onRefresh: () => void }) {
  const t = useT();
  const [detail, setDetail] = useState<Detail | null>(null), [open, setOpen] = useState(false);
  const state = m.failed ? 'failed' : m.loaded ? 'loaded' : 'unloaded';
  useEffect(() => { if (open && file && !detail) void mm<Detail>(`models/detail?key=${encodeURIComponent(file.key)}`).then(setDetail).catch(() => {}); }, [open, file, detail]);
  const model = detail?.summary?.model || {};
  const system = isSystemModel(m.name);
  // #343/#336: tuning is a chat-model concept (the Overview copy says so) — hide it for any
  // embedding/reranking model, not just Laya. Delete stays hidden only for models a live sidecar
  // actually depends on right now (server-computed sidecarProtected, model-system.cjs
  // isSidecarModel) — deliberately NOT canDelete: canDelete can be false for other reasons (the
  // manager's own can_remove), and DeleteModel's run() already falls back to the folder-scan
  // delete path in exactly that case, so hiding the button on canDelete alone would hide a delete
  // path that still works and mislabel the model as sidecar-protected when it just isn't one.
  const chatModel = isChatGenerationModel(m.name, m.labels);
  const protectedModel = !system && m.sidecarProtected === true;
  // #548: Laya and the in-use embedding/reranker models are run by their own sidecars, so the
  // engine's Load/Unload would duplicate or break them (the server answers 409 too). #545: a
  // preset whose file is missing can only fail to load; it is also not tunable.
  const missing = m.missingFile === true;
  const engineControls = !system && !protectedModel && !missing;
  return <article className={`model-card surface${open ? ' is-open' : ''}`} data-state={state} aria-label={m.name}>
    <header className="model-card-head"><h3 className="model-card-name"><MiddleTruncate text={m.name}/></h3><span className="model-card-state">{missing ? t('mm.card.missing') : m.failed ? t('mm.card.failed') : m.loaded ? t('mm.loaded') : t('mm.card.unloaded')}</span></header>
    <p className="model-card-meta">
      {/* #443: this used to prefer file.size — a string formatted by the external Model Loader
          service, which most likely uses binary GiB while calling it "GB" — over m.sizeGB (the
          composer's decimal-GB number), so the same file showed two different sizes depending on
          which page you were on. m.sizeGB, run through the same shared formatter the composer
          uses, is now the only source: same field, same rounding, same label everywhere. */}
      {formatModelSizeGB(m.sizeGB, appLocale()) && <span>{formatModelSizeGB(m.sizeGB, appLocale())}</span>}
      {m.maxContext != null && <span>{t('mm.card.trainedFor', { tokens: tokens(m.maxContext) })}</span>}
      {file?.shape && <span>{tagLabel(t, file.shape.label)}</span>}
      {file?.projector && <span className="model-card-tag">{t('mm.card.vision')}</span>}
      {system && <span className="model-card-tag" title={t('mm.card.systemTitle')}>{t('model.systemLabel')}</span>}
      {protectedModel && <span className="model-card-tag" title={t('mm.card.protectedTitle')}>{t('mm.card.protectedLabel')}</span>}
      {m.labels.filter(l => l !== 'vision').map(l => <span key={l} className="model-card-tag">{tagLabel(t, l)}</span>)}
      {m.source && !missing && <span>{m.source === 'preset' ? t('mm.card.sourceFolder') : m.source === 'cache' ? t('mm.card.sourceCache') : m.source}</span>}
      {update?.status === 'stale' && <span className="mm-pill is-warn">{t('mm.card.update', { remote: update.remote })}</span>}
    </p>
    {file?.badges && file.badges.length > 0 && <p className="model-card-meta">{file.badges.map(b => <span key={b.category} className="model-card-tag">{BADGE[b.category] ? t(BADGE[b.category]) : b.category} {b.rating}/5</span>)}</p>}
    <div className="model-card-actions">
      {engineControls && <button className="popup-tab" disabled={busy} aria-label={t(m.loaded ? 'mm.card.unloadNamed' : 'mm.card.loadNamed', { model: m.name })} onClick={onToggle}>{busy ? t('mm.working') : m.loaded ? t('mm.card.unload') : t('mm.card.load')}</button>}
      {!system && !missing && chatModel && <button className="popup-tab" aria-label={t('mm.card.tuneNamed', { model: m.name })} onClick={onConfigure}>{t('mm.card.tune')}</button>}
      <button className="popup-tab" aria-expanded={open} aria-label={t(open ? 'mm.card.hideDetailsNamed' : 'mm.card.detailsNamed', { model: m.name })} onClick={() => setOpen(!open)}>{open ? t('mm.card.hideDetails') : t('mm.details')}</button>
      {!system && !protectedModel && <DeleteModel model={m} file={file} onDeleted={onDeleted}/>}
    </div>
    {missing && !open && <p className="mm-note" role="status">{t('mm.card.missingNote')}</p>}
    {runtimeOptions && !missing && <MtpControl model={m} onChanged={onRefresh}/>}
    {open && <div className="mm-detail">
      {!detail && file && <p role="status">{t('mm.readingFile')}</p>}
      {/* #579: the source line must match what the model actually is. A missing preset says so
          (even Laya); sidecar models have no file in the folder because their own service runs
          them; only a genuine download-cache model says it is served from the cache. */}
      {missing ? <p className="mm-note" role="status">{t('mm.card.missingNote')}</p>
        : !file && (system || protectedModel) ? <p className="mm-note">{t('mm.card.sidecarSource')}</p>
        : !file && <p className="mm-note">{t('mm.card.fromCache')}</p>}
      {detail && <dl className="mm-facts">
        <div><dt>{t('mm.card.arch')}</dt><dd>{detail.summary.arch || '—'}</dd></div>
        <div><dt>{t('mm.card.params')}</dt><dd>{String(detail.summary.general?.params || '—')}</dd></div>
        <div><dt>{t('mm.card.quant')}</dt><dd>{String(detail.summary.general?.quant || '—')}</dd></div>
        <div><dt>{t('mm.card.trainedCtx')}</dt><dd>{tokens(model.context_length as number)}</dd></div>
        <div><dt>{t('mm.card.layers')}</dt><dd>{tokens(model.block_count as number)}</dd></div>
        <div><dt>{t('mm.card.heads')}</dt><dd>{tokens(model.attention_head_count as number)} ({typeof model.attention_head_count_kv === 'number' ? model.attention_head_count_kv : t('mm.card.varies')})</dd></div>
        {file?.shape?.moe && <div><dt>{t('mm.card.experts')}</dt><dd>{t('mm.card.expertsValue', { experts: file.shape.experts, active: file.shape.active })}</dd></div>}
        {detail.projector && <div><dt>{t('mm.card.projector')}</dt><dd>{detail.projector.name}</dd></div>}
        <div><dt>{t('mm.card.file')}</dt><dd className="mm-mono">{detail.file}{detail.sharded ? ` (${t('mm.card.parts', { parts: detail.parts })})` : ''}</dd></div>
        <div><dt>{t('mm.card.modified')}</dt><dd>{modifiedText(detail, appLocale())}</dd></div>
        {templateFlags(detail.summary.chat_template_features).length > 0 && <div><dt>{t('mm.card.template')}</dt><dd title={templateFlags(detail.summary.chat_template_features).join(', ')}>{templateFlags(detail.summary.chat_template_features).map(k => TEMPLATE_FLAGS.has(k) ? t(`mm.tpl.${k}` as MessageKey) : k.replace(/_/g, ' ')).join(', ')}</dd></div>}
      </dl>}
      {/* Chat qualification evidence (and its Recheck) only means something for a chat model the
          engine runs: not Laya, not a sidecar model, not a preset whose file is missing. */}
      {engineControls && <EvidenceList model={m.name}/>}
      {system ? <p className="mm-note" role="status">{t('model.systemLabel')}{t('mm.card.systemNote')}</p>
        : protectedModel ? <p className="mm-note" role="status">{t('mm.card.protectedLabel')}{t('mm.card.protectedNote')}</p>
        : missing ? null
        : !chatModel ? <p className="mm-note" role="status">{t('mm.card.nonChatNote')}</p>
        : <NativeCalibration model={m.name} onChanged={() => {}}/>}
    </div>}
  </article>;
}

function DeleteModel({ model: m, file, onDeleted }: { model: InstalledModel; file?: FileEntry; onDeleted: (error?: string | null, rolesCleared?: string[]) => void }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false), [removeSettings, setRemoveSettings] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The files are gone but settings clean-up failed: say so in the interface language.
  const cleanupText = (detail?: string) => (detail ? t('mm.delete.cleanupFailedDetail', { detail }) : t('mm.delete.cleanupFailed'));
  const run = async () => {
    setBusy(true); setError('');
    try {
      if (m.canDelete !== false && m.source !== 'preset') {
        const outcome = await runDeleteModelFiles(async () => {
          const r = await apiFetch('/api/models/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: m.name }) });
          if (!r.ok) throw Error(httpErrorMessage(r.status, (await readErrorBody(r)).error));
          const body = (await r.json().catch(() => ({}))) as { rolesCleared?: string[] };
          return Array.isArray(body.rolesCleared) ? body.rolesCleared : [];
        });
        setConfirming(false); onDeleted(outcome.error && cleanupText(outcome.cleanupDetail), outcome.rolesCleared); return;
      }
      if (file) {
        const outcome = await runDeleteModelFiles(
          async () => {
            // Folder-configured (source: 'preset') models take this path: the proxy also
            // unloads the engine model(s) the deleted file backed and clears any auto-role
            // that named them (#302), reporting back the same rolesCleared shape as the
            // primary /api/models/delete path above.
            const v = await mm<{ results: { ok: boolean; message: string }[]; rolesCleared?: string[] }>('models/delete', { body: { models: [file.key] } });
            if (!v.results[0]?.ok) throw Error(v.results[0]?.message || t('mm.deleteFailed'));
            return Array.isArray(v.rolesCleared) ? v.rolesCleared : [];
          },
          removeSettings && file.sections.length ? async () => {
            const { revision } = await mm<{ revision: string }>('sections');
            let rev = revision;
            for (const section of file.sections) rev = (await mm<{ revision: string }>(`sections/${encodeURIComponent(section)}?baseRevision=${rev}`, { method: 'DELETE' })).revision;
          } : undefined,
        );
        setConfirming(false); onDeleted(outcome.error && cleanupText(outcome.cleanupDetail), outcome.rolesCleared); return;
      }
      throw Error(t('mm.delete.noFiles'));
    } catch (e) { setError(errorText(e, t('mm.deleteFailed'))); } finally { setBusy(false); }
  };
  if (!confirming) return <button className="popup-tab model-card-danger" aria-label={t('mm.delete.label', { model: m.name })} onClick={() => setConfirming(true)}>{t('mm.delete')}</button>;
  return <div className="model-card-confirm" role="group" aria-label={t('mm.delete.label', { model: m.name })}>
    <p>{file ? t(file.projector ? 'mm.delete.confirmFileProjector' : 'mm.delete.confirmFile', { file: file.name, size: formatModelSizeGB(bytesToModelSizeGB(file.bytes), appLocale()) || human(file.size) }) : t('mm.delete.confirmCache')}</p>
    {file && file.sections.length > 0 && <label className="mm-check"><input type="checkbox" checked={removeSettings} onChange={e => setRemoveSettings(e.target.checked)}/>{t('mm.delete.alsoSettings', { sections: file.sections.join(', ') })}</label>}
    <button className="popup-tab model-card-danger" disabled={busy} onClick={() => void run()}>{busy ? t('mm.delete.deleting') : t('mm.delete.files')}</button>
    <button className="popup-tab" onClick={() => setConfirming(false)}>{t('mm.keep')}</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div>;
}
