import { useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project, RouteRule } from '../../types';
import { ReasoningControl } from '../ReasoningControl';
import { BenchmarksTab, PromptsTab } from './BenchmarksTab';
import { ConfigureTab } from './ConfigureTab';
import { DownloadTab } from './DownloadTab';
import { HardwareTab } from './HardwareTab';
import { LibraryTab } from './LibraryTab';

const TABS = [['library', 'Library'], ['download', 'Download'], ['configure', 'Configure'], ['hardware', 'Hardware'], ['benchmarks', 'Benchmarks'], ['prompts', 'Prompts'], ['routing', 'Routing']] as const;
type Tab = typeof TABS[number][0];

// Settings → Models & routing: noevia's full model management (the folded-in Model
// Loader), in noevia's own screens. The chat box keeps only a quick model switcher.
export function ModelsSettings({ models, routes, projects, modelsError, onModelsChanged }: { models: InstalledModel[]; routes: RouteRule[]; projects: Project[]; modelsError: string | null; onModelsChanged?: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>(() => { try { const t = sessionStorage.getItem('noevia-models-tab'); return (TABS.some(([id]) => id === t) ? t : 'library') as Tab; } catch { return 'library'; } });
  const [target, setTarget] = useState<string>('');
  const go = (next: Tab) => { setTab(next); try { sessionStorage.setItem('noevia-models-tab', next); } catch { /* optional */ } };
  const configure = (name: string) => { setTarget(name); go('configure'); };
  const changed = () => onModelsChanged?.();
  return <div className="mm-root">
    <div className="settings-title"><h1>Models &amp; routing</h1><p>Download, configure, measure and route the models this server runs.</p></div>
    <nav className="mm-tabs" aria-label="Model management">
      <select className="mm-tabs-select" aria-label="Model management section" value={tab} onChange={e => go(e.target.value as Tab)}>{TABS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <div className="mm-tabs-row" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => go(id)}>{label}</button>)}</div>
    </nav>
    <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]}>
      {tab === 'library' && <LibraryTab onConfigure={configure} onChanged={changed}/>}
      {tab === 'download' && <DownloadTab onDownloaded={changed} onSetUp={configure}/>}
      {tab === 'configure' && <ConfigureTab initial={target} onSaved={changed}/>}
      {tab === 'hardware' && <HardwareTab/>}
      {tab === 'benchmarks' && <BenchmarksTab/>}
      {tab === 'prompts' && <PromptsTab/>}
      {tab === 'routing' && <div className="mm-tab">
        <ReasoningControl global/>
        {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
        <h2>Project routing</h2>
        <div className="route-table">{routes.map(r => <div className="route-row" key={r.task}><span>{r.task}</span><span>→</span><span>{r.model}</span></div>)}</div>
        <p className="route-note">{projects.length} projects. Change a project's model from its model selector. {models.filter(m => m.loaded).length ? `Loaded now: ${models.filter(m => m.loaded).map(m => m.name).join(', ')}.` : 'No model is loaded right now.'}</p>
        <p className="mm-note">noevia sends chats to the engine directly, so Model Loader's OpenWebUI integration is not needed here and is not included.</p>
      </div>}
    </div>
  </div>;
}
