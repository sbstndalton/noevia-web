import { Fragment, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project } from '../types';
import { fetchInstalledModels } from '../api';

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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    fetchInstalledModels()
      .then(setModels)
      .catch(() => setErr('Could not reach Lemonade'));
  };
  useEffect(refresh, []);

  const pick = async (name: string) => {
    if (!activeProject) return;
    setBusy(name);
    try {
      await fetch(`/api/projects/${activeProject.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
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
      {err && <p className="rail-empty">{err}</p>}
      {models.map((m) => (
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
      fetch('/api/models/downloads').then((r) => r.json()).then(setJobs).catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, []);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setVariants(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/models/search?q=${encodeURIComponent(q)}`);
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
      const r = await fetch(`/api/models/variants?repo=${encodeURIComponent(repo)}`);
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
      const r = await fetch('/api/models/pull', {
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
              <button
                className="popup-tab"
                style={{ alignSelf: 'flex-start', border: '1px solid var(--border)' }}
                disabled={pulling !== null}
                onClick={() => void pull(variants.repo)}
              >
                pull default checkpoint
              </button>
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
    fetchInstalledModels().then(setModels).catch(() => setErr('Could not reach Lemonade'));
  };
  useEffect(refresh, []);

  const act = async (verb: 'load' | 'unload' | 'delete', name: string) => {
    setBusy(name);
    try {
      await fetch(`/api/models/${verb}`, {
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
                  style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}
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
                  style={{ border: '1px solid var(--border)', color: 'var(--accent)' }}
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
