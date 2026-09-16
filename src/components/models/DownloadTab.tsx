import { useEffect, useRef, useState } from 'react';
import { bytes, ctxShort, errorText, mm, tokens } from './mm';

type Result = { id: string; downloads: number; likes: number; last_modified: string; pipeline_tag: string | null; gguf_count: number | null; downloaded: string[] };
type Estimate = { key: string; label: string; ctx: number; gpu_layers: number; total_layers: number; speed_pct: number; offload: boolean };
type Group = { shardBase: string; shards: number | null; bytes: number; size: string; quant: string | null; projector: boolean;
  fit: { name: string; verdict: string; ratio_pct: number; needs_gb?: number; ceiling_gb?: number }[]; files: { path: string; bytes: number; size: string }[]; estimates?: Estimate[]; nativeCtx?: number };
type Job = { id: string; repo: string; filename: string; status: string; error: string | null; bytes: number; downloaded: number; pct: number; speedH: string; etaH: string; parallel: boolean; chunks: { index: number; pct: number; status: string }[] };
const VERDICT: Record<string, string> = { fits: 'Fits', tight: 'Tight fit', oom: 'Needs CPU offload', impossible: 'Too large for this machine' };

export function DownloadTab({ onDownloaded, onSetUp, query = '', sort = 'downloads' }: { onDownloaded: () => void; onSetUp: (section: string) => void; query?: string; sort?: string }) {
  const [q, setQ] = useState(query);
  const [results, setResults] = useState<Result[] | null>(null), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [repo, setRepo] = useState<{ repo: string; groups: Group[]; gated?: string; error?: string } | null>(null), [repoBusy, setRepoBusy] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]), [message, setMessage] = useState('');
  const finished = useRef(new Set<string>());
  const search = async (term = q) => {
    setSearching(true); setError('');
    try { const v = await mm<{ results: Result[]; error?: string }>(`search?${new URLSearchParams({ q: term, sort, limit: '30' })}`); if (v.error) throw Error(v.error); setResults(v.results); }
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
      const done = v.jobs.filter(j => j.status === 'done' && !finished.current.has(j.id));
      if (done.length) { done.forEach(j => finished.current.add(j.id)); onDownloaded(); }
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
    try { const v = await mm<{ queued: string[] }>('downloads', { body }); setMessage(`Queued ${label}${v.queued.length > 1 ? ` and ${v.queued.length - 1} companion file${v.queued.length > 2 ? 's' : ''} (vision projector or prediction head)` : ''}.`); await refreshJobs(); }
    catch (e) { setError(errorText(e, 'Download could not start')); }
  };
  return <div className="mm-tab">
    <p className="mm-lede">Search Hugging Face for GGUF models. Each file is fetched as eight parallel parts and resumes after a restart. A model's vision projector is downloaded with it.</p>
    <HfToken/>
    <p className="mm-note" role="status">{searching ? 'Searching Hugging Face…' : q.trim() ? `Results for “${q.trim()}”.` : 'Type in the search box above to find a model.'}</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    <Queue jobs={jobs} onChange={refreshJobs} onSetUp={onSetUp}/>
    {repo && <RepoFiles repo={repo} onClose={() => setRepo(null)} onDownload={download}/>}
    {!repo && results && <ul className="mm-results" aria-label="Search results">
      {results.length === 0 && <li className="mm-note">No GGUF repositories match.</li>}
      {results.map(r => <li key={r.id}>
        <button className="mm-result-open" disabled={repoBusy === r.id} onClick={() => void openRepo(r.id)}>
          <strong>{r.id}</strong>
          <small>{tokens(r.downloads)} downloads · {tokens(r.likes)} likes{r.gguf_count != null ? ` · ${r.gguf_count} GGUF files` : ''}{r.last_modified ? ` · updated ${r.last_modified.slice(0, 10)}` : ''}</small>
          {r.downloaded.length > 0 && <span className="mm-pill is-good">Already downloaded</span>}
        </button>
      </li>)}
    </ul>}
    <UrlImport onQueued={() => void refreshJobs()}/>
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

function Queue({ jobs, onChange, onSetUp }: { jobs: Job[]; onChange: () => Promise<void>; onSetUp: (section: string) => void }) {
  if (!jobs.length) return null;
  const act = async (path: string) => { try { await mm(path, { body: {} }); } finally { await onChange(); } };
  // A finished download is a FILE, not a model the engine can serve. It becomes
  // one only once a models.ini section points at it and the preset file is
  // reloaded. Nothing said so, so a completed download looked like it had
  // simply not taken effect yet — the real answer to "it takes a while".
  const awaitingSetup = jobs.filter(j => j.status === 'done' && isModelFile(j.filename));
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
      {j.status === 'done' && isModelFile(j.filename) && <button className="popup-tab" onClick={() => onSetUp(j.filename.split('/').pop()!.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, ''))}>Set up this model</button>}
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

function UrlImport({ onQueued }: { onQueued: () => void }) {
  const [url, setUrl] = useState(''), [name, setName] = useState(''), [error, setError] = useState('');
  const go = async () => { setError(''); try { await mm('downloads', { body: { url, filename: name } }); setUrl(''); setName(''); onQueued(); } catch (e) { setError(errorText(e, 'Could not queue the URL')); } };
  return <details className="mm-disclosure"><summary>Download from a direct URL</summary><div className="mm-form">
    <label>File URL<input value={url} placeholder="https://…/model.gguf" onChange={e => setUrl(e.target.value)}/></label>
    <label>Save as (optional)<input value={name} placeholder="model-Q4_K_M.gguf" onChange={e => setName(e.target.value)}/></label>
    <button className="modal-btn secondary" disabled={!url.trim()} onClick={() => void go()}>Queue download</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div></details>;
}
