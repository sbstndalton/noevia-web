import { useCallback, useEffect, useRef, useState } from 'react';
import { ShellIcon } from '../ShellIcon';
import type { JSX } from 'react';
import type { InstalledModel, Project, RouteRule } from '../../types';
import { fetchAutoRoles, setAutoRoles as putAutoRoles, fetchRoutingDefault, putRoutingDefault } from '../../api';
import { SegmentedControl } from '../SegmentedControl';
import { matchesModelUse, modelChoiceLabel } from '../../model-guidance';
import { ReasoningControl } from '../ReasoningControl';
import { SamplingPresetsControl } from '../SamplingPresetsControl';
import { BenchmarksTab, PromptsTab } from './BenchmarksTab';
import { ConfigureTab } from './ConfigureTab';
import { DownloadTab } from './DownloadTab';
import { HardwareTab } from './HardwareTab';
import { LibraryTab } from './LibraryTab';
import { GuidedOptimize } from './GuidedOptimize';
import { OverviewTab } from './OverviewTab';
import { notifyModelsChanged, useModelsChanged } from '../../models-changed';
import { routingViewState } from '../../routing-view-state';
import { roleSummary } from '../../routing-copy';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
export type { RoutingViewState } from '../../routing-view-state';

export type ModelSort = 'name' | 'size' | 'modified';
export type ModelFilter = 'all' | 'loaded' | 'vision' | 'unconfigured';
export type Tab = 'overview' | 'yours' | 'discover' | 'routing' | 'projects' | 'hardware' | 'benchmarks' | 'prompts';

// One tab bar for the whole page. Your models and Discover are the two anyone opens while
// switching a model; the rest are their own pages' worth of content.
const TABS: [Tab, MessageKey][] = [
  ['overview', 'mm.tab.overview'], ['yours', 'mm.tab.yours'], ['discover', 'mm.tab.discover'], ['routing', 'mm.tab.routing'], ['projects', 'mm.tab.projects'],
  ['hardware', 'mm.tab.hardware'], ['benchmarks', 'mm.tab.benchmarks'], ['prompts', 'mm.tab.prompts'],
];

const SORTS: [ModelSort, MessageKey][] = [['name', 'mm.sort.name'], ['size', 'mm.sort.size'], ['modified', 'mm.sort.modified']];
const FILTERS: [ModelFilter, MessageKey][] = [['all', 'mm.filter.all'], ['loaded', 'mm.filter.loaded'], ['vision', 'mm.filter.vision'], ['unconfigured', 'mm.filter.unconfigured']];
const HF_SORTS: [string, MessageKey][] = [['fit', 'mm.hfSort.fit'], ['trendingScore', 'mm.hfSort.trending'], ['downloads', 'mm.hfSort.downloads'], ['likes', 'mm.hfSort.likes'], ['lastModified', 'mm.sort.modified']];
type RouteRole = 'fast' | 'smart' | 'vision' | 'code';
// Auto's role names and explanation for the Routing panel (routing-copy.ts has the summary).
const ROUTE_ROLE: Record<RouteRole, MessageKey> = { fast: 'mm.route.role.fast', smart: 'mm.route.role.smart', vision: 'mm.route.role.vision', code: 'mm.route.role.code' };
const AUTO_EXPLAINED: MessageKey[] = ['mm.route.explain1', 'mm.route.explain2', 'mm.route.explain3', 'mm.route.explain4', 'mm.route.explain5'];

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
  const t = useT();

  const go = (next: Tab) => {
    setTab(next); setOpen('');
    try { sessionStorage.setItem('noevia-models-tab', next); } catch { /* optional */ }
  };
  const changed = () => notifyModelsChanged();
  const openModel = (name: string) => { setOpen(name); setTab('yours'); };

  if (open) return <div className="mm-root">
    <div className="mm-detail-head">
      <button className="modal-btn secondary" onClick={() => setOpen('')}><ShellIcon name="left" size={16}/>{t('mm.allModels')}</button>
      <h1>{open}</h1>
    </div>
    <GuidedOptimize model={open} installed={models.find((m) => m.name === open)} onOpenTab={go} />
    <ConfigureTab initial={open} onSaved={changed} onSelect={setOpen} />
  </div>;

  return <div className="mm-root">
    <div className="settings-title"><h1>{t('mm.title')}</h1><p>{t('mm.lede')}</p></div>

    {/* One toolbar: which list, a search, and that list's filters (user review, 2026-09-19). */}
    <nav className="mm-tabs mm-toolbar-one" aria-label={t('mm.navLabel')}>
      <div className="mm-tabs-row" role="tablist">
        {TABS.map(([id, label]) =>
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => go(id)}>{t(label)}</button>)}
      </div>
      {(tab === 'yours' || tab === 'discover') && <div className="mm-search mm-search-inline">
        <ShellIcon name="search" size={16}/>
        <input aria-label={t('mm.search')} placeholder={tab === 'yours' ? t('mm.searchYours') : t('mm.searchHf')}
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>}
      {tab === 'discover' ? <div className="mm-tabs-controls">
        <label className="mm-select"><span className="sr-only">{t('mm.hfSortLabel')}</span>
          <select value={hfSort} onChange={(e) => setHfSort(e.target.value)}>
            {HF_SORTS.map(([id, label]) => <option key={id} value={id}>{t('mm.sortOption', { label: t(label) })}</option>)}
          </select></label>
      </div> : tab === 'yours' ? <div className="mm-tabs-controls">
        <label className="mm-select"><span className="sr-only">{t('mm.filterLabel')}</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as ModelFilter)}>
            {FILTERS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
          </select></label>
        <label className="mm-select"><span className="sr-only">{t('mm.sortLabel')}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as ModelSort)}>
            {SORTS.map(([id, label]) => <option key={id} value={id}>{t('mm.sortOption', { label: t(label) })}</option>)}
          </select></label>
      </div> : null}
    </nav>

    <div role="tabpanel" aria-label={t(TABS.find(([id]) => id === tab)?.[1] ?? 'mm.tab.yours')}>
      {tab === 'overview' && <OverviewTab models={models} modelsError={modelsError} onOpen={openModel} onTab={go} />}
      {tab === 'yours' && <LibraryTab query={query} sort={sort} filter={filter} onConfigure={openModel} onChanged={changed} />}
      {tab === 'discover' && <DownloadTab query={query} sort={hfSort} onDownloaded={changed} onSetUp={openModel} />}
      {tab === 'routing' && <RoutingSection models={models} modelsError={modelsError} />}
      {tab === 'projects' && <ProjectRoutingSection models={models} routes={routes} projects={projects} modelsError={modelsError} />}
      {tab === 'hardware' && <section className="mm-panel"><div className="mm-panel-head"><h3>{t('mm.tab.hardware')}</h3></div><p className="mm-note">{t('mm.hardwareNote')}</p><HardwareTab /></section>}
      {tab === 'benchmarks' && <section className="mm-panel"><div className="mm-panel-head"><h3>{t('mm.tab.benchmarks')}</h3></div><p className="mm-note">{t('mm.benchmarksNote')}</p><BenchmarksTab /></section>}
      {tab === 'prompts' && <section className="mm-panel"><div className="mm-panel-head"><h3>{t('mm.promptLibrary')}</h3></div><p className="mm-note">{t('mm.promptLibraryNote')}</p><PromptsTab /></section>}
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
  const t = useT();

  // A deleted model can drop out of a role (or fall back to another one) on the server without
  // this tab remounting — refetch whenever the shared model list changes, same as a save here
  // already does for ModelsSummary.tsx. `live` guards both this and the mount effect below
  // against setting state after the tab (or the whole page) has unmounted — a models-changed
  // event can easily fire while the fetch it triggered is still in flight.
  const liveRef = useRef(true);
  useEffect(() => { liveRef.current = true; return () => { liveRef.current = false; }; }, []);
  const loadRoles = useCallback(() => {
    fetchAutoRoles().then((v) => { if (liveRef.current) setInfo(v); }).catch(() => { if (liveRef.current) setError(t('mm.route.loadError')); });
  }, [t]);
  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setInfo(v); }).catch(() => { if (live) setError(t('mm.route.loadError')); }); return () => { live = false; }; }, []);
  useModelsChanged(loadRoles);

  // Embedding and reranking models cannot answer a chat, so they are never
  // offered for a role — picking one produces a model that 400s every request.
  const chatModels = models.filter((m) => matchesModelUse(m.labels, 'all'));
  const valueFor = (role: 'fast' | 'smart' | 'vision' | 'code') => pending[role] ?? info?.roles?.[role] ?? '';

  const save = async () => {
    const fast = valueFor('fast').trim(), smart = valueFor('smart').trim(), vision = valueFor('vision').trim(), code = valueFor('code').trim();
    if (!fast || !smart) { setError(t('mm.route.needBoth')); return; }
    setBusy(true); setError(''); setSaved('');
    try {
      await putAutoRoles({ fast, smart, vision, code });
      setPending({}); setInfo({ configured: true, roles: { fast, smart, ...(vision ? { vision } : {}), ...(code ? { code } : {}) } });
      setSaved(t('mm.route.saved'));
      // The Settings summary card (ModelsSummary.tsx) fetched Auto's roles once on mount and
      // cached them; without this it keeps showing the pre-save state until the page remounts.
      notifyModelsChanged();
    } catch (e) { setError(e instanceof Error ? e.message : t('mm.saveError')); }
    finally { setBusy(false); }
  };

  const view = routingViewState(info, error);

  return <><DefaultModeSection />
  <section className="mm-panel">
    <div className="mm-panel-head"><h3>{t('mm.tab.routing')}</h3></div>
    <p className="mm-note">{t('mm.route.intro')}</p>
    {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
    {view === 'loading' && <p className="mm-note" role="status">{t('mm.loading')}</p>}
    {view === 'error' && <p role="alert" className="modal-err">{error}</p>}
    {view === 'unconfigured' && <p className="mm-note">{t('mm.route.unconfigured')}</p>}
    {!!info?.missing?.length && <p className="mm-note warn" role="alert">{t(info.missing.length === 1 ? 'mm.route.missingOne' : 'mm.route.missingSeveral', { models: info.missing.map((m) => `${t(ROUTE_ROLE[m.role])} (${m.model})`).join(', ') })}</p>}
    {view !== 'loading' && view !== 'error' && <>
    <div className="mm-form route-roles">
      {(['fast', 'smart', 'vision', 'code'] as const).map((role) => <label key={role}>
        {t(ROUTE_ROLE[role])}
        <select value={valueFor(role)} disabled={busy} onChange={(e) => setPending((prev) => ({ ...prev, [role]: e.target.value }))}>
          <option value="">{role === 'vision' || role === 'code' ? t('mm.route.none') : t('mm.route.pick')}</option>
          {chatModels.map((m) => <option key={m.name} value={m.name}>{m.loaded ? t('mm.route.loadedOption', { model: m.name }) : m.name}</option>)}
          {/* A role can name a model that is no longer installed; keep it
              selectable so saving does not silently drop it. */}
          {info?.roles?.[role] && !models.some((m) => m.name === info.roles?.[role]) && <option value={info.roles[role]}>{t('mm.route.notInstalledOption', { model: info.roles[role] ?? '' })}</option>}
        </select>
      </label>)}
    </div>
    <div className="mm-actions">
      <button className="modal-btn primary" disabled={busy} onClick={() => void save()}>{busy ? t('mm.saving') : t('mm.route.save')}</button>
      {saved && <span role="status" className="mm-note">{saved}</span>}
      {error && <span role="alert" className="modal-err">{error}</span>}
    </div>
    </>}

    <details className="mm-disclosure">
      <summary>{t('mm.route.howAuto')}</summary>
      <ol className="mm-hints">{AUTO_EXPLAINED.map((line) => <li key={line}>{t(line)}</li>)}</ol>
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
    <div className="mm-panel-head"><h3>{t('mm.sampling.title')}</h3></div>
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
  const t = useT();
  useEffect(() => { let live = true; fetchRoutingDefault().then((v) => { if (live) setMode(v.routing); }).catch(() => { if (live) setError(t('mm.defaultMode.loadError')); }); return () => { live = false; }; }, []);
  const save = async (next: 'auto' | 'manual', applyToExisting: boolean) => {
    setBusy(true); setError(''); setStatus('');
    try {
      const r = await putRoutingDefault(next, applyToExisting);
      setMode(r.routing);
      const modeName = next === 'auto' ? t('mm.mode.auto') : t('mm.mode.manual');
      setStatus(applyToExisting ? (r.updated ? t.plural('mm.defaultMode.switched', r.updated, { mode: modeName }) : t('mm.defaultMode.already')) : t('mm.defaultMode.saved'));
    } catch (e) { setError(e instanceof Error ? e.message : t('mm.saveError')); }
    finally { setBusy(false); }
  };
  return <section className="mm-panel">
    <div className="mm-panel-head"><h3>{t('mm.defaultMode.title')}</h3></div>
    <p className="mm-note">{t('mm.defaultMode.intro')}</p>
    {mode && <SegmentedControl label={t('mm.defaultMode.title')} value={mode} options={[['auto', t('mm.mode.auto')], ['manual', t('mm.mode.manual')]]} onChange={(next) => { if (!busy) void save(next, false); }} />}
    <div className="mm-actions">
      <button className="modal-btn secondary" disabled={busy || !mode} onClick={() => mode && void save(mode, true)}>{busy ? t('mm.saving') : t('mm.defaultMode.switch', { mode: mode === 'manual' ? t('mm.mode.manual') : t('mm.mode.auto') })}</button>
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
  const t = useT();
  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setInfo(v); }).catch(() => undefined); return () => { live = false; }; }, []);
  const loaded = models.filter((m) => m.loaded).map((m) => m.name);
  return <section className="mm-panel">
    <div className="mm-panel-head"><h3>{t.plural('mm.projects.title', projects.length)}</h3></div>
    {projects.length ? <div className="mm-table-wrap">
      <table className="mm-table route-projects">
      <thead><tr><th scope="col">{t('mm.projects.project')}</th><th scope="col">{t('mm.projects.picks')}</th><th scope="col">{t('mm.projects.model')}</th></tr></thead>
      <tbody>{projects.map((p) => <tr key={p.id}>
        <td data-label={t('mm.projects.project')}>{p.name}</td>
        <td data-label={t('mm.projects.picks')}>{p.routing === 'auto' ? t('mm.mode.auto') : t('mm.mode.manual')}</td>
        <td data-label={t('mm.projects.model')}>{p.routing === 'auto' ? (info?.configured ? roleSummary(info.roles, t) : t('mm.projects.autoUnconfigured')) : modelChoiceLabel(p, modelsError ? null : models)}</td>
      </tr>)}</tbody>
      </table>
    </div> : <p className="mm-note">{t('mm.projects.none')}</p>}
    {routes.some((r) => r.task === 'Diary app') && <p className="mm-note">{t('mm.projects.diary')}</p>}
    <p className="route-note">{t('mm.projects.change')} {loaded.length ? t('mm.projects.loadedNow', { models: loaded.join(', ') }) : t('mm.projects.noneLoaded')}</p>
  </section>;
}
