import { useState } from 'react';
import { useModalDialog } from './useModalDialog';
import type { JSX } from 'react';
import type { Project } from '../types';
import { ShellIcon } from './ShellIcon';
import { PlusIcon } from './Icons';
import { StorageFileBrowser } from './StorageFileBrowser';
import { readTextSources, describeRejection } from '../sources';

interface ProjectsViewProps {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onPatch: (id: string, patch: Partial<Project>) => void;
  onCreate: (body: { name: string; goal: string; instructions: string; files: { name: string; content: string }[] }) => Promise<void>;
  onDelete: (id: string) => void;
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function ProjectsView({ projects, onOpenProject, onPatch, onCreate, onDelete }: ProjectsViewProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const archivedCount = projects.filter((p) => p.archived).length;
  const chatCount = projects.reduce((n, p) => n + p.chats.length, 0);
  const visibleProjects = projects
    .filter((p) => (tab === 'archived' ? p.archived : !p.archived))
    .filter((p) => `${p.name} ${p.goal || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  return (
    <div className="main projects-workspace">
      <div className="settings-scroll">
        <div className="projects-hero">
          <div><h1>Projects</h1>
          <p className="projects-hero-sub">
            {projects.length === 0
              ? 'Keep related chats and files together.'
              : `${projects.length} ${projects.length === 1 ? 'workspace' : 'workspaces'} · ${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}`}
          </p></div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><PlusIcon /><span>New project</span></button>
        </div>
        <div className="projects-head">
          <div className="seg" role="tablist" aria-label="Project list">
            <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'is-selected' : ''} onClick={() => setTab('active')}>
              Your projects
            </button>
            <button role="tab" aria-selected={tab === 'archived'} className={tab === 'archived' ? 'is-selected' : ''} onClick={() => setTab('archived')}>
              Archived{archivedCount ? ` (${archivedCount})` : ''}
            </button>
          </div>
          <input
            className="projects-search"
            type="search"
            aria-label="Filter projects"
            placeholder="Filter projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {projects.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 320 }}>
            <h2>No projects yet</h2>
            <p>
              Keep your chats, files, and instructions in one place.
              Create a project to get started.
            </p>
          </div>
        ) : (
          <div className="projects-grid">
            {visibleProjects.length === 0 && (
              <div className="empty-state" role="status">
                <h2>{query.trim() ? 'No matching projects' : 'No archived projects'}</h2>
                <p>{query.trim() ? 'Try a different name or clear the filter.' : 'Archived projects will appear here.'}</p>
              </div>
            )}
            {visibleProjects              .map((p) => (
              <div
                key={p.id}
                className="project-card"
                onClick={() => onOpenProject(p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProject(p.id); }
                }}
              >
                <div className="project-card-top">
                  <span className="project-badge" aria-hidden="true"><ShellIcon name="folder" size={22}/></span>
                  <span className="project-card-name">{p.name}</span>
                  {confirmDelete === p.id ? (
                    <span className="project-card-del" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="popup-tab"
                        style={{ border: '1px solid var(--accent)', color: 'var(--accent-text)' }}
                        onClick={() => {
                          onDelete(p.id);
                          setConfirmDelete(null);
                        }}
                      >
                        delete
                      </button>
                      <button className="popup-tab" style={{ border: '1px solid var(--border)' }} onClick={() => setConfirmDelete(null)}>
                        keep
                      </button>
                    </span>
                  ) : (
                    <button
                      className="project-card-x"
                      title="Delete project"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(p.id);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {p.goal && <p className="project-card-goal">{p.goal}</p>}
                <div className="project-card-meta">
                  <span className="project-chip">{p.chats.length} {p.chats.length === 1 ? 'chat' : 'chats'}</span>
                  {p.files.length > 0 && <span className="project-chip">{p.files.length} {p.files.length === 1 ? 'file' : 'files'}</span>}
                  <span className="project-card-time">{timeAgo(p.updatedAt)}</span>
                  {p.archived && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => { e.stopPropagation(); onPatch(p.id, { archived: false }); }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}

function CreateProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: ProjectsViewProps['onCreate'];
}): JSX.Element {
  const dialog = useModalDialog();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const { accepted, rejected } = await readTextSources(Array.from(list).slice(0, 10));
    setErr(rejected.length ? `Not added — ${describeRejection(rejected)}.` : null);
    setFiles((prev) => [...prev.filter((f) => !accepted.some((a) => a.name === f.name)), ...accepted].slice(0, 10));
  };

  const addPicked = (picked: { name: string; content: string }[]) => {
    setFiles((prev) => {
      const next = [...prev];
      for (const p of picked) {
        if (next.some((f) => f.name === p.name)) continue;
        next.push(p);
      }
      return next.slice(0, 10);
    });
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onCreate({ name: name.trim(), goal: goal.trim(), instructions, files });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="modal-overlay native-modal" aria-label="Create a project" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Create a project</h2>
          <button className="modal-x" onClick={onClose} title="Close">✕</button>
        </div>

        <label className="modal-label" htmlFor="proj-name">What are you working on?</label>
        <input
          id="proj-name"
          className="modal-input"
          placeholder="Name your project"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />

        <label className="modal-label" htmlFor="proj-goal">What are you trying to achieve?</label>
        <textarea
          id="proj-goal"
          className="modal-input"
          placeholder="Describe your project, goals, subject, etc…"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />

        <label className="modal-label" htmlFor="proj-instr">Instructions (how the AI should behave here)</label>
        <textarea
          id="proj-instr"
          className="modal-input"
          placeholder="e.g. Show code first, explain key tradeoffs, and keep answers concise."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <label className="modal-label">Knowledge files (text files injected into every chat)</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="modal-filepick">
            <input type="file" multiple accept=".txt,.md,.json,.csv,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.sh,.html,.css" onChange={(e) => void addFiles(e.target.files)} />
            <span>Add text files</span>
          </label>
          <button className="modal-filepick" style={{ background: 'none', cursor: 'pointer' }} onClick={() => setBrowsing(true)}>
            <span>Pull from storage</span>
          </button>
        </div>
        {browsing && (
          <StorageFileBrowser onClose={() => setBrowsing(false)} onPick={addPicked} />
        )}
        {files.length > 0 && (
          <div className="modal-files">
            {files.map((f, i) => (
              <span key={i} className="tool-chip">
                {f.name}
                <button
                  className="modal-file-x"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {err && <p className="modal-err">{err}</p>}

        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={() => void submit()} disabled={!name.trim() || busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
