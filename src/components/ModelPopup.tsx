import { matchesModelUse } from '../model-guidance';
import { MtpControl } from './MtpControl';
import { useEffect, useState } from 'react';
import { useModalDialog } from './useModalDialog';
import type { JSX } from 'react';
import type { InstalledModel, Project, Provider, Toolbox } from '../types';
import type { McpStatus } from '../api';
import type { AutoRoles } from '../api';
import { apiFetch, fetchAutoRoles, fetchInstalledModels, fetchProviders, fetchToolboxes, saveProjectConfig, setAutoRoles as putAutoRoles } from '../api';

interface ModelPopupProps {
  projects: Project[];
  activeProject: Project | null;
  onClose: () => void;
  onProjectsChanged: () => void;
  onOpenModelSettings?: () => void;
}

type Tab = 'switch' | 'loaded';

// The chat box's quick model switcher. Full management (downloads, settings, autoconfig,
// hardware, benchmarks) lives in Settings → Models & routing.
export function ModelPopup({ projects, activeProject, onClose, onProjectsChanged, onOpenModelSettings: openSettingsProp }: ModelPopupProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('switch');
  const onOpenModelSettings = openSettingsProp || (() => { onClose(); window.dispatchEvent(new Event('noevia:open-model-settings')); });
  const dialog = useModalDialog();
  return (
    <dialog ref={dialog} className="native-modal model-dialog-backdrop" aria-label="Models and tools" onCancel={(e) => { e.preventDefault(); onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'oklch(20% 0.02 60 / 0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div className="model-dialog-panel"
        style={{ width: 560, maxWidth: 'calc(100vw - 32px)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 18px 50px oklch(15% 0.02 60 / 0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
          {(['switch', 'loaded'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="popup-tab" style={tab === t ? { background: 'var(--bg-active)', color: 'var(--text)', fontWeight: 700 } : undefined}>
              {t === 'switch' ? 'Switch model' : 'Loaded models'}
            </button>
          ))}
          <div style={{ flexGrow: 1 }} />
          <button className="popup-tab" onClick={onOpenModelSettings}>Model settings</button>
          <button className="popup-tab" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </div>
        <div style={{ overflowY: 'auto', flexGrow: 1 }}>
          {tab === 'switch' && <SwitchTab projects={projects} activeProject={activeProject} onChanged={onProjectsChanged} />}
          {tab === 'loaded' && <LoadedTab onChanged={onProjectsChanged} onOpenModelSettings={onOpenModelSettings} />}
        </div>
      </div>
    </dialog>
  );
}

function LoadedTab({ onChanged, onOpenModelSettings }: { onChanged: () => void; onOpenModelSettings: () => void }): JSX.Element {
  const [models, setModels] = useState<InstalledModel[] | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const refresh = () => { void fetchInstalledModels().then(setModels).catch(() => setError('Models are unavailable right now.')); };
  useEffect(refresh, []);
  const act = async (verb: 'load' | 'unload', name: string) => {
    setBusy(name); setError('');
    try { const r = await apiFetch(`/api/models/${verb}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); if (!r.ok) throw Error((await r.json()).error || `${verb} failed`); refresh(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Model operation failed'); } finally { setBusy(''); }
  };
  const rows = (models || []).filter(m => !/^[0-9a-f]{32,40}$/i.test(m.name));
  return <div className="model-manage">
    <p className="mm-note">The engine keeps one model loaded and swaps on demand. Loading another replaces it.</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {!models && !error && <p role="status">Loading models…</p>}
    {rows.map(m => <div key={m.name} className="model-quick-row" data-state={m.failed ? 'failed' : m.loaded ? 'loaded' : 'unloaded'}>
      <span className={`model-dot${m.loaded ? '' : ' down'}`} />
      <span className="model-quick-name"><strong>{m.name}</strong><small>{m.failed ? 'Failed to load' : m.loaded ? 'Loaded' : 'Unloaded'}{m.sizeGB != null ? ` · ${m.sizeGB} GB` : ''}</small></span>
      <button className="popup-tab" disabled={busy !== ''} onClick={() => void act(m.loaded ? 'unload' : 'load', m.name)}>{busy === m.name ? 'Working…' : m.loaded ? 'Unload' : 'Load'}</button>
    </div>)}
    <button className="popup-tab model-manage-loader" onClick={onOpenModelSettings}>Manage models in Settings</button>
  </div>;
}

function SwitchTab({
  projects,
  activeProject,
  onChanged,
}: {
  projects: Project[];
  activeProject: Project | null;
  onChanged: () => void;
}): JSX.Element {
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [capabilities, setCapabilities] = useState<{kind:string;runtimeOptions:boolean}|null>(null);
  const chatModels = models.filter(m => matchesModelUse(m.labels, 'all'));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cloudModel, setCloudModel] = useState('');
  const [autoInfo, setAutoInfo] = useState<{ configured: boolean; roles: AutoRoles | null } | null>(null);
  const [pendingRoles, setPendingRoles] = useState<{ fast?: string; smart?: string; vision?: string }>({});
  const [toolboxes, setToolboxes] = useState<Toolbox[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);

  const refresh = () => {
    setModelsLoading(true);setErr(null);
    fetchInstalledModels().then(setModels).catch(() => setErr('Model manager unavailable or disabled')).finally(()=>setModelsLoading(false));
    apiFetch('/api/models/capabilities').then(async r => { if(!r.ok)throw Error('Capabilities unavailable'); return r.json(); }).then(setCapabilities).catch(() => setCapabilities(null));
    fetchProviders().then((r) => setProviders(r.providers || [])).catch(() => undefined);
    fetchAutoRoles().then(setAutoInfo).catch(() => undefined);
    fetchToolboxes().then((r) => { setToolboxes(r.toolboxes || []); setMcpStatus(r.mcp || null); }).catch(() => undefined);
  };
  useEffect(refresh, []);

  const defaultProviderId = providers.find((provider) => provider.isDefault)?.id || 'default';
  const activeProviderId = activeProject?.provider === 'lemonade' ? defaultProviderId : activeProject?.provider || defaultProviderId;
  const activeProvider = providers.find((p) => p.id === activeProviderId);

  const pick = async (name: string) => {
    if (!activeProject) return;
    setBusy(name);
    try {
      await saveProjectConfig(activeProject.id, { model: name });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const pickProvider = async (id: string) => {
    if (!activeProject) return;
    setBusy(id);
    try {
      await saveProjectConfig(activeProject.id, { provider: id });
      setCloudModel('');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  // An unset selection means the server default (core only), so the first
  // toggle has to materialise that default before changing it — otherwise
  // deselecting core would read as "unset" and silently re-enable it.
  const selectedBoxes = activeProject?.toolboxes ?? ['core'];
  const chosen = toolboxes.filter((b) => selectedBoxes.includes(b.id));
  const selectedTools = chosen.reduce((n, b) => n + b.toolCount, 0);
  const selectedTokens = chosen.reduce((n, b) => n + b.estTokens, 0);
  // Mirrors toolTokenBudgetFor() on the server. Duplicated deliberately: the
  // point is to warn BEFORE the server silently truncates, and a round trip
  // per keystroke to learn the budget would be worse than one shared constant
  // that a test pins on the server side.
  const sizeMatch = /(\d+(?:\.\d+)?)\s*[bB]\b/.exec(activeProject?.model || '');
  const budget = sizeMatch && Number(sizeMatch[1]) <= 12 ? 5000 : 8000;
  const overBudget = selectedTokens > budget;
  const toggleToolbox = async (id: string) => {
    if (!activeProject) return;
    const next = selectedBoxes.includes(id)
      ? selectedBoxes.filter((b) => b !== id)
      : [...selectedBoxes, id];
    setBusy(`box-${id}`);
    try {
      await saveProjectConfig(activeProject.id, { toolboxes: next });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const setRouting = async (routing: 'auto' | 'manual') => {
    if (!activeProject) return;
    setBusy('routing');
    try {
      await saveProjectConfig(activeProject.id, { routing });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const saveRoles = async () => {
    const fast = (pendingRoles.fast || autoInfo?.roles?.fast || '').trim();
    const smart = (pendingRoles.smart || autoInfo?.roles?.smart || '').trim();
    // Vision is optional: leaving it unset means images go straight to the
    // answering model, if that model can read them at all.
    const vision = (pendingRoles.vision ?? autoInfo?.roles?.vision ?? '').trim();
    if (!fast || !smart) return;
    setBusy('roles');
    try {
      await putAutoRoles({ fast, smart, vision });
      setPendingRoles({});
      setAutoInfo({ configured: true, roles: { fast, smart, ...(vision ? { vision } : {}) } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  // Cloud providers take a free-text model ID — no pull/download flow exists
  // for a hosted API (feature doc Item 0 point 4).
  const setCloudModelId = async () => {
    if (!activeProject || !cloudModel.trim()) return;
    setBusy('cloud-model');
    try {
      await saveProjectConfig(activeProject.id, { model: cloudModel.trim() });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="rail-label">
        {activeProject ? `Model for ${activeProject.name}` : 'Open a project to switch its model'}
      </div>
      {activeProject && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="popup-tab"
            style={{
              flex: 1,
              border: '1px solid',
              borderColor: activeProject.routing === 'auto' ? 'var(--accent)' : 'var(--border)',
              color: activeProject.routing === 'auto' ? 'var(--accent-ink)' : 'var(--text-secondary)',
              background: activeProject.routing === 'auto' ? 'var(--accent-2-soft)' : 'transparent',
            }}
            disabled={busy !== null}
            onClick={() => void setRouting('auto')}
          >
            Auto
            <span style={{ display: 'block', fontSize: 10, fontWeight: 500, opacity: 0.75 }}>picks a model per message</span>
          </button>
          <button
            className="popup-tab"
            style={{
              flex: 1,
              border: '1px solid',
              borderColor: activeProject.routing !== 'auto' ? 'var(--accent)' : 'var(--border)',
              color: activeProject.routing !== 'auto' ? 'var(--accent-ink)' : 'var(--text-secondary)',
              background: activeProject.routing !== 'auto' ? 'var(--accent-2-soft)' : 'transparent',
            }}
            disabled={busy !== null}
            onClick={() => void setRouting('manual')}
          >
            Manual
            <span style={{ display: 'block', fontSize: 10, fontWeight: 500, opacity: 0.75 }}>one pinned model</span>
          </button>
        </div>
      )}
      {activeProject?.routing === 'auto' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card, 10px)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span className="rail-label" style={{ margin: 0 }}>
            Roles {autoInfo?.configured ? '(models load on demand)' : '— pick Fast and Smart, then Save'}
          </span>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Vision is optional. Set it and that model describes any images in the project, then Fast or
            Smart answers from the description — so the answering model does not need to see.
          </p>
          {(['fast', 'smart', 'vision'] as const).map((role) => (
            <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 44, fontWeight: 600, color: 'var(--text-secondary)' }}>{role}</span>
              <select
                className="modal-input"
                style={{ flex: 1, padding: '4px 8px' }}
                value={pendingRoles[role] ?? autoInfo?.roles?.[role] ?? ''}
                onChange={(e) => setPendingRoles((prev) => ({ ...prev, [role]: e.target.value }))}
              >
                <option value="">{role === 'vision' ? '— none —' : '— pick a model —'}</option>
                {!modelsLoading && chatModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
                {autoInfo?.roles?.[role] && !models.some((m) => m.name === autoInfo.roles?.[role]) && (
                  <option value={autoInfo.roles[role]}>{autoInfo.roles[role]}</option>
                )}
              </select>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                {models.find((m) => m.name === (pendingRoles[role] ?? autoInfo?.roles?.[role]))?.loaded ? 'loaded' : ''}
              </span>
            </label>
          ))}
          <button className="modal-btn primary" style={{ padding: '5px 12px', alignSelf: 'flex-end' }} disabled={busy !== null} onClick={() => void saveRoles()}>
            Save roles
          </button>
        </div>
      )}
      {activeProject && toolboxes.length > 0 && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card, 10px)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span className="rail-label" style={{ margin: 0 }}>
            Tools ({selectedTools} enabled · ~{selectedTokens} tokens per message)
          </span>
          {toolboxes.map((box) => {
            const on = selectedBoxes.includes(box.id);
            return (
              <label
                key={box.id}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy !== null}
                  onChange={() => void toggleToolbox(box.id)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ flex: 1 }}>
                  <strong>{box.label}</strong>
                  {box.source === 'mcp' && (
                    <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-2-soft)', color: 'var(--accent-ink)' }}>
                      MCP
                    </span>
                  )}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {' '}· {box.toolCount} {box.toolCount === 1 ? 'tool' : 'tools'} · ~{box.estTokens} tokens
                  </span>
                  <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 11 }}>{box.description}</span>
                </span>
              </label>
            );
          })}
          <span style={{ fontSize: 11, color: overBudget ? 'var(--danger)' : 'var(--text-secondary)' }}>
            {overBudget
              ? `Over budget for ${activeProject?.model || 'this model'} (~${budget} tokens). Tools past the limit are dropped in selection order — untick a box, or use a larger model.`
              : 'Every enabled tool is re-sent on each message, so the cost above is paid per turn.'}
            {selectedBoxes.length === 0 && ' No tools enabled — the model can only talk.'}
          </span>
          {mcpStatus?.configured && mcpStatus.error && (
            <span style={{ fontSize: 11, color: 'var(--danger)' }}>
              MCP server unreachable: {mcpStatus.error}. Its toolboxes are unavailable until it recovers.
            </span>
          )}
        </div>
      )}
      {providers.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {providers.map((p) => (
            <button
              key={p.id}
              className="popup-tab"
              style={{
                border: '1px solid',
                borderColor: activeProviderId === p.id ? 'var(--accent-2)' : 'var(--border)',
                color: activeProviderId === p.id ? 'var(--accent-ink)' : 'var(--text-secondary)',
                background: activeProviderId === p.id ? 'var(--accent-2-soft)' : 'transparent',
              }}
              disabled={!activeProject || busy !== null}
              onClick={() => void pickProvider(p.id)}
            >
              {p.label}
            </button>
          ))
          }
        </div>
      )}
      {err && <div role="alert"><p className="rail-empty">{err}</p><button className="popup-tab" disabled={modelsLoading || busy!==null} onClick={refresh}>Retry models</button></div>}
      {modelsLoading && <p role="status">Loading models…</p>}
      {!modelsLoading && !err && !models.length && <p role="status">No models are available in the model manager.</p>}
      {!activeProvider?.managed && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="modal-input"
            style={{ flex: 1 }}
            placeholder="Model ID for this provider (e.g. claude-sonnet-4-5)"
            value={cloudModel}
            onChange={(e) => setCloudModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void setCloudModelId()}
          />
          <button
            className="modal-btn primary"
            style={{ padding: '6px 14px' }}
            disabled={!activeProject || !cloudModel.trim() || busy !== null}
            onClick={() => void setCloudModelId()}
          >
            Set
          </button>
        </div>
      )}
      {activeProvider?.managed && activeProject?.model && activeProject.routing !== 'auto' && (
        <p className="rail-empty" style={{ margin: 0 }}>
          Current: <strong>{activeProject.model}</strong>
          {activeProvider ? ` via ${activeProvider.label}` : ''}
        </p>
      )}
      {activeProvider?.managed && capabilities?.runtimeOptions && models.find(m=>m.name===activeProject?.model) && <MtpControl key={activeProject?.model} model={models.find(m=>m.name===activeProject?.model)!} onChanged={()=>{refresh();onChanged();}} />}
      {activeProvider?.managed && capabilities?.kind === 'llamacpp' && <p className="rail-empty" style={{margin:0}}>MTP is configured in the native runtime profile. Administrators can inspect it in Manage. Live acceptance appears in chat statistics after speculative decoding.</p>}
      {!activeProvider?.managed && (
        <p className="rail-empty" style={{ margin: 0 }}>
          This provider does not expose model management. Enter its model ID above;
          messages will be sent to {activeProvider?.label || 'the selected provider'}.
        </p>
      )}
      {activeProvider?.managed && chatModels.map((m) => (
        <button
          key={m.name}
          className="model-row"
          style={{
            cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)',
            opacity: activeProject?.model === m.name ? 1 : 0.85,
            borderColor: activeProject?.model === m.name ? 'var(--accent)' : 'var(--border)',
          }}
          disabled={!activeProject || busy !== null}
          onClick={() => void pick(m.name)}
        >
          <span className={`model-dot${m.loaded ? '' : ' down'}`} />
          <div className="model-name-group">
            <span className="model-name">{m.name}</span>
            {m.sizeGB != null && <span className="model-quant">{m.sizeGB} GB</span>}
          </div>
          <span className="model-role">
            {busy === m.name
              ? 'switching…'
              : activeProject?.model === m.name
                ? 'active in this project'
                : m.loaded
                  ? 'loaded'
                  : ''}
          </span>
        </button>
      ))}
      {projects.length === 0 && <p className="rail-empty">No projects yet.</p>}
    </div>
  );
}
