import { Fragment, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project, Provider, Toolbox } from '../types';
import type { McpStatus } from '../api';
import { apiFetch, fetchAutoRoles, fetchInstalledModels, fetchProviders, fetchToolboxes, saveProjectConfig, setAutoRoles as putAutoRoles } from '../api';

interface ModelPopupProps {
  projects: Project[];
  activeProject: Project | null;
  onClose: () => void;
  onProjectsChanged: () => void;
}

type Tab = 'switch' | 'download' | 'manage';

export function ModelPopup({ projects, activeProject, onClose, onProjectsChanged }: ModelPopupProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('switch');
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'oklch(20% 0.02 60 / 0.35)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 70,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 110px)',
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16,
          boxShadow: '0 18px 50px oklch(15% 0.02 60 / 0.25)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 4, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
          {(['switch', 'download', 'manage'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="popup-tab"
              style={tab === t ? { background: 'var(--bg-active)', color: 'var(--text)', fontWeight: 700 } : undefined}
            >
              {t === 'switch' ? 'Switch model' : t === 'download' ? 'Download' : 'Manage'}
            </button>
          ))}
          <div style={{ flexGrow: 1 }} />
          <button className="popup-tab" onClick={onClose} title="Close">✕</button>
        </div>
        <div style={{ overflowY: 'auto', flexGrow: 1 }}>
          {tab === 'switch' && <SwitchTab projects={projects} activeProject={activeProject} onChanged={onProjectsChanged} />}
          {tab === 'download' && <DownloadTab onChanged={onProjectsChanged} />}
          {tab === 'manage' && <ManageTab onChanged={onProjectsChanged} />}
        </div>
      </div>
    </div>
  );
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
  const [providers, setProviders] = useState<Provider[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cloudModel, setCloudModel] = useState('');
  const [autoInfo, setAutoInfo] = useState<{ configured: boolean; roles: { fast: string; smart: string } | null } | null>(null);
  const [pendingRoles, setPendingRoles] = useState<{ fast?: string; smart?: string }>({});
  const [toolboxes, setToolboxes] = useState<Toolbox[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);

  const refresh = () => {
    fetchInstalledModels()
      .then(setModels)
      .catch(() => setErr('Model manager unavailable or disabled'));
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
      await apiFetch(`/api/projects/${activeProject.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const pickProvider = async (id: string) => {
    if (!activeProject) return;
    setBusy(id);
    try {
      await apiFetch(`/api/projects/${activeProject.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: id }),
      });
      setCloudModel('');
      onChanged();
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
    } finally {
      setBusy(null);
    }
  };

  const saveRoles = async () => {
    const fast = (pendingRoles.fast || autoInfo?.roles?.fast || '').trim();
    const smart = (pendingRoles.smart || autoInfo?.roles?.smart || '').trim();
    if (!fast || !smart) return;
    setBusy('roles');
    try {
      await putAutoRoles({ fast, smart });
      setPendingRoles({});
      setAutoInfo({ configured: true, roles: { fast, smart } });
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
      await apiFetch(`/api/projects/${activeProject.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cloudModel.trim() }),
      });
      onChanged();
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
          {(['fast', 'smart'] as const).map((role) => (
            <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 44, fontWeight: 600, color: 'var(--text-secondary)' }}>{role}</span>
              <select
                className="modal-input"
                style={{ flex: 1, padding: '4px 8px' }}
                value={pendingRoles[role] ?? autoInfo?.roles?.[role] ?? ''}
                onChange={(e) => setPendingRoles((prev) => ({ ...prev, [role]: e.target.value }))}
              >
                <option value="">— pick a model —</option>
                {models.map((m) => (
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
          <span style={{ fontSize: 11, color: overBudget ? 'var(--danger, #b3261e)' : 'var(--text-secondary)' }}>
            {overBudget
              ? `Over budget for ${activeProject?.model || 'this model'} (~${budget} tokens). Tools past the limit are dropped in selection order — untick a box, or use a larger model.`
              : 'Every enabled tool is re-sent on each message, so the cost above is paid per turn.'}
            {selectedBoxes.length === 0 && ' No tools enabled — the model can only talk.'}
          </span>
          {mcpStatus?.configured && mcpStatus.error && (
            <span style={{ fontSize: 11, color: 'var(--danger, #b3261e)' }}>
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
      {err && <p className="rail-empty">{err}</p>}
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
      {!activeProvider?.managed && (
        <p className="rail-empty" style={{ margin: 0 }}>
          This provider does not expose model management. Enter its model ID above;
          messages will be sent to {activeProvider?.label || 'the selected provider'}.
        </p>
      )}
      {activeProvider?.managed && models.map((m) => (
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

function DownloadTab({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ repo: string; name: string; downloads: number | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [variants, setVariants] = useState<{ repo: string; variants: { id: string; label: string; sizeGB: number | null }[] } | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; model: string; progress: number | null; status: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      apiFetch('/api/models/downloads').then((r) => r.json()).then(setJobs).catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, []);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setVariants(null);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/models/search?q=${encodeURIComponent(q)}`);
      setHits(await r.json());
    } catch {
      setMsg('search failed');
    } finally {
      setSearching(false);
    }
  };

  const showVariants = async (repo: string) => {
    setMsg(null);
    try {
      const r = await apiFetch(`/api/models/variants?repo=${encodeURIComponent(repo)}`);
      const list = await r.json();
      setVariants({ repo, variants: list });
    } catch {
      setMsg('variant lookup failed');
    }
  };

  const pull = async (checkpoint: string) => {
    setPulling(checkpoint);
    setMsg(null);
    try {
      const r = await apiFetch('/api/models/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint }),
      });
      if (r.ok) {
        setMsg(`Download started: ${checkpoint}`);
        onChanged();
      } else {
        setMsg(`Pull failed (${r.status})`);
      }
    } finally {
      setPulling(null);
    }
  };

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="composer-input"
          style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}
          placeholder="Search Hugging Face models…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button className="send-btn" onClick={() => void search()} disabled={searching}>Go</button>
      </div>
      {msg && <p className="rail-empty">{msg}</p>}
      {jobs
        .filter((j) => j.status && !['done', 'completed', 'success'].includes(j.status.toLowerCase()))
        .map((j) => (
          <div key={j.id} className="model-row">
            <span className="model-dot" />
            <div className="model-name-group">
              <span className="model-name">{j.model}</span>
              <span className="model-quant">
                {j.status}
                {j.progress != null ? ` · ${Math.round(j.progress * 100)}%` : ''}
              </span>
            </div>
          </div>
        ))}
      {hits.map((h) => (
        <Fragment key={h.repo}>
          <div className="model-row">
            <span className="model-dot down" />
            <div className="model-name-group">
              <span className="model-name">{h.name || h.repo}</span>
              <span className="model-quant">{h.repo}{h.downloads != null ? ` · ${h.downloads}` : ''}</span>
            </div>
            <button className="popup-tab" style={{ border: '1px solid var(--border)' }} onClick={() => void showVariants(h.repo)}>
              variants
            </button>
          </div>
          {variants?.repo === h.repo && (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="rail-label">{variants.repo}</div>
              {variants.variants.length === 0 && <p className="rail-empty">No variants listed — pull the default.</p>}
              {variants.variants.map((v) => (
                <div key={v.id} className="model-row" style={{ padding: '8px 12px' }}>
                  <div className="model-name-group">
                    <span className="model-name">{v.label}</span>
                    {v.sizeGB != null && <span className="model-quant">{v.sizeGB} GB</span>}
                  </div>
                  <button
                    className="popup-tab"
                    style={{ border: '1px solid var(--accent-2)', color: 'var(--accent-2)' }}
                    disabled={pulling !== null}
                    onClick={() => void pull(v.id)}
                  >
                    {pulling === v.id ? 'starting…' : 'download'}
                  </button>
                </div>
              ))}
              {variants.variants[0] && (
                <button
                  className="popup-tab"
                  style={{ alignSelf: 'flex-start', border: '1px solid var(--border)' }}
                  disabled={pulling !== null}
                  onClick={() => void pull(variants.variants[0].id)}
                >
                  pull recommended quant ({variants.variants[0].label})
                </button>
              )}
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function ManageTab({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const refresh = () => {
    fetchInstalledModels().then(setModels).catch(() => setErr('Model manager unavailable or disabled'));
  };
  useEffect(refresh, []);

  const act = async (verb: 'load' | 'unload' | 'delete', name: string) => {
    setBusy(name);
    try {
      await apiFetch(`/api/models/${verb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      refresh();
      onChanged();
    } finally {
      setBusy(null);
      setConfirmName(null);
    }
  };

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="rail-label">Installed models — load, unload, delete</div>
      {err && <p className="rail-empty">{err}</p>}
      {models.map((m) => (
        <div key={m.name} className="model-row">
          <span className={`model-dot${m.loaded ? '' : ' down'}`} />
          <div className="model-name-group">
            <span className="model-name">{m.name}</span>
            {m.sizeGB != null && <span className="model-quant">{m.sizeGB} GB</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {confirmName === m.name ? (
              <>
                <button
                  className="popup-tab"
                  style={{ border: '1px solid var(--accent)', color: 'var(--accent-text)' }}
                  disabled={busy !== null}
                  onClick={() => void act('delete', m.name)}
                >
                  confirm delete
                </button>
                <button className="popup-tab" style={{ border: '1px solid var(--border)' }} onClick={() => setConfirmName(null)}>
                  keep
                </button>
              </>
            ) : (
              <>
                <button
                  className="popup-tab"
                  style={{ border: '1px solid var(--border)' }}
                  disabled={busy !== null}
                  onClick={() => void act(m.loaded ? 'unload' : 'load', m.name)}
                >
                  {busy === m.name ? '…' : m.loaded ? 'unload' : 'load'}
                </button>
                <button
                  className="popup-tab"
                  style={{ border: '1px solid var(--border)', color: 'var(--accent-text)' }}
                  disabled={busy !== null}
                  onClick={() => setConfirmName(m.name)}
                >
                  delete
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
