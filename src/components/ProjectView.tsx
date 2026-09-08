import { useState } from 'react';
import type { JSX } from 'react';
import type { Project } from '../types';
import { SendIcon } from './Icons';
import { StorageFileBrowser } from './StorageFileBrowser';
import { TEXT_EXTENSIONS, readTextSources, describeRejection } from '../sources';

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
  onSendFirst: (projectId: string, text: string) => void;
  onEditProject: (projectId: string) => void;
  onOpenChat: (projectId: string, chatId: string) => void;
  onPatch: (projectId: string, patch: Partial<Project>) => void;
  onDeleteChat: (projectId: string, chatId: string) => void;
  streamingChats: Record<string, true>;
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

export function ProjectView({
  project,
  onNewChat,
  onSendFirst,
  onEditProject,
  onOpenChat,
  onPatch,
  onDeleteChat,
  streamingChats,
}: ProjectViewProps): JSX.Element {
  const [panel, setPanel] = useState<'instructions' | 'memory' | null>(null);
  const [tab, setTab] = useState<'chats' | 'sources'>('chats');
  const [draft, setDraft] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [addError, setAddError] = useState('');

  const chats = [...project.chats]
    .filter((c) => !c.archived)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  const folderSources = project.files.filter((f) => f.source);
  const uploaded = project.files.filter((f) => !f.source);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onSendFirst(project.id, text);
  };

  return (
    <div className="main">
      <div className="project-layout">
        <div className="project-main">
          <header className="project-head">
            <h1 className="project-title">{project.name}</h1>
            {project.goal && <p className="project-goal">{project.goal}</p>}
          </header>

          <div className="seg project-tabs" role="tablist" aria-label="Project">
            <button role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'is-selected' : ''} onClick={() => setTab('chats')}>
              Chats{chats.length ? ` (${chats.length})` : ''}
            </button>
            <button role="tab" aria-selected={tab === 'sources'} className={tab === 'sources' ? 'is-selected' : ''} onClick={() => setTab('sources')}>
              Sources{project.files.length ? ` (${project.files.length})` : ''}
            </button>
          </div>

          {tab === 'chats' ? (
            <div className="project-scroll">
              {chats.length === 0 ? (
                <p className="rail-empty">No chats yet — start one below.</p>
              ) : (
                <ul className="chat-index">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <button className="chat-index-row" onClick={() => onOpenChat(project.id, c.id)}>
                        <span className="chat-index-main">
                          <span className="chat-index-title">
                            {streamingChats[c.id] && <span className="chat-working" aria-label="Still generating"><i /><i /><i /></span>}
                            {c.pinned && <span aria-label="Pinned">📌 </span>}
                            {c.title || 'New task'}
                          </span>
                          {/* The title is the first message, so until a second
                              one arrives the preview repeats it verbatim. */}
                          {c.preview && c.preview.trim() !== (c.title || '').trim() && (
                            <span className="chat-index-preview">{c.preview}</span>
                          )}
                        </span>
                        <span className="chat-index-time">{timeAgo(c.updatedAt)}</span>
                      </button>
                      <button
                        className="recents-del"
                        title="Delete chat"
                        aria-label={`Delete ${c.title || 'chat'}`}
                        onClick={() => onDeleteChat(project.id, c.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="project-scroll">
              <p className="rail-empty">
                Every chat in this project reads these as reference material.
              </p>

              <div className="rail-label">Attached folders</div>
              {(project.sourceFolders || []).length === 0 ? (
                <p className="rail-empty">No folders attached. Attach one in Edit project to keep sources in step with storage.</p>
              ) : (
                <ul className="source-list">
                  {(project.sourceFolders || []).map((f) => (
                    <li key={f}><span className="source-name">📁 {f}</span></li>
                  ))}
                </ul>
              )}

              <div className="rail-label">Files</div>
              {project.files.length === 0 ? (
                <p className="rail-empty">Nothing attached yet.</p>
              ) : (
                <ul className="source-list">
                  {folderSources.concat(uploaded).map((f) => (
                    <li key={f.name}>
                      <span className="source-name">{f.source ? '📁' : '📄'} {f.name}</span>
                      {f.source ? (
                        <span className="source-size">from folder</span>
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => onPatch(project.id, { files: project.files.filter((x) => !x.source && x.name !== f.name) })}
                          aria-label={`Remove ${f.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="source-actions">
                <label className="btn btn-secondary btn-sm">
                  Add files
                  <input
                    type="file"
                    multiple
                    accept={TEXT_EXTENSIONS.join(',')}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const list = e.target.files;
                      if (!list) return;
                      void readTextSources(Array.from(list)).then(({ accepted, rejected }) => {
                        setAddError(rejected.length ? `Not added — ${describeRejection(rejected)}. A source is read as text.` : '');
                        if (!accepted.length) return;
                        // One patch for the whole selection: patching per file
                        // rebuilt the list from the same stale array each time.
                        const next = [...project.files.filter((f) => !f.source)];
                        for (const a of accepted) next.push({ name: uniqueName(a.name, next), content: a.content });
                        onPatch(project.id, { files: next });
                      });
                      e.target.value = '';
                    }}
                  />
                </label>
                <button className="btn btn-secondary btn-sm" onClick={() => setBrowsing(true)}>Add from storage</button>
                <button className="btn btn-secondary btn-sm" onClick={() => onEditProject(project.id)}>Manage folders</button>
              </div>
              {addError && <p className="modal-err source-add-error">{addError}</p>}
            </div>
          )}

          {/* Starting a chat from the project page is the point of being here,
              so the composer is present rather than a button that empties into
              a blank chat. */}
          <div className="project-composer">
            <div className="composer-inner">
              <textarea
                className="composer-input"
                rows={1}
                aria-label={`Message ${project.name}`}
                placeholder={`Message ${project.name}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="send-btn" onClick={send} disabled={!draft.trim()} title="Send" aria-label="Send">
                <SendIcon />
              </button>
            </div>
            <button className="project-newchat" onClick={() => onNewChat(project.id)}>
              or open an empty chat in {project.name}
            </button>
          </div>
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

          <RailRow label="Sources" hint={`${project.files.length}`} onClick={() => setTab('sources')} />

          <p className="rail-empty" style={{ marginTop: 10 }}>
            Instructions, sources, and memory ride along with every chat in this project.
          </p>
        </div>
      </div>

      {browsing && (
        <StorageFileBrowser
          onClose={() => setBrowsing(false)}
          onPick={(picked) => {
            const next = [...project.files];
            for (const f of picked) {
              const i = next.findIndex((x) => x.name === f.name);
              if (i >= 0) next[i] = { ...next[i], content: f.content };
              else next.push({ name: uniqueName(f.name, next), content: f.content });
            }
            onPatch(project.id, { files: next });
            setBrowsing(false);
          }}
        />
      )}
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
