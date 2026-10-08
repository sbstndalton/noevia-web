import { isChatGenerationModel } from '../model-kind';
import { formatModelSizeGB } from '../model-size';
import { appLocale } from '../user-preferences';
import { MiddleTruncate } from './MiddleTruncate';
import { useModelsChanged } from '../models-changed';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';
import { roleSummary } from '../routing-copy';
import { CloseButton } from './CloseButton';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';
import type { JSX, ReactNode } from 'react';
import type { InstalledModel, Project, Provider } from '../types';
import type { AutoRoles } from '../api';
import { apiFetch, fetchAutoRoles, fetchChatGptModels, fetchInstalledModels, fetchProviders, saveProjectConfig } from '../api';
import { ProjectRoutingMode } from './ProjectRoutingMode';
import { SegmentedControl } from './SegmentedControl';

interface ModelPopupProps {
  projects: Project[];
  activeProject: Project | null;
  onClose: () => void;
  /** May return a promise: the popup keeps its controls busy until it settles, so the next change
   *  is built from the refreshed project, not a stale one (#862). */
  onProjectsChanged: () => void | Promise<unknown>;
  onOpenModelSettings?: (model?: string) => void;
  /** #527, the phone model sheet: the live status block above the model list, and the Thinking
   *  section after it. Left out, the panel is exactly the Model and tools panel it always was. */
  status?: ReactNode;
  thinking?: ReactNode;
}

// The chat box's model control, and deliberately only that: pick Auto or one model. #1006: tools
// have their own control (Tools: Automatic / Manual in the composer's + menu). #1007: in Auto,
// this chat's own routing mode, with the same control as Settings → Models & routing → Routing.
//
// Everything else — downloads, per-model settings, autoconfig, hardware,
// benchmarks, the prompt library, and configuring what Auto routes TO — lives
// in Settings → Models & routing. This panel used to carry all of it, which
// made the common action (switch model) compete for space with administration
// nobody performs mid-conversation.
export function ModelPopup({ projects, activeProject, onClose, onProjectsChanged, onOpenModelSettings: openSettingsProp, status, thinking }: ModelPopupProps): JSX.Element {
  const dialog = useModalDialog();
  const t = useT();
  const phoneSheet = !!(status || thinking);
  const openSettings = (model?: string) => {
    if (openSettingsProp) return openSettingsProp(model);
    onClose(); window.dispatchEvent(new CustomEvent('noevia:open-model-settings', { detail: { model } }));
  };
  return (
    <dialog ref={dialog} className="native-modal model-dialog-backdrop" aria-label={t('modelPopup.title')}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      <div className={`mp-panel aero dialog-sheet${phoneSheet ? ' is-phone-sheet' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="mp-head">
          {/* #527: the phone sheet opens on its heading, so the status block at the top is what is
              read and seen first; left to itself, initial focus would land on the first field (a
              model filter or a tool checkbox) and scroll the sheet past it. */}
          <h2 {...(phoneSheet ? { tabIndex: -1, 'data-initial-focus': '' } : {})}><small>{t('modelPopup.title')}</small>{activeProject ? activeProject.name : t('modelPopup.model')}</h2>
          <button className="btn btn-ghost btn-sm mp-settings" onClick={() => openSettings()}><ShellIcon name="settings" size={16}/>{t('modelPopup.settings')}</button>
          <CloseButton onClick={onClose}/>
        </header>
        <div className="mp-body">
          <ModelChooser projects={projects} activeProject={activeProject} onChanged={onProjectsChanged} onOpenSettings={openSettings} before={status} afterModel={thinking} />
        </div>
      </div>
    </dialog>
  );
}

function ModelChooser({ projects, activeProject, onChanged, onOpenSettings, before, afterModel }: {
  projects: Project[]; activeProject: Project | null; onChanged: () => void | Promise<unknown>; onOpenSettings: (model?: string) => void;
  before?: ReactNode; afterModel?: ReactNode;
}): JSX.Element {
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [autoInfo, setAutoInfo] = useState<{ configured: boolean; roles: AutoRoles | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Every busy-gated control here (the Auto/Manual toggle, a model row, the provider
  // select, a toolbox checkbox…) shares `disabled={busy !== null}`, so the control the
  // user just activated — and which therefore still has focus — becomes disabled for the
  // duration of the save. Browsers force-blur a focused element the instant it becomes
  // disabled, so focus falls to <body> until the user's next Tab press (#419). Remember
  // what had focus when a save started and, once busy clears and the control is enabled
  // again, put focus back — but only if it actually fell away, so a user who tabbed
  // onward during the save keeps where they moved to.
  const focusOnIdle = useRef<HTMLElement | null>(null);
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
  }, []);
  useEffect(refresh, [refresh]);
  useModelsChanged(refresh);

  // Embedding/reranking models and Laya (the internal routing model) cannot answer a chat
  // prompt — matchesModelUse('all') only excluded the former, so Laya slipped through as a
  // pickable Manual model with no server-side guard on this path either until now (#409).
  const chatModels = models.filter((m) => !m.missingFile && isChatGenerationModel(m.name, m.labels));
  // A long catalogue gets a filter; a handful of models does not need one.
  const [modelQuery, setModelQuery] = useState('');
  const shownModels = chatModels.filter((m) => m.name.toLowerCase().includes(modelQuery.trim().toLowerCase()));
  const defaultProviderId = providers.find((p) => p.isDefault)?.id || 'default';
  const activeProviderId = activeProject?.provider === 'lemonade' ? defaultProviderId : activeProject?.provider || defaultProviderId;
  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const auto = activeProject?.routing === 'auto';
  // #447: a ChatGPT connection lists the account's own models; free text only if that list fails.
  const chatgptActive = activeProvider?.kind === 'chatgpt-oauth';
  const [accountModels, setAccountModels] = useState<string[] | null>(null);
  useEffect(() => {
    if (!chatgptActive) { setAccountModels(null); return; }
    let live = true;
    setAccountModels(null);
    fetchChatGptModels().then((r) => { if (live) setAccountModels(Array.isArray(r.models) && r.models.length ? r.models : []); }).catch(() => { if (live) setAccountModels([]); });
    return () => { live = false; };
  }, [chatgptActive]);

  const save = async (key: string, patch: Record<string, unknown>) => {
    if (!activeProject) return;
    focusOnIdle.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(key); setErr(null);
    try {
      await saveProjectConfig(activeProject.id, patch);
      // #862: stay busy until the parent has re-read the project. Clearing `busy` first let a
      // quick second toggle build its whole toolbox list from the stale `activeProject` and put
      // back what the first one had just switched off. A refresh that fails is not a failed
      // save; the next change then starts from what the server holds on the following load.
      try { await onChanged(); } catch { /* the save itself succeeded */ }
    }
    catch (e) { setErr(e instanceof Error ? e.message : t('modelPopup.saveError')); }
    finally { setBusy(null); }
  };
  // Runs once the re-render that clears `busy` has actually committed, so the control is
  // enabled again by the time `.focus()` is called — calling it any earlier would silently
  // no-op against the still-disabled element, same as the bug this fixes.
  useEffect(() => {
    if (busy !== null) return;
    const el = focusOnIdle.current;
    focusOnIdle.current = null;
    if (el && document.activeElement === document.body && document.contains(el)) el.focus();
  }, [busy]);


  if (!activeProject) {
    return <p className="rail-empty">{projects.length ? t('modelPopup.openProject') : t('modelPopup.noProjects')}</p>;
  }

  // #1079: Context: Low (the model as tuned) or High (its long-context profile from a Long tune),
  // offered when the chosen model, or a model Auto answers with, has one. Local models only.
  const byName = new Map(chatModels.map((m) => [m.name, m]));
  const answering = auto ? [autoInfo?.roles?.fast, autoInfo?.roles?.smart, autoInfo?.roles?.code] : [activeProject.model];
  const local = !chatgptActive && (!activeProvider || !!activeProvider.managed);
  const longCapable = local && answering.some((name) => !!name && !!byName.get(name)?.longVariant);
  const contextValue: 'low' | 'high' = activeProject.contextProfile === 'high' ? 'high' : 'low';
  const contextControl = longCapable && <div className="mp-context">
    <div className="mp-context-row">
      <span className="mp-context-label" id="mp-context-label">{t('modelPopup.context')}</span>
      <SegmentedControl<'low' | 'high'> label={t('modelPopup.context')} value={contextValue}
        options={[['low', t('modelPopup.contextLow')], ['high', t('modelPopup.contextHigh')]]}
        onChange={(next) => { if (busy === null) void save('context', { contextProfile: next }); }}/>
    </div>
    <p className="mp-hint">{busy === 'context' ? t('modelPopup.switching') : auto ? t('modelPopup.contextHintAuto') : t('modelPopup.contextHint')}</p>
  </div>;


  return <div className="mp-grid">
    {before}
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
    ) : null}
    {auto && contextControl}
    {auto ? <ProjectRoutingMode project={activeProject} disabled={busy !== null} onChanged={onChanged} /> : (
      <div className="mp-model-area">
        {providers.length > 1 && <label className="mp-field">
          <span>{t('modelPopup.provider')}</span>
          <select className="modal-input" value={activeProviderId} disabled={busy !== null}
            onChange={(e) => void save('provider', { provider: e.target.value })}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>}

        {err && <div role="alert"><p className="rail-empty">{err}</p><button className="popup-tab" disabled={modelsLoading || busy !== null} onClick={refresh}>{t('modelPopup.retry')}</button></div>}

        {chatgptActive && accountModels === null ? <p role="status" className="rail-empty">{t('modelPopup.loading')}</p>
        : chatgptActive && accountModels && accountModels.length > 0 ? <div className="mp-models">
            {accountModels.map((id) => <div key={id} className="mp-model-item">
              <button className="model-row mp-model" aria-pressed={activeProject.model === id}
                disabled={busy !== null} onClick={() => void save(id, { model: id, routing: 'manual' })}>
                <div className="model-name-group"><MiddleTruncate className="model-name" text={id}/></div>
                <span className="model-role">{busy === id ? t('modelPopup.switching') : activeProject.model === id ? <><ShellIcon name="check" size={15}/>{t('modelPopup.selected')}</> : ''}</span>
              </button>
            </div>)}
          </div>
        : activeProvider && !activeProvider.managed ? <>
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
                  {formatModelSizeGB(m.sizeGB, appLocale()) && <span className="model-quant">{formatModelSizeGB(m.sizeGB, appLocale())}</span>}
                </div>
                <span className="model-role">{busy === m.name ? t('modelPopup.switching') : activeProject.model === m.name ? <><ShellIcon name="check" size={15}/>{t('modelPopup.selected')}</> : m.loaded ? t('modelPopup.loaded') : ''}</span>
              </button>
              {canTune && <button className="shell-icon-button mp-tune" aria-label={t('modelPopup.tune', { model: m.name })} title={t('modelPopup.tuneTitle')} onClick={() => onOpenSettings(m.name)}><ShellIcon name="personalization" size={17}/></button>}
            </div>)}
          </div>
          {contextControl}
        </>}
      </div>
    )}

    </section>
    {afterModel}
  </div>;
}
