import { useEffect, useRef, useState } from 'react';
import { bytes, ctxShort, errorText, mm, tokens } from './mm';
import { registerSafeDefaults } from './register';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';

type Option = { path: string; gb: number; quant: string | null; shards: number; fits: boolean; reasons: string[] };
type Result = { id: string; owner: string; downloads: number; likes: number; lastModified: string; ageDays: number; license: string | null;
  params: number | null; activeParams: number | null; moe: boolean; vision: boolean; trusted: boolean; suitable: boolean;
  reasons: string[]; options: Option[]; best: Option | null; downloaded: string[] };
type SearchBody = { results: Result[]; error?: string; budgetGb?: number; hubUrl?: string;
  counts?: { found: number; shown: number; hiddenUntrusted: number; hiddenUnsuitable: number } };
type Filters = { trustedOnly: boolean; showUnsuitable: boolean; maxGb: string; minGb: string; quants: string[]; minParams: string; maxParams: string; moe: string; vision: boolean; license: string; owner: string };
const EMPTY_FILTERS: Filters = { trustedOnly: true, showUnsuitable: false, maxGb: '', minGb: '', quants: [], minParams: '', maxParams: '', moe: 'any', vision: false, license: '', owner: '' };
const QUANT_CHOICES = ['Q4_K_M', 'Q4_K_S', 'UD-Q4_K_XL', 'Q5_K_M', 'Q6_K', 'Q8_0', 'MXFP4'];
const paramLabel = (t: Translate, r: Result) => (r.params ? `${r.params}B${r.activeParams ? ` (${t('mm.discover.active', { params: `${r.activeParams}B` })})` : ''}` : null);
type Estimate = { key: string; label: string; ctx: number; gpu_layers: number; total_layers: number; speed_pct: number; offload: boolean };
type Group = { shardBase: string; shards: number | null; bytes: number; size: string; quant: string | null; projector: boolean;
  fit: { name: string; verdict: string; ratio_pct: number; needs_gb?: number; ceiling_gb?: number }[]; files: { path: string; bytes: number; size: string }[]; estimates?: Estimate[]; nativeCtx?: number };
type Job = { id: string; repo: string; filename: string; status: string; error: string | null; bytes: number; downloaded: number; pct: number; speedH: string; etaH: string; parallel: boolean; chunks: { index: number; pct: number; status: string }[] };
const VERDICT: Record<string, MessageKey> = { fits: 'mm.verdict.fits', tight: 'mm.verdict.tight', oom: 'mm.verdict.oom', impossible: 'mm.verdict.impossible' };

export function DownloadTab({ onDownloaded, onSetUp, query = '', sort = 'fit' }: { onDownloaded: () => void; onSetUp: (section: string) => void; query?: string; sort?: string }) {
  const t = useT();
  const tRef = useRef(t); tRef.current = t;
  const [q, setQ] = useState(query);
  const [results, setResults] = useState<Result[] | null>(null), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [meta, setMeta] = useState<SearchBody | null>(null);
  // What the results on screen were actually fetched for. The live search box runs 400ms
  // behind, so reading `q` here would caption the old results with the new query.
  const [shown, setShown] = useState('');
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
  const search = async (raw = q) => {
    const term = raw.trim();
    // A new search invalidates whatever repository is expanded: its file list belongs to a
    // result that may no longer be on screen. The sort and filter paths already did this;
    // pressing Enter in the search box did not.
    setSearching(true); setError(''); setRepo(null);
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
    // The server answers a failed hub call with 200 and an `error` field, so a bare
    // `v.results` check would read as "nothing matched" for what is really an outage.
    try { const v = await mm<SearchBody>(`search?${params}`); if (v.error) throw Error(v.error); setResults(v.results || []); setMeta(v); setShown(term); }
    catch (e) { setError(errorText(e, tRef.current('mm.discover.searchFailed'))); } finally { setSearching(false); }
  };
  const openRepo = async (id: string) => {
    setRepoBusy(id); setError('');
    try { setRepo(await mm(`search/repo?repo=${encodeURIComponent(id)}`)); }
    catch (e) { setError(errorText(e, t('mm.discover.repoFailed'))); } finally { setRepoBusy(''); }
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
    const timer = setTimeout(() => { setRepo(null); void search(query); }, 400);
    return () => clearTimeout(timer);
  }, [query]);
  const firstSort = useRef(true);
  useEffect(() => { if (firstSort.current) { firstSort.current = false; return; } setRepo(null); void search(); }, [sort]);
  const active = jobs.some(j => ['queued', 'downloading'].includes(j.status));
  useEffect(() => { if (!active) return; const timer = setInterval(() => void refreshJobs(), 1500); return () => clearInterval(timer); }, [active]);
  const download = async (body: Record<string, unknown>, label: string) => {
    setMessage(''); setError('');
    try { const v = await mm<{ queued: string[] }>('downloads', { body: { ...body, target: saveTo } }); setMessage(v.queued.length > 1 ? t.plural('mm.discover.queuedWith', v.queued.length - 1, { file: label }) : t('mm.discover.queued', { file: label })); await refreshJobs(); }
    catch (e) { setError(errorText(e, t('mm.discover.downloadFailed'))); }
  };
  const applyFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next); filterRef.current = next; setRepo(null); void search();
  };
  // Only offer a way out for a filter that is actually hiding something right now.
  const hiddenByTrust = filters.trustedOnly ? meta?.counts?.hiddenUntrusted || 0 : 0;
  const hiddenByFit = filters.showUnsuitable ? 0 : meta?.counts?.hiddenUnsuitable || 0;
  return <div className="mm-tab">
    <p className="mm-lede">{t('mm.discover.lede')}</p>
    {target && <p className="mm-note" data-testid="download-target">{t('mm.discover.targetBefore')}<strong className="mm-mono">{saveTo ? `${target.hostPath || target.path}/${saveTo}` : target.hostPath || target.path}</strong>{target.disk && !saveTo ? ` · ${t('mm.discover.free', { free: target.disk.freeH })}` : ''}{t('mm.discover.targetAfter')}</p>}
    {targets.length > 1 && <label className="mm-select mm-save-to">{t('mm.discover.saveTo')}<select value={saveTo} onChange={e => setSaveTo(e.target.value)}>{targets.map(x => <option key={x.id} value={x.id}>{x.id ? x.label : t('mm.discover.defaultFolder')}</option>)}</select></label>}
    <HfToken/>
    <p className="mm-note" role="status">{searching ? t('mm.discover.searching')
      : shown ? t('mm.discover.results', { query: shown }) + (meta?.counts ? t('mm.discover.resultsCount', { shown: meta.counts.shown, found: meta.counts.found }) : '') + (meta?.budgetGb ? t('mm.discover.judged', { budget: meta.budgetGb }) : '') + '.'
        : t('mm.discover.typeToSearch')}</p>
    {error && <p role="alert" className="modal-err">{error} <button className="popup-tab" onClick={() => void search()}>{t('mm.tryAgain')}</button></p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    <Queue jobs={jobs} registered={registered} onChange={refreshJobs} onSetUp={onSetUp}/>
    {repo && <RepoFiles repo={repo} onClose={() => setRepo(null)} onDownload={download}/>}
    {!repo && <SearchFilters filters={filters} meta={meta} onChange={applyFilters}/>}
    {!repo && results && <ul className="mm-results" aria-label={t('mm.discover.resultsLabel')}>
      {results.length === 0 && <li className="mm-note">
        {shown ? t('mm.discover.noMatchQuery', { query: shown }) : t('mm.discover.noMatch')}
        {meta?.counts?.hiddenUntrusted ? t('mm.discover.hiddenUntrusted', { count: meta.counts.hiddenUntrusted }) : ''}
        {meta?.counts?.hiddenUnsuitable ? t('mm.discover.hiddenUnsuitable', { count: meta.counts.hiddenUnsuitable }) : ''}.
        {/* A one-word query often returns thirty community fine-tunes and nothing else, so the
            default filters hide every result. Saying so is not enough: offer the way out here,
            where the person is looking, instead of making them find the filter that did it. */}
        {(hiddenByTrust > 0 || hiddenByFit > 0) && <span className="mm-empty-actions">
          {hiddenByTrust > 0 && <button type="button" className="popup-tab"
            onClick={() => applyFilters({ trustedOnly: false })}>{t('mm.discover.showAllPublishers', { count: hiddenByTrust })}</button>}
          {hiddenByFit > 0 && <button type="button" className="popup-tab"
            onClick={() => applyFilters({ showUnsuitable: true })}>{t('mm.discover.showUnfit', { count: hiddenByFit })}</button>}
        </span>}
      </li>}
      {results.map(r => <li key={r.id}>
        <button className="mm-result-open" disabled={repoBusy === r.id} onClick={() => void openRepo(r.id)}>
          <strong>{r.id}</strong>
          <small>{[paramLabel(t, r), r.moe ? t('mm.discover.moe') : r.params ? t('mm.discover.dense') : null, r.best ? `${r.best.quant || 'GGUF'} · ${r.best.gb} GB` : null,
            r.vision ? t('mm.card.vision') : null, r.license, t('mm.discover.downloads', { count: tokens(r.downloads) }), r.ageDays <= 45 ? t('mm.discover.updatedDays', { days: r.ageDays }) : r.lastModified ? t('mm.discover.updatedOn', { date: r.lastModified.slice(0, 10) }) : null].filter(Boolean).join(' · ')}</small>
          <span className="mm-result-pills">
            {r.trusted && <span className="mm-pill is-good">{t('mm.discover.trusted')}</span>}
            {r.suitable ? <span className="mm-pill is-good">{t('mm.discover.fits')}</span> : <span className="mm-pill">{r.reasons[0] || t('mm.discover.notUsable')}</span>}
            {r.downloaded.length > 0 && <span className="mm-pill is-good">{t('mm.discover.already')}</span>}
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
  const t = useT();
  return <section className="mm-panel" aria-labelledby="mm-repo">
    <header className="mm-panel-head"><h3 id="mm-repo">{repo.repo}</h3><button className="modal-btn secondary" onClick={onClose}>{t('mm.repo.back')}</button></header>
    {repo.error && <p role="alert" className="modal-err">{repo.error}</p>}
    {repo.gated && <p className="mm-note">{t('mm.repo.gated', { reason: repo.gated })}</p>}
    {projectors.length > 0 && <p className="mm-note">{t('mm.repo.projector')}</p>}
    <p className="mm-note">{t('mm.repo.estimatesNote')}</p>
    <div className="mm-table-wrap"><table className="mm-table">
      <thead><tr><th scope="col">{t('mm.card.file')}</th><th scope="col">{t('mm.sort.size')}</th><th scope="col">{t('mm.repo.fit')}</th><th scope="col">{t('mm.repo.estimates')}</th><th scope="col"><span className="sr-only">{t('mm.repo.download')}</span></th></tr></thead>
      <tbody>{models.map(g => <tr key={g.shardBase}>
        <td><strong>{g.quant || '—'}</strong><small className="mm-mono">{g.files[0].path}{g.shards ? ` (${t('mm.repo.moreParts', { parts: g.shards - 1 })})` : ''}</small></td>
        <td>{g.size}</td>
        <td>{g.fit.map(f => <span key={f.name} className={`mm-pill ${f.verdict === 'fits' ? 'is-good' : f.verdict === 'tight' ? 'is-warn' : 'is-bad'}`}>{VERDICT[f.verdict] ? t(VERDICT[f.verdict]) : f.verdict}</span>)}</td>
        <td>{g.estimates?.length ? g.estimates.map(e => <span key={e.key} className="mm-est">{e.label}: {ctxShort(e.ctx)}{e.offload ? ` · ${t('mm.layersOnGpu', { gpu: e.gpu_layers, total: e.total_layers })} · ${t('mm.speedPct', { pct: e.speed_pct })}` : ''}</span>) : <small>—</small>}{g.nativeCtx ? <small>{t('mm.repo.trainedFor', { tokens: tokens(g.nativeCtx) })}</small> : null}</td>
        <td><button className="popup-tab" onClick={() => onDownload(g.shards ? { repo: repo.repo, shardBase: g.shardBase } : { repo: repo.repo, path: g.files[0].path }, g.files[0].path)}>{t('mm.repo.download')}</button></td>
      </tr>)}</tbody>
    </table></div>
    {models.length === 0 && <p className="mm-note">{t('mm.repo.none')}</p>}
  </section>;
}

const isModelFile = (filename: string) => filename.toLowerCase().endsWith('.gguf') && !filename.toLowerCase().includes('mmproj');
const sectionFor = (filename: string) => filename.split('/').pop()!.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');


function Queue({ jobs, registered, onChange, onSetUp }: { jobs: Job[]; registered: Set<string>; onChange: () => Promise<void>; onSetUp: (section: string) => void }) {
  const t = useT();
  if (!jobs.length) return null;
  const act = async (path: string) => { try { await mm(path, { body: {} }); } finally { await onChange(); } };
  // A finished download is a FILE, not a model the engine can serve. It becomes
  // one only once a models.ini section points at it and the preset file is
  // reloaded. Nothing said so, so a completed download looked like it had
  // simply not taken effect yet — the real answer to "it takes a while".
  const awaitingSetup = jobs.filter(j => j.status === 'done' && isModelFile(j.filename) && !registered.has(j.id));
  return <section className="mm-panel" aria-labelledby="mm-queue">
    <header className="mm-panel-head"><h3 id="mm-queue">{t('mm.queue.title')}</h3>{jobs.some(j => !['queued', 'downloading'].includes(j.status)) && <button className="modal-btn secondary" onClick={() => void act('downloads/clear')}>{t('mm.queue.clear')}</button>}</header>
    {awaitingSetup.length > 0 && <p className="mm-note" role="status" data-testid="download-setup-needed">
      {awaitingSetup.length === 1 ? t('mm.queue.awaitingOne') : t('mm.queue.awaitingMany', { count: awaitingSetup.length })}
      {' '}{t('mm.queue.chooseBefore')}<strong>{t('mm.queue.setUp')}</strong>{t('mm.queue.chooseAfter')}
    </p>}
    <ul className="mm-jobs">{jobs.map(j => <li key={j.id}>
      <div className="mm-job-head"><strong>{j.filename}</strong><span>{j.status === 'downloading' ? t('mm.queue.progress', { pct: j.pct.toFixed(0), speed: j.speedH, eta: j.etaH }) : j.status === 'done' ? t('mm.queue.done') : j.status === 'error' ? t('mm.queue.failed', { error: j.error || t('mm.unknownError') }) : j.status === 'canceled' ? t('mm.queue.cancelled') : t('mm.queue.queued')}</span></div>
      <progress max={100} value={j.pct} aria-label={t('mm.queue.progressLabel', { file: j.filename })}/>
      {j.parallel && j.status === 'downloading' && <div className="mm-chunks" aria-label={t('mm.queue.parts')}>{j.chunks.map(c => <span key={c.index} title={t('mm.queue.part', { part: c.index + 1, pct: c.pct.toFixed(0) })}><i style={{ width: `${c.pct}%` }}/></span>)}</div>}
      <small>{t('mm.queue.bytes', { done: bytes(j.downloaded), total: j.bytes ? bytes(j.bytes) : t('mm.queue.unknownSize') })} · {j.repo}</small>
      {['queued', 'downloading'].includes(j.status) && <button className="popup-tab" onClick={() => void act(`downloads/${j.id}/cancel`)}>{t('common.cancel')}</button>}
      {j.status === 'done' && isModelFile(j.filename) && <button className="popup-tab" onClick={() => onSetUp(sectionFor(j.filename))}>{registered.has(j.id) ? t('mm.queue.review') : t('mm.queue.setUp')}</button>}
    </li>)}</ul>
  </section>;
}

function HfToken() {
  const [state, setState] = useState<{ hasToken: boolean; tokenHint: string; test?: { ok: boolean; message: string } } | null>(null), [value, setValue] = useState(''), [busy, setBusy] = useState(false);
  const t = useT();
  useEffect(() => { void mm<{ hasToken: boolean; tokenHint: string }>('settings').then(setState).catch(() => {}); }, []);
  const save = async (test: boolean) => { setBusy(true); try { setState(await mm('settings', { method: 'PUT', body: { ...(value ? { hfToken: value } : {}), test } })); setValue(''); } finally { setBusy(false); } };
  return <details className="mm-disclosure"><summary>{state?.hasToken ? t('mm.token.saved', { hint: state.tokenHint }) : t('mm.token.optional')}</summary>
    <div className="mm-form">
      <p className="mm-note">{t('mm.token.note')}</p>
      <label>{t('mm.token.label')}<input type="password" autoComplete="off" value={value} placeholder={state?.hasToken ? t('mm.token.replace') : 'hf_…'} onChange={e => setValue(e.target.value)}/></label>
      <div className="mm-actions"><button className="modal-btn secondary" disabled={busy} onClick={() => void save(false)}>{t('common.save')}</button><button className="modal-btn secondary" disabled={busy} onClick={() => void save(true)}>{t('mm.token.saveTest')}</button>
        {state?.hasToken && <button className="modal-btn secondary" disabled={busy} onClick={() => void mm('settings', { method: 'PUT', body: { hfToken: '' } }).then(v => setState(v as typeof state))}>{t('mm.token.remove')}</button>}</div>
      {state?.test && <p role="status" className={state.test.ok ? 'mm-note' : 'modal-err'}>{state.test.message}</p>}
    </div></details>;
}

function UrlImport({ onQueued, target }: { onQueued: () => void; target: string }) {
  const [url, setUrl] = useState(''), [name, setName] = useState(''), [error, setError] = useState('');
  const t = useT();
  const go = async () => { setError(''); try { await mm('downloads', { body: { url, filename: name, target } }); setUrl(''); setName(''); onQueued(); } catch (e) { setError(errorText(e, t('mm.url.failed'))); } };
  return <details className="mm-disclosure"><summary>{t('mm.url.title')}</summary><div className="mm-form">
    <label>{t('mm.url.file')}<input value={url} placeholder="https://…/model.gguf" onChange={e => setUrl(e.target.value)}/></label>
    <label>{t('mm.url.saveAs')}<input value={name} placeholder="model-Q4_K_M.gguf" onChange={e => setName(e.target.value)}/></label>
    <button className="modal-btn secondary" disabled={!url.trim()} onClick={() => void go()}>{t('mm.url.queue')}</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div></details>;
}

// Hugging Face's own filters, plus the two this server cares about: who quantised it, and whether
// it can actually run here (roadmap D19/D20).
function SearchFilters({ filters, meta, onChange }: { filters: Filters; meta: SearchBody | null; onChange: (patch: Partial<Filters>) => void }) {
  const t = useT();
  const toggleQuant = (quant: string) => onChange({ quants: filters.quants.includes(quant) ? filters.quants.filter(x => x !== quant) : [...filters.quants, quant] });
  const active = filters.quants.length + (filters.minGb ? 1 : 0) + (filters.maxGb ? 1 : 0) + (filters.minParams ? 1 : 0) + (filters.maxParams ? 1 : 0) + (filters.moe !== 'any' ? 1 : 0) + (filters.vision ? 1 : 0) + (filters.license ? 1 : 0) + (filters.owner ? 1 : 0);
  return <details className="mm-disclosure mm-filters" open={active > 0}>
    <summary>{t('mm.filters.title')} <small>{active ? t('mm.filters.active', { count: active }) : t('mm.filters.hint')}</small></summary>
    <div className="mm-filter-grid">
      <label className="mm-check"><input type="checkbox" checked={filters.trustedOnly} onChange={e => onChange({ trustedOnly: e.target.checked })}/>{t('mm.filters.trusted')}{meta?.counts?.hiddenUntrusted ? ` (${t('mm.filters.hidden', { count: meta.counts.hiddenUntrusted })})` : ''}</label>
      <label className="mm-check"><input type="checkbox" checked={filters.showUnsuitable} onChange={e => onChange({ showUnsuitable: e.target.checked })}/>{t('mm.filters.unsuitable')}{meta?.counts?.hiddenUnsuitable ? ` (${t('mm.filters.hidden', { count: meta.counts.hiddenUnsuitable })})` : ''}</label>
      <label className="mm-check"><input type="checkbox" checked={filters.vision} onChange={e => onChange({ vision: e.target.checked })}/>{t('mm.filters.vision')}</label>
      <label className="mm-select">{t('mm.card.arch')}<select value={filters.moe} onChange={e => onChange({ moe: e.target.value })}>
        <option value="any">{t('mm.filters.any')}</option><option value="moe">{t('mm.filters.moe')}</option><option value="dense">{t('mm.filters.dense')}</option>
      </select></label>
      <label className="mm-select">{t('mm.filters.size')}<span className="mm-range"><input inputMode="decimal" placeholder={t('mm.filters.min')} value={filters.minGb} onChange={e => onChange({ minGb: e.target.value })}/><input inputMode="decimal" placeholder={t('mm.filters.max')} value={filters.maxGb} onChange={e => onChange({ maxGb: e.target.value })}/></span></label>
      <label className="mm-select">{t('mm.filters.params')}<span className="mm-range"><input inputMode="decimal" placeholder={t('mm.filters.min')} value={filters.minParams} onChange={e => onChange({ minParams: e.target.value })}/><input inputMode="decimal" placeholder={t('mm.filters.max')} value={filters.maxParams} onChange={e => onChange({ maxParams: e.target.value })}/></span></label>
      <label className="mm-select">{t('mm.filters.licence')}<input placeholder="apache, mit…" value={filters.license} onChange={e => onChange({ license: e.target.value })}/></label>
      <label className="mm-select">{t('mm.filters.publisher')}<input placeholder="unsloth, ibm-granite…" value={filters.owner} onChange={e => onChange({ owner: e.target.value })}/></label>
      <fieldset className="mm-quant-filter"><legend className="set-row-label">{t('mm.card.quant')}</legend>
        {QUANT_CHOICES.map(quant => <label key={quant} className="mm-check"><input type="checkbox" checked={filters.quants.includes(quant)} onChange={() => toggleQuant(quant)}/>{quant}</label>)}
      </fieldset>
    </div>
    <div className="mm-filter-actions">
      <button className="modal-btn secondary" onClick={() => onChange(EMPTY_FILTERS)}>{t('mm.filters.clear')}</button>
      <a className="mm-link" href={meta?.hubUrl || 'https://huggingface.co/models?filter=gguf&sort=trending'} target="_blank" rel="noopener noreferrer">{t('mm.filters.openHf')}</a>
    </div>
  </details>;
}
