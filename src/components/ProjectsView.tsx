import { useState } from 'react';
import type { JSX } from 'react';
import type { Project } from '../types';
import { PlusIcon } from './Icons';

interface ProjectsViewProps {
  projects: Project[];
  onOpenProject: (id: string) => void;
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

export function ProjectsView({ projects, onOpenProject, onCreate, onDelete }: ProjectsViewProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="main">
      <div className="settings-scroll">
        <div className="projects-head">
          <h1>Projects</h1>
          <button className="new-project-btn" onClick={() => setCreating(true)}>
            <PlusIcon />
            <span>New project</span>
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 320 }}>
            <h2>No projects yet</h2>
            <p>
              A project keeps instructions, knowledge files, and memories with every
              chat inside it — like a workspace with a brain. Create your first one.
            </p>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((p) => (
              <div
                key={p.id}
                className="project-card"
                onClick={() => onOpenProject(p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpenProject(p.id)}
              >
                <div className="project-card-top">
                  <span className="project-card-name">{p.name}</span>
                  {confirmDelete === p.id ? (
                    <span className="project-card-del" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="popup-tab"
                        style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}
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
                  <span>{timeAgo(p.updatedAt)}</span>
                  <span>{p.chats.length} {p.chats.length === 1 ? 'chat' : 'chats'}</span>
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
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: { name: string; content: string }[] = [];
    for (const f of Array.from(list).slice(0, 10)) {
      if (f.size > 200_000) {
        setErr(`${f.name} is over 200 KB — paste the relevant part instead.`);
        continue;
      }
      next.push({ name: f.name, content: await f.text() });
    }
    setFiles((prev) => [...prev, ...next].slice(0, 10));
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
    <div className="modal-overlay" onClick={onClose}>
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
          placeholder="e.g. Always show code first. Assume I run Unraid with an AMD 890M iGPU. Be terse."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <label className="modal-label">Knowledge files (text files injected into every chat)</label>
        <label className="modal-filepick">
          <input type="file" multiple accept=".txt,.md,.json,.csv,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.sh,.html,.css" onChange={(e) => void addFiles(e.target.files)} />
          <span>Add text files</span>
        </label>
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
    </div>
  );
}
