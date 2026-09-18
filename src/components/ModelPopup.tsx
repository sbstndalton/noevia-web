import { matchesModelUse } from '../model-guidance';
import { useModelsChanged } from '../models-changed';
import { useCallback, useEffect, useState } from 'react';
import { useModalDialog } from './useModalDialog';
import { roleSummary } from '../routing-copy';
import { CloseButton } from './CloseButton';
import type { JSX } from 'react';
import type { InstalledModel, Project, Provider, Toolbox } from '../types';
import type { AutoRoles, McpStatus } from '../api';
import { apiFetch, fetchAutoRoles, fetchInstalledModels, fetchProviders, fetchToolboxes, saveProjectConfig } from '../api';

interface ModelPopupProps {
  projects: Project[];
  activeProject: Project | null;
  onClose: () => void;
  onProjectsChanged: () => void;
  onOpenModelSettings?: (model?: string) => void;
}

// The chat box's model control, and deliberately only that: pick Auto or one
// model, and choose which tools come with it.
//
// Everything else — downloads, per-model settings, autoconfig, hardware,
// benchmarks, the prompt library, and configuring what Auto routes TO — lives
// in Settings → Models & routing. This panel used to carry all of it, which
// made the common action (switch model) compete for space with administration
// nobody performs mid-conversation.
export function ModelPopup({ projects, activeProject, onClose, onProjectsChanged, onOpenModelSettings: openSettingsProp }: ModelPopupProps): JSX.Element {
  const dialog = useModalDialog();
  const openSettings = (model?: string) => {
    if (openSettingsProp) return openSettingsProp(model);
    onClose(); window.dispatchEvent(new CustomEvent('noevia:open-model-settings', { detail: { model } }));
  };
  return (
    <dialog ref={dialog} className="native-modal model-dialog-backdrop" aria-label="Model and tools"
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      <div className="mp-panel aero dialog-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="mp-head">
          <h2>{activeProject ? activeProject.name : 'Model'}</h2>
          <button className="popup-tab" onClick={() => openSettings()}>Model settings</button>
          <CloseButton onClick={onClose}/>
        </header>
        <div className="mp-body">
          <ModelChooser projects={projects} activeProject={activeProject} onChanged={onProjectsChanged} onOpenSettings={openSettings} />
        </div>
      </div>
    </dialog>
  );
}

function ModelChooser({ projects, activeProject, onChanged, onOpenSettings }: {
  projects: Project[]; activeProject: Project | null; onChanged: () => void; onOpenSettings: (model?: string) => void;
}): JSX.Element {
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [toolboxes, setToolboxes] = useState<Toolbox[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [autoInfo, setAutoInfo] = useState<{ configured: boolean; roles: AutoRoles | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cloudModel, setCloudModel] = useState('');
  // Tuning lives on the admin-only model manager; members would only reach an "unavailable" page.
  const [canTune, setCanTune] = useState(false);

  const refresh = useCallback(() => {
    setModelsLoading(true); setErr(null);
    fetchInstalledModels().then(setModels).catch(() => setErr('Model manager unavailable or disabled')).finally(() => setModelsLoading(false));
    fetchProviders().then((r) => setProviders(r.providers || [])).catch(() => undefined);
    fetchAutoRoles().then(setAutoInfo).catch(() => undefined);
    apiFetch('/api/models/capabilities').then((r) => r.json()).then((c: { modelManagement?: boolean }) => setCanTune(c?.modelManagement === true)).catch(() => setCanTune(false));
    fetchToolboxes().then((r) => { setToolboxes(r.toolboxes || []); setMcpStatus(r.mcp || null); }).catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);
  useModelsChanged(refresh);

  const chatModels = models.filter((m) => matchesModelUse(m.labels, 'all'));
  const defaultProviderId = providers.find((p) => p.isDefault)?.id || 'default';
  const activeProviderId = activeProject?.provider === 'lemonade' ? defaultProviderId : activeProject?.provider || defaultProviderId;
  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const auto = activeProject?.routing === 'auto';

  const save = async (key: string, patch: Record<string, unknown>) => {
    if (!activeProject) return;
    setBusy(key); setErr(null);
    try { await saveProjectConfig(activeProject.id, patch); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'The change could not be saved.'); }
    finally { setBusy(null); }
  };

  // An unset selection means the server default (core only), so the first
  // toggle has to materialise that default before changing it — otherwise
  // deselecting core would read as "unset" and silently re-enable it.
  const selectedBoxes = activeProject?.toolboxes ?? ['core'];
  const chosen = toolboxes.filter((b) => selectedBoxes.includes(b.id));
  const selectedTokens = chosen.reduce((n, b) => n + b.estTokens, 0);
  const selectedTools = chosen.reduce((n, b) => n + b.toolCount, 0);
  // Mirrors toolTokenBudgetFor() on the server. Duplicated deliberately: the
  // point is to warn BEFORE the server silently truncates, and a round trip
  // per keystroke to learn the budget would be worse than one shared constant
  // that a test pins on the server side.
  const sizeMatch = /(\d+(?:\.\d+)?)\s*[bB]\b/.exec(activeProject?.model || '');
  const budget = sizeMatch && Number(sizeMatch[1]) <= 12 ? 5000 : 8000;
  const overBudget = selectedTokens > budget;

  if (!activeProject) {
    return <p className="rail-empty">{projects.length ? 'Open a project to choose its model.' : 'No projects yet.'}</p>;
  }


  return <>
    <div className="mp-mode" role="group" aria-label="How this project picks a model">
      {([['auto', 'Auto', 'picks a model per message'], ['manual', 'Manual', 'one pinned model']] as const).map(([mode, label, hint]) =>
        <button key={mode} className="mp-mode-btn" aria-pressed={(mode === 'auto') === auto} disabled={busy !== null}
          onClick={() => void save('routing', { routing: mode })}>
          <strong>{label}</strong><span>{hint}</span>
        </button>)}
    </div>

    {auto ? (
      <p className="mp-note">
        {autoInfo?.configured
          ? <>Routing to <span className="mp-roles">{roleSummary(autoInfo.roles)}</span>. Harder questions go to Smart, the rest to Fast.</>
          : 'Auto has no models assigned yet, so replies fall back to the pinned model.'}
        {' '}<button className="mp-link" onClick={() => onOpenSettings()}>Change in model settings</button>
      </p>
    ) : (
      <section className="mp-section">
        {providers.length > 1 && <label className="mp-field">
          <span>Provider</span>
          <select className="modal-input" value={activeProviderId} disabled={busy !== null}
            onChange={(e) => void save('provider', { provider: e.target.value })}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>}

        {err && <div role="alert"><p className="rail-empty">{err}</p><button className="popup-tab" disabled={modelsLoading || busy !== null} onClick={refresh}>Retry models</button></div>}

        {activeProvider && !activeProvider.managed ? <>
          {/* A hosted API has no catalogue to list and no download flow, so the
              model is whatever id the provider documents. */}
          <label className="mp-field">
            <span>Model ID</span>
            <input className="modal-input" placeholder="e.g. claude-sonnet-4-5" value={cloudModel}
              onChange={(e) => setCloudModel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && cloudModel.trim()) void save('cloud-model', { model: cloudModel.trim() }); }} />
          </label>
          <div className="mp-row-end">
            <span className="mp-hint">{activeProject.model ? `Current: ${activeProject.model}` : 'No model set.'}</span>
            <button className="modal-btn primary" disabled={!cloudModel.trim() || busy !== null}
              onClick={() => void save('cloud-model', { model: cloudModel.trim() })}>Set</button>
          </div>
        </> : <>
          {modelsLoading && <p role="status" className="rail-empty">Loading models…</p>}
          {!modelsLoading && !err && !chatModels.length && <p role="status" className="rail-empty">No models installed. <button className="mp-link" onClick={() => onOpenSettings()}>Download one</button></p>}
          <div className="mp-models">
            {chatModels.map((m) => <div key={m.name} className="mp-model-item">
              <button className="model-row mp-model" aria-pressed={activeProject.model === m.name}
                disabled={busy !== null} onClick={() => void save(m.name, { model: m.name })}>
                <span className={`model-dot${m.loaded ? '' : ' down'}`} />
                <div className="model-name-group">
                  <span className="model-name">{m.name}</span>
                  {m.sizeGB != null && <span className="model-quant">{m.sizeGB} GB</span>}
                </div>
                <span className="model-role">{busy === m.name ? 'switching…' : activeProject.model === m.name ? 'selected' : m.loaded ? 'loaded' : ''}</span>
              </button>
              {canTune && <button className="popup-tab mp-tune" aria-label={`Tune ${m.name}`} onClick={() => onOpenSettings(m.name)}>Tune</button>}
            </div>)}
          </div>
        </>}
      </section>
    )}

    {toolboxes.length > 0 && <section className="mp-section">
      <div className="mp-section-head">
        <span className="rail-label">Tools</span>
        <span className="mp-hint">{selectedTools} enabled · ~{selectedTokens} tokens per message</span>
      </div>
      {toolboxes.map((box) => {
        const on = selectedBoxes.includes(box.id);
        return <label key={box.id} className="mp-tool">
          <input type="checkbox" checked={on} disabled={busy !== null}
            onChange={() => void save(`box-${box.id}`, { toolboxes: on ? selectedBoxes.filter((b) => b !== box.id) : [...selectedBoxes, box.id] })} />
          <span>
            <strong>{box.label}</strong>
            {box.source === 'mcp' && <span className="mp-tag">MCP</span>}
            <span className="mp-hint"> · {box.toolCount} {box.toolCount === 1 ? 'tool' : 'tools'}</span>
            <span className="mp-tool-desc">{box.description}</span>
          </span>
        </label>;
      })}
      <p className={overBudget ? 'mp-warn' : 'mp-hint'}>
        {overBudget
          ? `Over budget for ${activeProject.model || 'this model'} (~${budget} tokens). Tools past the limit are dropped in selection order — untick a box, or use a larger model.`
          : 'Every enabled tool is re-sent on each message, so this cost is paid per turn.'}
        {selectedBoxes.length === 0 && ' No tools enabled — the model can only talk.'}
      </p>
      {mcpStatus?.configured && mcpStatus.error && <p className="mp-warn">MCP server unreachable: {mcpStatus.error}. Its toolboxes are unavailable until it recovers.</p>}
    </section>}
  </>;
}
