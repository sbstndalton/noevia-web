import { useEffect, useRef, useState } from 'react';
import { bytes, ctxShort, errorText, mm, tokens } from './mm';
import { registerSafeDefaults } from './register';

type Option = { path: string; gb: number; quant: string | null; shards: number; fits: boolean; reasons: string[] };
type Result = { id: string; owner: string; downloads: number; likes: number; lastModified: string; ageDays: number; license: string | null;
  params: number | null; activeParams: number | null; moe: boolean; vision: boolean; trusted: boolean; suitable: boolean;
  reasons: string[]; options: Option[]; best: Option | null; downloaded: string[] };
type SearchBody = { results: Result[]; error?: string; budgetGb?: number; hubUrl?: string;
  counts?: { found: number; shown: number; hiddenUntrusted: number; hiddenUnsuitable: number } };
type Filters = { trustedOnly: boolean; showUnsuitable: boolean; maxGb: string; minGb: string; quants: string[]; minParams: string; maxParams: string; moe: string; vision: boolean; license: string; owner: string };
const EMPTY_FILTERS: Filters = { trustedOnly: true, showUnsuitable: false, maxGb: '', minGb: '', quants: [], minParams: '', maxParams: '', moe: 'any', vision: false, license: '', owner: '' };
const QUANT_CHOICES = ['Q4_K_M', 'Q4_K_S', 'UD-Q4_K_XL', 'Q5_K_M', 'Q6_K', 'Q8_0', 'MXFP4'];
const paramLabel = (r: Result) => (r.params ? `${r.params}B${r.activeParams ? ` (${r.activeParams}B active)` : ''}` : null);
type Estimate = { key: string; label: string; ctx: number; gpu_layers: number; total_layers: number; speed_pct: number; offload: boolean };
type Group = { shardBase: string; shards: number | null; bytes: number; size: string; quant: string | null; projector: boolean;
  fit: { name: string; verdict: string; ratio_pct: number; needs_gb?: number; ceiling_gb?: number }[]; files: { path: string; bytes: number; size: string }[]; estimates?: Estimate[]; nativeCtx?: number };
type Job = { id: string; repo: string; filename: string; status: string; error: string | null; bytes: number; downloaded: number; pct: number; speedH: string; etaH: string; parallel: boolean; chunks: { index: number; pct: number; status: string }[] };
const VERDICT: Record<string, string> = { fits: 'Fits', tight: 'Tight fit', oom: 'Needs CPU offload', impossible: 'Too large for this machine' };

export function DownloadTab({ onDownloaded, onSetUp, query = '', sort = 'fit' }: { onDownloaded: () => void; onSetUp: (section: string) => void; query?: string; sort?: string }) {
  const [q, setQ] = useState(query);
  const [results, setResults] = useState<Result[] | null>(null), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [meta, setMeta] = useState<SearchBody | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const filterRef = useRef(filters); filterRef.current = filters;
  const [repo, setRepo] = useState<{ repo: string; groups: Group[]; gated?: string; error?: string } | null>(null), [repoBusy, setRepoBusy] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]), [message, setMessage] = useState('');
  const finished = useRef(new Set<string>()), seeded = useRef(false);
  const [targets, setTargets] = useState<{ id: string; label: string; path: string }[]>([]), [saveTo, setSaveTo] = useState('');
  useEffect(() => { void mm<{ targets: { id: string; label: string; path: string }[] }>('download-targets').then(v => setTargets(v.targets || [])).catch(() => undefined); }, []);
  const [target, setTarget] = useState<{ path: string; hostPath?: string | null; disk?: { freeH: string } | null } | null>(null);
  useEffect(() => { void mm<{ modelsDir?: { path: string; hostPath?: string | null; disk?: { freeH: string } | null } }>('overview').then(v => setTarget(v.modelsDir || null)).catch(() => undefined); }, []);
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  const search = async (term = q) => {
    setSearching(true); setError('');
    const f = filterRef.current;
    const params = new URLSearchParams({ q: term, sort, limit: '40', trustedOnly: String(f.trustedOnly), showUnsuitable: String(f.showUnsuitable), moe: f.moe });
    if (f.minGb) params.set('minGb', f.minGb);
    if (f.maxGb) params.set('maxGb', f.maxGb);
    if (f.quants.length) params.set('quants', f.quants.join(','));
    if (f.minParams) params.set('minParams', f.minParams);
    if (f.maxParams) params.set('maxParams', f.maxParams);
    if (f.vision) params.set('vision', 'true');
    if (f.license.trim()) params.set('license', f.license.trim());
    if (f.owner.trim()) params.set('owner', f.owner.trim());
    try { const v = await mm<SearchBody>(`search?${params}`); if (v.error) throw Error(v.error); setResults(v.results); setMeta(v); }
    catch (e) { setError(errorText(e, 'Search failed')); } finally { setSearching(false); }
  };
  const openRepo = async (id: string) => {
    setRepoBusy(id); setError('');
    try { setRepo(await mm(`search/repo?repo=${encodeURIComponent(id)}`)); }
    catch (e) { setError(errorText(e, 'Could not read the repository')); } finally { setRepoBusy(''); }
  };
  const refreshJobs = async () => {
    try {
      const v = await mm<{ jobs: Job[] }>('downloads'); setJobs(v.jobs);
      // Jobs already done on the first read finished earlier (possibly deleted since): never re-register them.
      if (!seeded.current) { seeded.current = true; v.jobs.filter(j => j.status === 'done').forEach(j => finished.current.add(j.id)); }
      const done = v.jobs.filter(j => j.status === 'done' && !finished.current.has(j.id));
      if (done.length) {
        done.forEach(j => finished.current.add(j.id));
        const notes: string[] = [];
        for (const j of done.filter(j => isModelFile(j.filename))) {
          const note = await registerSafeDefaults(sectionFor(j.filename));
          if (note.registered) setRegistered(prev => new Set(prev).add(j.id));
          if (note.text) notes.push(note.text);
        }
        if (notes.length) setMessage(notes.join(' '));
        onDownloaded();
      }
    } catch {}
  };
  useEffect(() => { void search(); void refreshJobs(); }, []);
  // Debounced so typing in the page's search box does not fire a request per
  // keystroke at Hugging Face.
  useEffect(() => {
    setQ(query);
    if (!query.trim()) return;
    const t = setTimeout(() => { setRepo(null); void search(query); }, 400);
    return () => clearTimeout(t);
  }, [query]);
  const firstSort = useRef(true);
  useEffect(() => { if (firstSort.current) { firstSort.current = false; return; } setRepo(null); void search(); }, [sort]);
  const active = jobs.some(j => ['queued', 'downloading'].includes(j.status));
  useEffect(() => { if (!active) return; const t = setInterval(() => void refreshJobs(), 1500); return () => clearInterval(t); }, [active]);
  const download = async (body: Record<string, unknown>, label: string) => {
    setMessage(''); setError('');
    try { const v = await mm<{ queued: string[] }>('downloads', { body: { ...body, target: saveTo } }); setMessage(`Queued ${label}${v.queued.length > 1 ? ` and ${v.queued.length - 1} companion file${v.queued.length > 2 ? 's' : ''} (vision projector or prediction head)` : ''}.`); await refreshJobs(); }
    catch (e) { setError(errorText(e, 'Download could not start')); }
  };
  return <div className="mm-tab">
    <p className="mm-lede">Search Hugging Face for GGUF models. Each file is fetched as eight parallel parts and resumes after a restart. A model's vision projector is downloaded with it.</p>
    {target && <p className="mm-note" data-testid="download-target">Downloads go to <strong className="mm-mono">{saveTo ? `${target.hostPath || target.path}/${saveTo}` : target.hostPath || target.path}</strong>{target.disk && !saveTo ? ` · ${target.disk.freeH} free` : ''}. The engine reads this whole folder; other shares appear here once they are mounted inside it.</p>}
    {targets.length > 1 && <label className="mm-select mm-save-to">Save to<select value={saveTo} onChange={e => setSaveTo(e.target.value)}>{targets.map(t => <option key={t.id} value={t.id}>{t.id ? t.label : 'Models folder (default)'}</option>)}</select></label>}
    <HfToken/>
    <p className="mm-note" role="status">{searching ? 'Searching Hugging Face…'
      : q.trim() ? `Results for “${q.trim()}”${meta?.counts ? `: ${meta.counts.shown} of ${meta.counts.found}` : ''}${meta?.budgetGb ? `, judged against ${meta.budgetGb} GB of GPU memory` : ''}.`
        : 'Type in the search box above to find a model, or browse what fits this server below.'}</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    <Queue jobs={jobs} registered={registered} onChange={refreshJobs} onSetUp={onSetUp}/>
    {repo && <RepoFiles repo={repo} onClose={() => setRepo(null)} onDownload={download}/>}
    {!repo && <SearchFilters filters={filters} meta={meta} onChange={(patch) => { const next = { ...filters, ...patch }; setFilters(next); filterRef.current = next; setRepo(null); void search(); }}/>}
    {!repo && results && <ul className="mm-results" aria-label="Search results">
      {results.length === 0 && <li className="mm-note">Nothing matches these filters{meta?.counts?.hiddenUntrusted ? `; ${meta.counts.hiddenUntrusted} hidden as untrusted publishers` : ''}{meta?.counts?.hiddenUnsuitable ? `; ${meta.counts.hiddenUnsuitable} hidden as unsuitable for this server` : ''}.</li>}
      {results.map(r => <li key={r.id}>
        <button className="mm-result-open" disabled={repoBusy === r.id} onClick={() => void openRepo(r.id)}>
          <strong>{r.id}</strong>
          <small>{[paramLabel(r), r.moe ? 'mixture of experts' : r.params ? 'dense' : null, r.best ? `${r.best.quant || 'GGUF'} · ${r.best.gb} GB` : null,
            r.vision ? 'vision' : null, r.license, `${tokens(r.downloads)} downloads`, r.ageDays <= 45 ? `updated ${r.ageDays}d ago` : r.lastModified ? `updated ${r.lastModified.slice(0, 10)}` : null].filter(Boolean).join(' · ')}</small>
          <span className="mm-result-pills">
            {r.trusted && <span className="mm-pill is-good">Trusted publisher</span>}
            {r.suitable ? <span className="mm-pill is-good">Fits this server</span> : <span className="mm-pill">{r.reasons[0] || 'Not usable here'}</span>}
            {r.downloaded.length > 0 && <span className="mm-pill is-good">Already downloaded</span>}
          </span>
        </button>
      </li>)}
    </ul>}
    <UrlImport target={saveTo} onQueued={() => void refreshJobs()}/>
  </div>;
}

function RepoFiles({ repo, onClose, onDownload }: { repo: { repo: string; groups: Group[]; gated?: string; error?: string }; onClose: () => void; onDownload: (body: Record<string, unknown>, label: string) => void }) {
  const models = repo.groups.filter(g => g.files[0].path.toLowerCase().endsWith('.gguf') && !g.projector);
  const projectors = repo.groups.filter(g => g.projector);
  return <section className="mm-panel" aria-labelledby="mm-repo">
    <header className="mm-panel-head"><h3 id="mm-repo">{repo.repo}</h3><button className="modal-btn secondary" onClick={onClose}>Back to results</button></header>
    {repo.error && <p role="alert" className="modal-err">{repo.error}</p>}
    {repo.gated && <p className="mm-note">Context estimates are unavailable: {repo.gated} Add a Hugging Face token above if you have access.</p>}
    {projectors.length > 0 && <p className="mm-note">This repository ships a vision projector; it downloads with any model file.</p>}
    <p className="mm-note">Estimates use the same fit maths as Autoconfig for this server. Speed is relative to running fully on the GPU.</p>
    <div className="mm-table-wrap"><table className="mm-table">
      <thead><tr><th scope="col">File</th><th scope="col">Size</th><th scope="col">Fit</th><th scope="col">Context estimates</th><th scope="col"><span className="sr-only">Download</span></th></tr></thead>
      <tbody>{models.map(g => <tr key={g.shardBase}>
        <td><strong>{g.quant || '—'}</strong><small className="mm-mono">{g.files[0].path}{g.shards ? ` (+${g.shards - 1} parts)` : ''}</small></td>
        <td>{g.size}</td>
        <td>{g.fit.map(f => <span key={f.name} className={`mm-pill ${f.verdict === 'fits' ? 'is-good' : f.verdict === 'tight' ? 'is-warn' : 'is-bad'}`}>{VERDICT[f.verdict] || f.verdict}</span>)}</td>
        <td>{g.estimates?.length ? g.estimates.map(e => <span key={e.key} className="mm-est">{e.label}: {ctxShort(e.ctx)}{e.offload ? ` · ${e.gpu_layers}/${e.total_layers} layers on GPU · ~${e.speed_pct}% speed` : ''}</span>) : <small>—</small>}{g.nativeCtx ? <small>Trained for {tokens(g.nativeCtx)}</small> : null}</td>
        <td><button className="popup-tab" onClick={() => onDownload(g.shards ? { repo: repo.repo, shardBase: g.shardBase } : { repo: repo.repo, path: g.files[0].path }, g.files[0].path)}>Download</button></td>
      </tr>)}</tbody>
    </table></div>
    {models.length === 0 && <p className="mm-note">No GGUF model files in this repository.</p>}
  </section>;
}

const isModelFile = (filename: string) => filename.toLowerCase().endsWith('.gguf') && !filename.toLowerCase().includes('mmproj');
const sectionFor = (filename: string) => filename.split('/').pop()!.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');


function Queue({ jobs, registered, onChange, onSetUp }: { jobs: Job[]; registered: Set<string>; onChange: () => Promise<void>; onSetUp: (section: string) => void }) {
  if (!jobs.length) return null;
  const act = async (path: string) => { try { await mm(path, { body: {} }); } finally { await onChange(); } };
  // A finished download is a FILE, not a model the engine can serve. It becomes
  // one only once a models.ini section points at it and the preset file is
  // reloaded. Nothing said so, so a completed download looked like it had
  // simply not taken effect yet — the real answer to "it takes a while".
  const awaitingSetup = jobs.filter(j => j.status === 'done' && isModelFile(j.filename) && !registered.has(j.id));
  return <section className="mm-panel" aria-labelledby="mm-queue">
    <header className="mm-panel-head"><h3 id="mm-queue">Downloads</h3>{jobs.some(j => !['queued', 'downloading'].includes(j.status)) && <button className="modal-btn secondary" onClick={() => void act('downloads/clear')}>Clear finished</button>}</header>
    {awaitingSetup.length > 0 && <p className="mm-note" role="status" data-testid="download-setup-needed">
      {awaitingSetup.length === 1 ? 'This file is downloaded but not yet a model the engine can serve.' : `${awaitingSetup.length} files are downloaded but are not yet models the engine can serve.`}
      {' '}Choose <strong>Set up this model</strong> to give it settings and add it to the Library. Setting up reloads the engine's preset file, which is refused while a model is loaded — unload it first if asked.
    </p>}
    <ul className="mm-jobs">{jobs.map(j => <li key={j.id}>
      <div className="mm-job-head"><strong>{j.filename}</strong><span>{j.status === 'downloading' ? `${j.pct.toFixed(0)}% · ${j.speedH} · ${j.etaH} left` : j.status === 'done' ? 'Done' : j.status === 'error' ? `Failed: ${j.error || 'unknown error'}` : j.status === 'canceled' ? 'Cancelled' : 'Queued'}</span></div>
      <progress max={100} value={j.pct} aria-label={`${j.filename} progress`}/>
      {j.parallel && j.status === 'downloading' && <div className="mm-chunks" aria-label="Parallel parts">{j.chunks.map(c => <span key={c.index} title={`Part ${c.index + 1}: ${c.pct.toFixed(0)}%`}><i style={{ width: `${c.pct}%` }}/></span>)}</div>}
      <small>{bytes(j.downloaded)} of {j.bytes ? bytes(j.bytes) : 'unknown size'} · {j.repo}</small>
      {['queued', 'downloading'].includes(j.status) && <button className="popup-tab" onClick={() => void act(`downloads/${j.id}/cancel`)}>Cancel</button>}
      {j.status === 'done' && isModelFile(j.filename) && <button className="popup-tab" onClick={() => onSetUp(sectionFor(j.filename))}>{registered.has(j.id) ? 'Review settings' : 'Set up this model'}</button>}
    </li>)}</ul>
  </section>;
}

function HfToken() {
  const [state, setState] = useState<{ hasToken: boolean; tokenHint: string; test?: { ok: boolean; message: string } } | null>(null), [value, setValue] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void mm<{ hasToken: boolean; tokenHint: string }>('settings').then(setState).catch(() => {}); }, []);
  const save = async (test: boolean) => { setBusy(true); try { setState(await mm('settings', { method: 'PUT', body: { ...(value ? { hfToken: value } : {}), test } })); setValue(''); } finally { setBusy(false); } };
  return <details className="mm-disclosure"><summary>Hugging Face token {state?.hasToken ? `(saved ${state.tokenHint})` : '(optional)'}</summary>
    <div className="mm-form">
      <p className="mm-note">Needed only for gated repositories. Stored by the model manager on this server.</p>
      <label>Token<input type="password" autoComplete="off" value={value} placeholder={state?.hasToken ? 'Enter a new token to replace it' : 'hf_…'} onChange={e => setValue(e.target.value)}/></label>
      <div className="mm-actions"><button className="modal-btn secondary" disabled={busy} onClick={() => void save(false)}>Save</button><button className="modal-btn secondary" disabled={busy} onClick={() => void save(true)}>Save and test</button>
        {state?.hasToken && <button className="modal-btn secondary" disabled={busy} onClick={() => void mm('settings', { method: 'PUT', body: { hfToken: '' } }).then(v => setState(v as typeof state))}>Remove token</button>}</div>
      {state?.test && <p role="status" className={state.test.ok ? 'mm-note' : 'modal-err'}>{state.test.message}</p>}
    </div></details>;
}

function UrlImport({ onQueued, target }: { onQueued: () => void; target: string }) {
  const [url, setUrl] = useState(''), [name, setName] = useState(''), [error, setError] = useState('');
  const go = async () => { setError(''); try { await mm('downloads', { body: { url, filename: name, target } }); setUrl(''); setName(''); onQueued(); } catch (e) { setError(errorText(e, 'Could not queue the URL')); } };
  return <details className="mm-disclosure"><summary>Download from a direct URL</summary><div className="mm-form">
    <label>File URL<input value={url} placeholder="https://…/model.gguf" onChange={e => setUrl(e.target.value)}/></label>
    <label>Save as (optional)<input value={name} placeholder="model-Q4_K_M.gguf" onChange={e => setName(e.target.value)}/></label>
    <button className="modal-btn secondary" disabled={!url.trim()} onClick={() => void go()}>Queue download</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div></details>;
}

// Hugging Face's own filters, plus the two this server cares about: who quantised it, and whether
// it can actually run here (roadmap D19/D20).
function SearchFilters({ filters, meta, onChange }: { filters: Filters; meta: SearchBody | null; onChange: (patch: Partial<Filters>) => void }) {
  const toggleQuant = (quant: string) => onChange({ quants: filters.quants.includes(quant) ? filters.quants.filter(x => x !== quant) : [...filters.quants, quant] });
  const active = filters.quants.length + (filters.minGb ? 1 : 0) + (filters.maxGb ? 1 : 0) + (filters.minParams ? 1 : 0) + (filters.maxParams ? 1 : 0) + (filters.moe !== 'any' ? 1 : 0) + (filters.vision ? 1 : 0) + (filters.license ? 1 : 0) + (filters.owner ? 1 : 0);
  return <details className="mm-disclosure mm-filters" open={active > 0}>
    <summary>Filters <small>{active ? `${active} active` : 'size, parameters, architecture, licence, publisher'}</small></summary>
    <div className="mm-filter-grid">
      <label className="mm-check"><input type="checkbox" checked={filters.trustedOnly} onChange={e => onChange({ trustedOnly: e.target.checked })}/>Trusted publishers only{meta?.counts?.hiddenUntrusted ? ` (${meta.counts.hiddenUntrusted} hidden)` : ''}</label>
      <label className="mm-check"><input type="checkbox" checked={filters.showUnsuitable} onChange={e => onChange({ showUnsuitable: e.target.checked })}/>Show models that do not fit this server{meta?.counts?.hiddenUnsuitable ? ` (${meta.counts.hiddenUnsuitable} hidden)` : ''}</label>
      <label className="mm-check"><input type="checkbox" checked={filters.vision} onChange={e => onChange({ vision: e.target.checked })}/>Vision only</label>
      <label className="mm-select">Architecture<select value={filters.moe} onChange={e => onChange({ moe: e.target.value })}>
        <option value="any">Any</option><option value="moe">Mixture of experts</option><option value="dense">Dense</option>
      </select></label>
      <label className="mm-select">File size (GB)<span className="mm-range"><input inputMode="decimal" placeholder="min" value={filters.minGb} onChange={e => onChange({ minGb: e.target.value })}/><input inputMode="decimal" placeholder="max" value={filters.maxGb} onChange={e => onChange({ maxGb: e.target.value })}/></span></label>
      <label className="mm-select">Parameters (B)<span className="mm-range"><input inputMode="decimal" placeholder="min" value={filters.minParams} onChange={e => onChange({ minParams: e.target.value })}/><input inputMode="decimal" placeholder="max" value={filters.maxParams} onChange={e => onChange({ maxParams: e.target.value })}/></span></label>
      <label className="mm-select">Licence<input placeholder="apache, mit…" value={filters.license} onChange={e => onChange({ license: e.target.value })}/></label>
      <label className="mm-select">Publisher<input placeholder="unsloth, ibm-granite…" value={filters.owner} onChange={e => onChange({ owner: e.target.value })}/></label>
      <fieldset className="mm-quant-filter"><legend className="set-row-label">Quantisation</legend>
        {QUANT_CHOICES.map(quant => <label key={quant} className="mm-check"><input type="checkbox" checked={filters.quants.includes(quant)} onChange={() => toggleQuant(quant)}/>{quant}</label>)}
      </fieldset>
    </div>
    <div className="mm-filter-actions">
      <button className="modal-btn secondary" onClick={() => onChange(EMPTY_FILTERS)}>Clear filters</button>
      <a className="mm-link" href={meta?.hubUrl || 'https://huggingface.co/models?filter=gguf&sort=trending'} target="_blank" rel="noopener noreferrer">Open this search on Hugging Face ↗</a>
    </div>
  </details>;
}
