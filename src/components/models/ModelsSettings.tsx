import { useEffect, useState } from 'react';
import { ShellIcon } from '../ShellIcon';
import type { JSX } from 'react';
import type { InstalledModel, Project, RouteRule } from '../../types';
import { fetchAutoRoles, setAutoRoles as putAutoRoles, fetchRoutingDefault, putRoutingDefault } from '../../api';
import { SegmentedControl } from '../SegmentedControl';
import { matchesModelUse, modelChoiceLabel } from '../../model-guidance';
import { AUTO_EXPLAINED, ROLE_LABEL, roleSummary } from '../../routing-copy';
import { ReasoningControl } from '../ReasoningControl';
import { SamplingPresetsControl } from '../SamplingPresetsControl';
import { BenchmarksTab, PromptsTab } from './BenchmarksTab';
import { ConfigureTab } from './ConfigureTab';
import { DownloadTab } from './DownloadTab';
import { HardwareTab } from './HardwareTab';
import { LibraryTab } from './LibraryTab';
import { GuidedOptimize } from './GuidedOptimize';
import { OverviewTab } from './OverviewTab';
import { notifyModelsChanged } from '../../models-changed';
import { routingViewState } from '../../routing-view-state';
export type { RoutingViewState } from '../../routing-view-state';

export type ModelSort = 'name' | 'size' | 'modified';
export type ModelFilter = 'all' | 'loaded' | 'vision' | 'unconfigured';
export type Tab = 'overview' | 'yours' | 'discover' | 'routing' | 'projects' | 'hardware' | 'benchmarks' | 'prompts';

// One tab bar for the whole page. Your models and Discover are the two anyone opens while
// switching a model; the rest are their own pages' worth of content.
const TABS: [Tab, string][] = [
  ['overview', 'Overview'], ['yours', 'Your models'], ['discover', 'Discover'], ['routing', 'Routing'], ['projects', 'Projects'],
  ['hardware', 'Hardware'], ['benchmarks', 'Benchmarks'], ['prompts', 'Prompts'],
];

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
  // Six places rather than one long scroll: routing, hardware, benchmarks and the prompt
  // library were stacked under the model list, where nothing was findable (user review,
  // 2026-09-20).
  const [tab, setTab] = useState<Tab>(() => {
    try { const saved = sessionStorage.getItem('noevia-models-tab') as Tab | null; return saved && TABS.some(([id]) => id === saved) ? saved : 'yours'; } catch { return 'yours'; }
  });
  const [open, setOpen] = useState<string>(initialModel);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ModelSort>('name');
  const [filter, setFilter] = useState<ModelFilter>('all');
  const [hfSort, setHfSort] = useState('fit');

  const go = (next: Tab) => {
    setTab(next); setOpen('');
    try { sessionStorage.setItem('noevia-models-tab', next); } catch { /* optional */ }
  };
  const changed = () => notifyModelsChanged();
  const openModel = (name: string) => { setOpen(name); setTab('yours'); };

  if (open) return <div className="mm-root">
    <div className="mm-detail-head">
      <button className="modal-btn secondary" onClick={() => setOpen('')}><ShellIcon name="left" size={16}/>All models</button>
      <h1>{open}</h1>
    </div>
    <GuidedOptimize model={open} installed={models.find((m) => m.name === open)} onOpenTab={go} />
    <ConfigureTab initial={open} onSaved={changed} onSelect={setOpen} />
  </div>;

  return <div className="mm-root">
    <div className="settings-title"><h1>Models &amp; routing</h1><p>Download, configure, measure and route the models this server runs.</p></div>

    {/* One toolbar: which list, a search, and that list's filters (user review, 2026-09-19). */}
    <nav className="mm-tabs mm-toolbar-one" aria-label="Model management">
      <div className="mm-tabs-row" role="tablist">
        {TABS.map(([id, label]) =>
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => go(id)}>{label}</button>)}
      </div>
      {(tab === 'yours' || tab === 'discover') && <div className="mm-search mm-search-inline">
        <ShellIcon name="search" size={16}/>
        <input aria-label="Search models" placeholder={tab === 'yours' ? 'Search your models…' : 'Search Hugging Face…'}
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>}
      {tab === 'discover' ? <div className="mm-tabs-controls">
        <label className="mm-select"><span className="sr-only">Sort Hugging Face results</span>
          <select value={hfSort} onChange={(e) => setHfSort(e.target.value)}>
            {[['fit', 'Best for this server'], ['trendingScore', 'Trending'], ['downloads', 'Downloads'], ['likes', 'Likes'], ['lastModified', 'Recently updated']].map(([id, label]) => <option key={id} value={id}>Sort · {label}</option>)}
          </select></label>
      </div> : tab === 'yours' ? <div className="mm-tabs-controls">
        <label className="mm-select"><span className="sr-only">Filter models</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as ModelFilter)}>
            {FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
        <label className="mm-select"><span className="sr-only">Sort models</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as ModelSort)}>
            {SORTS.map(([id, label]) => <option key={id} value={id}>Sort · {label}</option>)}
          </select></label>
      </div> : null}
    </nav>

    <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]}>
      {tab === 'overview' && <OverviewTab models={models} modelsError={modelsError} onOpen={openModel} onTab={go} />}
      {tab === 'yours' && <LibraryTab query={query} sort={sort} filter={filter} onConfigure={openModel} onChanged={changed} />}
      {tab === 'discover' && <DownloadTab query={query} sort={hfSort} onDownloaded={changed} onSetUp={openModel} />}
      {tab === 'routing' && <RoutingSection models={models} modelsError={modelsError} />}
      {tab === 'projects' && <ProjectRoutingSection models={models} routes={routes} projects={projects} modelsError={modelsError} />}
      {tab === 'hardware' && <section className="mm-panel"><div className="mm-panel-head"><h3>Hardware</h3></div><p className="mm-note">Engines, GPU and container health, logs.</p><HardwareTab /></section>}
      {tab === 'benchmarks' && <section className="mm-panel"><div className="mm-panel-head"><h3>Benchmarks</h3></div><p className="mm-note">Measured speed, and your own capability ratings.</p><BenchmarksTab /></section>}
      {tab === 'prompts' && <section className="mm-panel"><div className="mm-panel-head"><h3>Prompt library</h3></div><p className="mm-note">Saved system prompts used by benchmark runs.</p><PromptsTab /></section>}
    </div>
  </div>;
}

// What Auto actually routes to. This used to be edited in the chat box, where
// it competed with switching model — the one action people take mid-chat.
function RoutingSection({ models, modelsError }: { models: InstalledModel[]; modelsError: string | null }): JSX.Element {
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
      // The Settings summary card (ModelsSummary.tsx) fetched Auto's roles once on mount and
      // cached them; without this it keeps showing the pre-save state until the page remounts.
      notifyModelsChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'The change could not be saved.'); }
    finally { setBusy(false); }
  };

  const view = routingViewState(info, error);

  return <><DefaultModeSection />
  <section className="mm-panel">
    <div className="mm-panel-head"><h3>Routing</h3></div>
    <p className="mm-note">Projects set to Auto pick a model per message. Vision and Code are optional. Set Vision and that model describes any images, then Fast or Smart answers from the description — so the answering model does not need to see. Set Code and coding work goes there instead of Smart.</p>
    {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
    {view === 'loading' && <p className="mm-note" role="status">Loading…</p>}
    {view === 'error' && <p role="alert" className="modal-err">{error}</p>}
    {view === 'unconfigured' && <p className="mm-note">Auto has no models assigned yet. Pick Fast and Smart, then save.</p>}
    {!!info?.missing?.length && <p className="mm-note warn" role="alert">Auto can't answer until you replace {info.missing.map((m) => `${ROLE_LABEL[m.role]} (${m.model})`).join(', ')}: {info.missing.length === 1 ? 'that model is' : 'those models are'} no longer installed.</p>}
    {view !== 'loading' && view !== 'error' && <>
    <div className="mm-form route-roles">
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
    </>}

    <details className="mm-disclosure">
      <summary>How Auto decides</summary>
      <ol className="mm-hints">{AUTO_EXPLAINED.map((line) => <li key={line}>{line}</li>)}</ol>
    </details>
  </section>

  {/* Thinking is a separate setting that happens to live beside routing: its own panel, so the
      routing form is one thing to read (user review, 2026-09-20). */}
  <section className="mm-panel">
    <div className="mm-panel-head"><h3>Thinking</h3></div>
    <ReasoningControl global />
  </section>

  {/* Issue #194: task-aware sampling presets, own panel for the same reason as Thinking above. */}
  <section className="mm-panel">
    <div className="mm-panel-head"><h3>Sampling</h3></div>
    <SamplingPresetsControl />
  </section></>;
}

// The mode a new project starts in. Switching existing projects is a separate, explicit button:
// changing the default alone never rewrites a project someone set by hand.
function DefaultModeSection(): JSX.Element {
  const [mode, setMode] = useState<'auto' | 'manual' | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { let live = true; fetchRoutingDefault().then((v) => { if (live) setMode(v.routing); }).catch(() => { if (live) setError('The default mode could not be loaded.'); }); return () => { live = false; }; }, []);
  const save = async (next: 'auto' | 'manual', applyToExisting: boolean) => {
    setBusy(true); setError(''); setStatus('');
    try {
      const r = await putRoutingDefault(next, applyToExisting);
      setMode(r.routing);
      setStatus(applyToExisting ? (r.updated ? `Switched ${r.updated} ${r.updated === 1 ? 'project' : 'projects'} to ${next === 'auto' ? 'Auto' : 'Manual'}.` : 'Every project already uses this mode.') : 'Saved. New projects start this way.');
    } catch (e) { setError(e instanceof Error ? e.message : 'The change could not be saved.'); }
    finally { setBusy(false); }
  };
  return <section className="mm-panel">
    <div className="mm-panel-head"><h3>Default model mode</h3></div>
    <p className="mm-note">How new projects pick their model. Auto chooses Fast or Smart per message; Manual keeps one pinned model. Any project can still be changed from its own model selector.</p>
    {mode && <SegmentedControl label="Default model mode" value={mode} options={[['auto', 'Auto'], ['manual', 'Manual']]} onChange={(next) => { if (!busy) void save(next, false); }} />}
    <div className="mm-actions">
      <button className="modal-btn secondary" disabled={busy || !mode} onClick={() => mode && void save(mode, true)}>{busy ? 'Saving…' : `Switch existing projects to ${mode === 'manual' ? 'Manual' : 'Auto'}`}</button>
      {status && <span role="status" className="mm-note">{status}</span>}
      {error && <span role="alert" className="modal-err">{error}</span>}
    </div>
  </section>;
}

// Which model each project ends up using. Read-only here on purpose: a project's model is
// changed from the project itself. Its own tab since 2026-09-21 — it is a list about projects,
// not a setting about routing.
function ProjectRoutingSection({ models, routes, projects, modelsError }: {
  models: InstalledModel[]; routes: RouteRule[]; projects: Project[]; modelsError: string | null;
}): JSX.Element {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof fetchAutoRoles>> | null>(null);
  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setInfo(v); }).catch(() => undefined); return () => { live = false; }; }, []);
  return <section className="mm-panel">
    <div className="mm-panel-head"><h3>Per-project routing ({projects.length} {projects.length === 1 ? 'project' : 'projects'})</h3></div>
    {projects.length ? <div className="mm-table-wrap">
      <table className="mm-table route-projects">
      <thead><tr><th scope="col">Project</th><th scope="col">Picks the model</th><th scope="col">Model</th></tr></thead>
      <tbody>{projects.map((p) => <tr key={p.id}>
        <td data-label="Project">{p.name}</td>
        <td data-label="Picks the model">{p.routing === 'auto' ? 'Auto' : 'Manual'}</td>
        <td data-label="Model">{p.routing === 'auto' ? (info?.configured ? roleSummary(info.roles) : 'Auto not configured — uses the loaded model') : modelChoiceLabel(p, modelsError ? null : models)}</td>
      </tr>)}</tbody>
      </table>
    </div> : <p className="mm-note">No projects yet.</p>}
    {routes.some((r) => r.task === 'Diary app') && <p className="mm-note">Diary: its own sidecar pipeline, not Auto.</p>}
    <p className="route-note">Change a project's model from its own model selector. {models.filter((m) => m.loaded).length ? `Loaded now: ${models.filter((m) => m.loaded).map((m) => m.name).join(', ')}.` : 'No model is loaded right now.'}</p>
  </section>;
}
