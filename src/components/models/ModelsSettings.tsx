import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project, RouteRule } from '../../types';
import { fetchAutoRoles, setAutoRoles as putAutoRoles } from '../../api';
import { matchesModelUse, modelChoiceLabel } from '../../model-guidance';
import { AUTO_EXPLAINED, ROLE_LABEL, roleSummary } from '../../routing-copy';
import { ReasoningControl } from '../ReasoningControl';
import { BenchmarksTab, PromptsTab } from './BenchmarksTab';
import { ConfigureTab } from './ConfigureTab';
import { DownloadTab } from './DownloadTab';
import { HardwareTab } from './HardwareTab';
import { LibraryTab } from './LibraryTab';
import { notifyModelsChanged } from '../../models-changed';

export type ModelSort = 'name' | 'size' | 'modified';
export type ModelFilter = 'all' | 'loaded' | 'vision' | 'unconfigured';

const SORTS: [ModelSort, string][] = [['name', 'Name'], ['size', 'Size'], ['modified', 'Recently updated']];
const FILTERS: [ModelFilter, string][] = [['all', 'All models'], ['loaded', 'Loaded'], ['vision', 'Vision'], ['unconfigured', 'Needs setup']];

// Settings → Models & routing. One interface rather than seven tabs.
//
// The old shape (Library / Download / Configure / Hardware / Benchmarks /
// Prompts / Routing) made you know which tab a thing lived in before you could
// look for it, and tabs mounted per selection so each one refetched from
// scratch. This follows the same shape as the rest of the app's catalogues:
// search, "Your models" against "Discover", and a detail view for one model.
//
// Discover is the download flow, deliberately named for what it is rather than
// for the mechanism — you are looking for a model you do not have yet.
export function ModelsSettings({ models, routes, projects, modelsError, initialModel = '' }: { models: InstalledModel[]; routes: RouteRule[]; projects: Project[]; modelsError: string | null; initialModel?: string }): JSX.Element {
  const [tab, setTab] = useState<'yours' | 'discover'>(() => {
    try { return sessionStorage.getItem('noevia-models-tab') === 'discover' ? 'discover' : 'yours'; } catch { return 'yours'; }
  });
  const [open, setOpen] = useState<string>(initialModel);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ModelSort>('name');
  const [filter, setFilter] = useState<ModelFilter>('all');
  const [hfSort, setHfSort] = useState('fit');

  const go = (next: 'yours' | 'discover') => {
    setTab(next); setOpen('');
    try { sessionStorage.setItem('noevia-models-tab', next); } catch { /* optional */ }
  };
  const changed = () => notifyModelsChanged();
  const openModel = (name: string) => { setOpen(name); setTab('yours'); };

  if (open) return <div className="mm-root">
    <div className="mm-detail-head">
      <button className="modal-btn secondary" onClick={() => setOpen('')}>← All models</button>
      <h1>{open}</h1>
    </div>
    <ConfigureTab initial={open} onSaved={changed} onSelect={setOpen} />
  </div>;

  return <div className="mm-root">
    <div className="settings-title"><h1>Models &amp; routing</h1><p>Download, configure, measure and route the models this server runs.</p></div>

    <div className="mm-toolbar-row">
      <div className="mm-search">
        <input aria-label="Search models" placeholder={tab === 'yours' ? 'Search your models…' : 'Search Hugging Face…'}
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
    </div>

    <nav className="mm-tabs" aria-label="Model management">
      <div className="mm-tabs-row" role="tablist">
        {([['yours', 'Your models'], ['discover', 'Discover']] as const).map(([id, label]) =>
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => go(id)}>{label}</button>)}
      </div>
      {tab === 'discover' ? <div className="mm-tabs-controls">
        <label className="mm-select"><span className="sr-only">Sort Hugging Face results</span>
          <select value={hfSort} onChange={(e) => setHfSort(e.target.value)}>
            {[['fit', 'Best for this server'], ['trendingScore', 'Trending'], ['downloads', 'Downloads'], ['likes', 'Likes'], ['lastModified', 'Recently updated']].map(([id, label]) => <option key={id} value={id}>Sort · {label}</option>)}
          </select></label>
      </div> : <div className="mm-tabs-controls">
        <label className="mm-select"><span className="sr-only">Filter models</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as ModelFilter)}>
            {FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
        <label className="mm-select"><span className="sr-only">Sort models</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as ModelSort)}>
            {SORTS.map(([id, label]) => <option key={id} value={id}>Sort · {label}</option>)}
          </select></label>
      </div>}
    </nav>

    <div role="tabpanel" aria-label={tab === 'yours' ? 'Your models' : 'Discover'}>
      {tab === 'discover'
        ? <DownloadTab query={query} sort={hfSort} onDownloaded={changed} onSetUp={openModel} />
        : <>
          <LibraryTab query={query} sort={sort} filter={filter} onConfigure={openModel} onChanged={changed} />
          <RoutingSection models={models} routes={routes} projects={projects} modelsError={modelsError} />
          <Collapsible title="Hardware" hint="Engines, GPU and container health, logs."><HardwareTab /></Collapsible>
          <Collapsible title="Benchmarks" hint="Measured speed, and your own capability ratings."><BenchmarksTab /></Collapsible>
          <Collapsible title="Prompt library" hint="Saved system prompts used by benchmark runs."><PromptsTab /></Collapsible>
        </>}
    </div>
  </div>;
}

// Hardware, benchmarks and the prompt library are real pages' worth of content
// that nobody opens while switching a model, so they stay on this page but
// closed. Collapsed rather than moved: "one interface" was the point.
function Collapsible({ title, hint, children }: { title: string; hint: string; children: JSX.Element }): JSX.Element {
  return <details className="mm-panel mm-fold">
    <summary><span><strong>{title}</strong><small>{hint}</small></span></summary>
    <div className="mm-fold-body">{children}</div>
  </details>;
}

// What Auto actually routes to. This used to be edited in the chat box, where
// it competed with switching model — the one action people take mid-chat.
function RoutingSection({ models, routes, projects, modelsError }: { models: InstalledModel[]; routes: RouteRule[]; projects: Project[]; modelsError: string | null }): JSX.Element {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof fetchAutoRoles>> | null>(null);
  const [pending, setPending] = useState<{ fast?: string; smart?: string; vision?: string; code?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setInfo(v); }).catch(() => { if (live) setError('Auto routing settings could not be loaded.'); }); return () => { live = false; }; }, []);

  // Embedding and reranking models cannot answer a chat, so they are never
  // offered for a role — picking one produces a model that 400s every request.
  const chatModels = models.filter((m) => matchesModelUse(m.labels, 'all'));
  const valueFor = (role: 'fast' | 'smart' | 'vision' | 'code') => pending[role] ?? info?.roles?.[role] ?? '';

  const save = async () => {
    const fast = valueFor('fast').trim(), smart = valueFor('smart').trim(), vision = valueFor('vision').trim(), code = valueFor('code').trim();
    if (!fast || !smart) { setError('Auto needs both a fast and a smart model.'); return; }
    setBusy(true); setError(''); setSaved('');
    try {
      await putAutoRoles({ fast, smart, vision, code });
      setPending({}); setInfo({ configured: true, roles: { fast, smart, ...(vision ? { vision } : {}), ...(code ? { code } : {}) } });
      setSaved('Saved. Models load on demand.');
    } catch (e) { setError(e instanceof Error ? e.message : 'The change could not be saved.'); }
    finally { setBusy(false); }
  };

  return <section className="mm-panel">
    <div className="mm-panel-head"><h3>Routing</h3></div>
    <p className="mm-note">Projects set to Auto pick a model per message. Vision and Code are optional. Set Vision and that model describes any images, then Fast or Smart answers from the description — so the answering model does not need to see. Set Code and coding work goes there instead of Smart.</p>
    {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
    {!info?.configured && !error && <p className="mm-note">Auto has no models assigned yet. Pick Fast and Smart, then save.</p>}
    {!!info?.missing?.length && <p className="mm-note warn" role="alert">Auto can't answer until you replace {info.missing.map((m) => `${ROLE_LABEL[m.role]} (${m.model})`).join(', ')}: {info.missing.length === 1 ? 'that model is' : 'those models are'} no longer installed.</p>}
    <div className="mm-form">
      {(['fast', 'smart', 'vision', 'code'] as const).map((role) => <label key={role}>
        {ROLE_LABEL[role]}
        <select value={valueFor(role)} disabled={busy} onChange={(e) => setPending((prev) => ({ ...prev, [role]: e.target.value }))}>
          <option value="">{role === 'vision' || role === 'code' ? '— none —' : '— pick a model —'}</option>
          {chatModels.map((m) => <option key={m.name} value={m.name}>{m.name}{m.loaded ? ' · loaded' : ''}</option>)}
          {/* A role can name a model that is no longer installed; keep it
              selectable so saving does not silently drop it. */}
          {info?.roles?.[role] && !models.some((m) => m.name === info.roles?.[role]) && <option value={info.roles[role]}>{info.roles[role]} · not installed</option>}
        </select>
      </label>)}
    </div>
    <div className="mm-actions">
      <button className="modal-btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save routing'}</button>
      {saved && <span role="status" className="mm-note">{saved}</span>}
      {error && <span role="alert" className="modal-err">{error}</span>}
    </div>

    <ReasoningControl global />

    <details className="mm-disclosure">
      <summary>How Auto decides</summary>
      <ol className="mm-hints">{AUTO_EXPLAINED.map((line) => <li key={line}>{line}</li>)}</ol>
    </details>

    <details className="mm-disclosure">
      <summary>Per-project routing ({projects.length} {projects.length === 1 ? 'project' : 'projects'})</summary>
      <div className="mm-form">
        {projects.length ? <table className="mm-table route-projects">
          <thead><tr><th scope="col">Project</th><th scope="col">Picks the model</th><th scope="col">Model</th></tr></thead>
          <tbody>{projects.map((p) => <tr key={p.id}>
            <td>{p.name}</td>
            <td>{p.routing === 'auto' ? 'Auto' : 'Manual'}</td>
            <td>{p.routing === 'auto' ? (info?.configured ? roleSummary(info.roles) : 'Auto not configured — uses the loaded model') : modelChoiceLabel(p, modelsError ? null : models)}</td>
          </tr>)}</tbody>
        </table> : <p className="mm-note">No projects yet.</p>}
        {routes.some((r) => r.task === 'Diary app') && <p className="mm-note">Diary: its own sidecar pipeline, not Auto.</p>}
        <p className="route-note">Change a project's model from its own model selector. {models.filter((m) => m.loaded).length ? `Loaded now: ${models.filter((m) => m.loaded).map((m) => m.name).join(', ')}.` : 'No model is loaded right now.'}</p>
      </div>
    </details>
  </section>;
}
