import { useState } from 'react';
import type { JSX } from 'react';
import type { Project, ProjectFile } from '../types';
import { PlusIcon } from './Icons';
import { StorageFileBrowser } from './StorageFileBrowser';

/** First free "name", "name (2)", "name (3)", … avoiding collisions. */
function uniqueName(name: string, existing: { name: string }[]): string {
  if (!existing.some((f) => f.name === name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existing.some((f) => f.name === candidate)) return candidate;
  }
}

interface ProjectViewProps {
  project: Project;
  onNewChat: (projectId: string) => void;
  onOpenChat: (projectId: string, chatId: string) => void;
  onPatch: (projectId: string, patch: Partial<Project>) => void;
  onDeleteChat: (projectId: string, chatId: string) => void;
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

export function ProjectView({ project, onNewChat, onOpenChat, onPatch, onDeleteChat }: ProjectViewProps): JSX.Element {
  const [panel, setPanel] = useState<'instructions' | 'files' | 'memory' | null>(null);

  return (
    <div className="main">
      <div className="project-layout">
        <div className="project-main">
          <h1 className="project-title">{project.name}</h1>
          {project.goal && <p className="project-goal">{project.goal}</p>}

          <button className="new-task-row" onClick={() => onNewChat(project.id)}>
            <PlusIcon />
            <span>New task in {project.name}</span>
          </button>

          <div className="rail-label" style={{ marginTop: 26 }}>Recents</div>
          {project.chats.length === 0 ? (
            <p className="rail-empty">No chats yet — start the first one above.</p>
          ) : (
            <div className="recents-list">
              {project.chats.map((c) => (
                <div key={c.id} className="recents-row" onClick={() => onOpenChat(project.id, c.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpenChat(project.id, c.id)}>
                  <span className="recents-title">{c.title || 'New task'}</span>
                  <span className="recents-meta">{timeAgo(c.updatedAt)}</span>
                  <button
                    className="recents-del"
                    title="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(project.id, c.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="project-rail">
          <RailRow
            label="Instructions"
            hint={project.instructions ? `${project.instructions.length} chars` : 'Add'}
            onClick={() => setPanel(panel === 'instructions' ? null : 'instructions')}
          />
          {panel === 'instructions' && (
            <RailTextarea
              value={project.instructions}
              placeholder="How the AI should behave in every chat of this project…"
              onChange={(v) => onPatch(project.id, { instructions: v })}
              onFile={(t) => onPatch(project.id, { instructions: t })}
              fileMode="replace"
            />
          )}

          <RailRow
            label="Files"
            hint={project.files.length ? `${project.files.length} file${project.files.length === 1 ? '' : 's'}` : 'Add'}
            onClick={() => setPanel(panel === 'files' ? null : 'files')}
          />
          {panel === 'files' && <RailFiles files={project.files} onChange={(files) => onPatch(project.id, { files })} />}

          <RailRow
            label="Memory"
            hint={project.memories.length ? `${project.memories.length} line${project.memories.length === 1 ? '' : 's'}` : 'Edit'}
            onClick={() => setPanel(panel === 'memory' ? null : 'memory')}
          />
          {panel === 'memory' && (
            <RailTextarea
              value={project.memories.join('\n')}
              placeholder="One memory per line — e.g. Prefer concise answers with runnable examples"
              onChange={(v) => onPatch(project.id, { memories: v.split('\n').map((x) => x.trim()).filter(Boolean) })}
              onFile={(t) => onPatch(project.id, { memories: [...project.memories, ...t.split('\n').map((x) => x.trim()).filter(Boolean)] })}
              fileMode="append"
            />
          )}

          <p className="rail-empty" style={{ marginTop: 10 }}>
            Instructions, files, and memory ride along with every chat in this project.
          </p>
        </div>
      </div>
    </div>
  );
}

function RailRow({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }): JSX.Element {
  return (
    <button className="rail-row-btn" onClick={onClick}>
      <span className="rail-row-label">{label}</span>
      <span className="rail-row-hint">{hint}</span>
    </button>
  );
}

const UPLOAD_CAP = 200_000; // same cap RailFiles applies

function RailTextarea({
  value,
  placeholder,
  onChange,
  onFile,
  fileMode,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onFile?: (content: string) => void;
  fileMode?: 'replace' | 'append';
}): JSX.Element {
  const addFile = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f || f.size > UPLOAD_CAP || !onFile) return;
    onFile(await f.text());
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <textarea
        className="modal-input"
        style={{ minHeight: 110, marginBottom: 8 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {onFile && (
        <label className="modal-filepick">
          <input
            type="file"
            accept=".md,.txt"
            onChange={(e) => {
              void addFile(e.target.files);
              e.target.value = '';
            }}
          />
          <span>{fileMode === 'append' ? 'Append .md / .txt' : 'Replace with .md / .txt'}</span>
        </label>
      )}
    </div>
  );
}

function RailFiles({
  files,
  onChange,
}: {
  files: ProjectFile[];
  onChange: (files: ProjectFile[]) => void;
}): JSX.Element {
  const [browsing, setBrowsing] = useState(false);
  const add = async (list: FileList | null) => {
    if (!list) return;
    const next: ProjectFile[] = [];
    for (const f of Array.from(list).slice(0, 5)) {
      if (f.size > 200_000) continue;
      next.push({ name: f.name, content: await f.text() });
    }
    onChange([...files, ...next].slice(0, 20));
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {files.map((f, i) => (
        <div key={i} className="model-row" style={{ padding: '8px 12px', marginBottom: 6 }}>
          <span className="model-name-group">
            <span className="model-name" style={{ fontWeight: 400 }}>{f.name}</span>
          </span>
          <button
            className="popup-tab"
            style={{ border: '1px solid var(--border)', color: 'var(--accent)' }}
            onClick={() => onChange(files.filter((_, j) => j !== i))}
          >
            remove
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="modal-filepick">
          <input
            type="file"
            multiple
            accept=".txt,.md,.json,.csv,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.sh,.html,.css"
            onChange={(e) => void add(e.target.files)}
          />
          <span>Add text files</span>
        </label>
        <button
          className="modal-filepick"
          style={{ background: 'none', cursor: 'pointer' }}
          onClick={() => setBrowsing(true)}
        >
          <span>Pull from storage</span>
        </button>
      </div>
      {browsing && (
        <StorageFileBrowser
          onClose={() => setBrowsing(false)}
          onPick={(picked) => onChange([...files, ...picked.map((p) => ({ name: uniqueName(p.name, files) , content: p.content }))].slice(0, 20))}
        />
      )}
    </div>
  );
}
