import { matchesModelUse } from '../model-guidance';
import { MiddleTruncate } from './MiddleTruncate';
import { useModelsChanged } from '../models-changed';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';
import { roleSummary } from '../routing-copy';
import { CloseButton } from './CloseButton';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';
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
  const t = useT();
  const openSettings = (model?: string) => {
    if (openSettingsProp) return openSettingsProp(model);
    onClose(); window.dispatchEvent(new CustomEvent('noevia:open-model-settings', { detail: { model } }));
  };
  return (
    <dialog ref={dialog} className="native-modal model-dialog-backdrop" aria-label={t('modelPopup.title')}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      <div className="mp-panel aero dialog-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="mp-head">
          <h2><small>{t('modelPopup.title')}</small>{activeProject ? activeProject.name : t('modelPopup.model')}</h2>
          <button className="btn btn-ghost btn-sm mp-settings" onClick={() => openSettings()}><ShellIcon name="settings" size={16}/>{t('modelPopup.settings')}</button>
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
  const t = useT();
  const tRef = useRef(t); tRef.current = t;

  const refresh = useCallback(() => {
    setModelsLoading(true); setErr(null);
    fetchInstalledModels().then(setModels).catch(() => setErr(tRef.current('modelPopup.unavailable'))).finally(() => setModelsLoading(false));
    fetchProviders().then((r) => setProviders(r.providers || [])).catch(() => undefined);
    fetchAutoRoles().then(setAutoInfo).catch(() => undefined);
    apiFetch('/api/models/capabilities').then((r) => r.json()).then((c: { modelManagement?: boolean }) => setCanTune(c?.modelManagement === true)).catch(() => setCanTune(false));
    fetchToolboxes().then((r) => { setToolboxes(r.toolboxes || []); setMcpStatus(r.mcp || null); }).catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);
  useModelsChanged(refresh);

  const chatModels = models.filter((m) => matchesModelUse(m.labels, 'all'));
  // A long catalogue gets a filter; a handful of models does not need one.
  const [modelQuery, setModelQuery] = useState('');
  const shownModels = chatModels.filter((m) => m.name.toLowerCase().includes(modelQuery.trim().toLowerCase()));
  const defaultProviderId = providers.find((p) => p.isDefault)?.id || 'default';
  const activeProviderId = activeProject?.provider === 'lemonade' ? defaultProviderId : activeProject?.provider || defaultProviderId;
  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const auto = activeProject?.routing === 'auto';

  const save = async (key: string, patch: Record<string, unknown>) => {
    if (!activeProject) return;
    setBusy(key); setErr(null);
    try { await saveProjectConfig(activeProject.id, patch); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('modelPopup.saveError')); }
    finally { setBusy(null); }
  };

  // An unset selection means the server default (core only), so the first
  // toggle has to materialise that default before changing it — otherwise
  // deselecting core would read as "unset" and silently re-enable it.
  // A connected connector is never in the project's own toolboxes list (it isn't picked here,
  // it's connected in Settings), but the chat loop sends it every turn regardless — count it as
  // selected too, or the tool list and token budget under-report what actually goes out (#354).
  const connectorIds = toolboxes.filter((b) => b.connector).map((b) => b.id);
  const rawSelectedBoxes = activeProject?.toolboxes ?? ['core'];
  const selectedBoxes = connectorIds.length ? [...new Set([...rawSelectedBoxes, ...connectorIds])] : rawSelectedBoxes;
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
    return <p className="rail-empty">{projects.length ? t('modelPopup.openProject') : t('modelPopup.noProjects')}</p>;
  }


  return <div className="mp-grid">
    <section className="mp-col mp-col-model" aria-label={t('modelPopup.model')}>
    <h3 className="mp-col-title">{t('modelPopup.model')}</h3>
    <div className="mp-mode" role="group" aria-label={t('modelPopup.modeLabel')}>
      {([['auto', t('modelPopup.auto'), t('modelPopup.autoHint')], ['manual', t('modelPopup.manual'), t('modelPopup.manualHint')]] as const).map(([mode, label, hint]) =>
        <button key={mode} className="mp-mode-btn" aria-pressed={(mode === 'auto') === auto} disabled={busy !== null}
          onClick={() => void save('routing', { routing: mode })}>
          <strong>{label}</strong><span>{hint}</span>
        </button>)}
    </div>

    {auto ? (
      <p className="mp-note">
        {autoInfo?.configured
          ? <>{t('modelPopup.routingTo')}<span className="mp-roles">{roleSummary(autoInfo.roles, t)}</span>{t('modelPopup.routingAfter')}</>
          : t('modelPopup.autoUnset')}
        {' '}<button className="mp-link" onClick={() => onOpenSettings()}>{t('modelPopup.change')}</button>
      </p>
    ) : (
      <div className="mp-model-area">
        {providers.length > 1 && <label className="mp-field">
          <span>{t('modelPopup.provider')}</span>
          <select className="modal-input" value={activeProviderId} disabled={busy !== null}
            onChange={(e) => void save('provider', { provider: e.target.value })}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>}

        {err && <div role="alert"><p className="rail-empty">{err}</p><button className="popup-tab" disabled={modelsLoading || busy !== null} onClick={refresh}>{t('modelPopup.retry')}</button></div>}

        {activeProvider && !activeProvider.managed ? <>
          {/* A hosted API has no catalogue to list and no download flow, so the
              model is whatever id the provider documents. */}
          <label className="mp-field">
            <span>{t('modelPopup.modelId')}</span>
            <input className="modal-input" placeholder={t('modelPopup.modelIdPlaceholder')} value={cloudModel}
              onChange={(e) => setCloudModel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && cloudModel.trim()) void save('cloud-model', { model: cloudModel.trim(), routing: 'manual' }); }} />
          </label>
          <div className="mp-row-end">
            <span className="mp-hint">{activeProject.model ? t('modelPopup.current', { model: activeProject.model }) : t('modelPopup.noModel')}</span>
            <button className="modal-btn primary" disabled={!cloudModel.trim() || busy !== null}
              onClick={() => void save('cloud-model', { model: cloudModel.trim(), routing: 'manual' })}>{t('modelPopup.set')}</button>
          </div>
        </> : <>
          {modelsLoading && <p role="status" className="rail-empty">{t('modelPopup.loading')}</p>}
          {!modelsLoading && !err && !chatModels.length && <p role="status" className="rail-empty">{t('modelPopup.none')} <button className="mp-link" onClick={() => onOpenSettings()}>{t('modelPopup.download')}</button></p>}
          {chatModels.length > 6 && <div className="settings-search mp-model-search"><input type="search" aria-label={t('modelPopup.filter')} placeholder={t('modelPopup.filter')} value={modelQuery} onChange={(e) => setModelQuery(e.target.value)}/></div>}
          {modelQuery && !shownModels.length && <p role="status" className="rail-empty">{t('modelPopup.noMatch', { query: modelQuery })}</p>}
          <div className="mp-models">
            {shownModels.map((m) => <div key={m.name} className="mp-model-item">
              <button className="model-row mp-model" aria-pressed={activeProject.model === m.name}
                disabled={busy !== null} onClick={() => void save(m.name, { model: m.name, routing: 'manual' })}>
                <span className={`model-dot${m.loaded ? '' : ' down'}`} />
                <div className="model-name-group">
                  <MiddleTruncate className="model-name" text={m.name}/>
                  {m.sizeGB != null && <span className="model-quant">{m.sizeGB} GB</span>}
                </div>
                <span className="model-role">{busy === m.name ? t('modelPopup.switching') : activeProject.model === m.name ? <><ShellIcon name="check" size={15}/>{t('modelPopup.selected')}</> : m.loaded ? t('modelPopup.loaded') : ''}</span>
              </button>
              {canTune && <button className="shell-icon-button mp-tune" aria-label={t('modelPopup.tune', { model: m.name })} title={t('modelPopup.tuneTitle')} onClick={() => onOpenSettings(m.name)}><ShellIcon name="personalization" size={17}/></button>}
            </div>)}
          </div>
        </>}
      </div>
    )}

    </section>
    {toolboxes.length > 0 && <section className="mp-col mp-col-tools" aria-label={t('modelPopup.tools')}>
      <div className="mp-section-head">
        <h3 className="mp-col-title">{t('modelPopup.tools')}</h3>
        <span className="mp-hint">{t('modelPopup.enabled', { tools: selectedTools, tokens: selectedTokens })}</span>
      </div>
      {/* How much of the model's tool budget the chosen toolboxes use. */}
      <div className={`mp-budget${overBudget ? ' is-over' : ''}`} role="meter" aria-label={t('modelPopup.budget')} aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(selectedTokens, budget)}>
        <span style={{ width: `${Math.min(100, Math.round((selectedTokens / budget) * 100))}%` }}/>
      </div>
      <div className="mp-tool-list">
      {toolboxes.map((box) => {
        const on = selectedBoxes.includes(box.id);
        return <label key={box.id} className="mp-tool">
          {/* A connector is on because it's connected (Settings → Connectors), not because it's
              picked here — show it as always-on rather than a checkbox nobody can uncheck. */}
          <input type="checkbox" checked={on} disabled={busy !== null || box.connector}
            onChange={() => void save(`box-${box.id}`, { toolboxes: on ? rawSelectedBoxes.filter((b) => b !== box.id) : [...rawSelectedBoxes, box.id] })} />
          <span>
            <strong>{box.label}</strong>
            {box.source === 'mcp' && <span className="mp-tag">MCP</span>}
            {box.connector && <span className="mp-tag">{t('tools.onForChat')}</span>}
            <span className="mp-hint"> · {t.plural('modelPopup.toolCount', box.toolCount)}</span>
            <span className="mp-tool-desc">{box.description}</span>
          </span>
        </label>;
      })}
      </div>
      <p className={overBudget ? 'mp-warn' : 'mp-hint'}>
        {overBudget
          ? t('modelPopup.over', { model: activeProject.model || t('modelPopup.thisModel'), budget })
          : t('modelPopup.perTurn')}
        {selectedBoxes.length === 0 && ` ${t('modelPopup.noTools')}`}
      </p>
      {mcpStatus?.configured && mcpStatus.error && <p className="mp-warn">{t('modelPopup.mcpDown', { error: mcpStatus.error })}</p>}
    </section>}
  </div>;
}
