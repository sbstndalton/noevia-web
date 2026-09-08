import { useState } from 'react';
import type { JSX } from 'react';
import type { Project } from '../types';
import { SendIcon } from './Icons';
import { StorageFileBrowser } from './StorageFileBrowser';
import { ConfirmDialog } from './ContextMenu';
import { TEXT_EXTENSIONS, IMAGE_MIME, MAX_IMAGE_BYTES, fileToBase64, DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES, isDocumentFile, isTextFile } from '../sources';
import { uploadProjectImage, deleteProjectImage, projectImageUrl, uploadProjectFile, deleteProjectFile, syncProjectSources } from '../api';

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
  onRefresh: () => void;
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
  onRefresh,
}: ProjectViewProps): JSX.Element {
  const [panel, setPanel] = useState<'instructions' | 'memory' | null>(null);
  const [tab, setTab] = useState<'chats' | 'sources'>('chats');
  const [draft, setDraft] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [addError, setAddError] = useState('');
  const [busyImages, setBusyImages] = useState(false);
  const [busyDocs, setBusyDocs] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Text files and PDFs both go into the project's own storage folder; the
  // sync that follows turns them into sources. One path, whether the file came
  // from this machine or was dropped into the folder from elsewhere.
  const addFiles = async (list: FileList | null) => {
    if (!list || busyDocs) return;
    setAddError('');
    setBusyDocs(true);
    const failed: string[] = [];
    const done: string[] = [];
    for (const file of Array.from(list)) {
      const ok = isTextFile(file.name) || isDocumentFile(file.name);
      if (!ok) { failed.push(`${file.name} (not a text file or PDF)`); continue; }
      if (file.size > MAX_DOCUMENT_BYTES) { failed.push(`${file.name} (over the 25 MB limit)`); continue; }
      try {
        await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) });
        done.push(file.name);
      } catch (e) {
        failed.push(`${file.name} (${e instanceof Error ? e.message : 'upload failed'})`);
      }
    }
    if (done.length) {
      try {
        const synced = await syncProjectSources(project.id);
        if (synced.skipped.length) failed.push(`source refresh: ${synced.skipped[0].reason}`);
      } catch (e) { failed.push(`source refresh: ${e instanceof Error ? e.message : 'failed'}`); }
    }
    setBusyDocs(false);
    setAddError([
      failed.length ? `Not added — ${failed.join(', ')}.` : '',
      done.length ? `Uploaded ${done.join(', ')}.` : '',
    ].filter(Boolean).join(' '));
    onRefresh();
  };

  const removeFile = async (path: string) => {
    try {
      await deleteProjectFile(project.id, path);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not delete that file');
    }
    onRefresh();
  };

  const addImages = async (list: FileList | null) => {
    if (!list) return;
    setAddError('');
    setBusyImages(true);
    const failed: string[] = [];
    for (const file of Array.from(list)) {
      if (!IMAGE_MIME.includes(file.type.toLowerCase())) { failed.push(`${file.name} (not an image)`); continue; }
      if (file.size > MAX_IMAGE_BYTES) { failed.push(`${file.name} (${Math.round(file.size / 1024 / 1024)} MB, over the 8 MB limit)`); continue; }
      try {
        await uploadProjectImage(project.id, { name: file.name, mime: file.type.toLowerCase(), dataBase64: await fileToBase64(file) });
      } catch (e) {
        failed.push(`${file.name} (${e instanceof Error ? e.message : 'upload failed'})`);
      }
    }
    setBusyImages(false);
    setAddError(failed.length ? `Not added — ${failed.join(', ')}.` : '');
    onRefresh();
  };

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

              <div className="rail-label">Images</div>
              {(project.assets || []).length === 0 ? (
                <p className="rail-empty">No images attached. A model that can see images will be shown them with your message.</p>
              ) : (
                <ul className="image-grid">
                  {(project.assets || []).map((a) => (
                    <li key={a.id}>
                      <img src={projectImageUrl(project.id, a.id)} alt={a.name} loading="lazy" />
                      <span className="image-name" title={a.name}>{a.name}</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void deleteProjectImage(project.id, a.id).then(onRefresh).catch(() => undefined)}
                        aria-label={`Remove ${a.name}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="source-actions">
                <label className={`btn btn-secondary btn-sm${busyImages ? ' is-busy' : ''}`}>
                  {busyImages ? 'Uploading…' : 'Add images'}
                  <input
                    type="file"
                    multiple
                    accept={IMAGE_MIME.join(',')}
                    style={{ display: 'none' }}
                    onChange={(e) => { void addImages(e.target.files); e.target.value = ''; }}
                  />
                </label>
              </div>

              <div className="rail-label">Files</div>
              {project.projectFolder && (
                <p className="rail-empty">
                  Uploads are saved to <code>{project.projectFolder}</code> in your storage, so you can open,
                  edit or back them up like any other folder. Text files and PDFs both work.
                </p>
              )}
              {project.files.length === 0 ? (
                <p className="rail-empty">Nothing attached yet.</p>
              ) : (
                <ul className="source-list">
                  {folderSources.concat(uploaded).map((f) => {
                    // Deletable when it lives directly in a folder this
                    // project has attached — its own or one you attached for
                    // reading. Both are your files; the dialog says which path
                    // is going.
                    const folders = [
                      ...(project.projectFolder ? [project.projectFolder] : []),
                      ...(project.sourceFolders || []),
                    ];
                    const deletable = folders.some((d) => {
                      const rel = f.name.startsWith(`${d}/`) ? f.name.slice(d.length + 1) : null;
                      return !!rel && !rel.includes('/');
                    });
                    return (
                      <li key={f.name}>
                        <span className="source-name" title={f.name}>
                          {f.source ? '📁' : '📄'} {f.name.split('/').pop()}
                        </span>
                        {deletable ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setConfirmDelete(f.name)}
                            aria-label={`Delete ${f.name}`}
                          >
                            Delete
                          </button>
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
                    );
                  })}
                </ul>
              )}
              <div className="source-actions">
                <label className={`btn btn-secondary btn-sm${busyDocs ? ' is-busy' : ''}`}>
                  {busyDocs ? 'Uploading…' : 'Add files'}
                  <input
                    type="file"
                    multiple
                    disabled={busyDocs}
                    accept={[...TEXT_EXTENSIONS, ...DOCUMENT_EXTENSIONS].join(',')}
                    style={{ display: 'none' }}
                    onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
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

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.split('/').pop()}?`}
          body={`This deletes the file from your storage at ${confirmDelete}, not just from this project. If that folder is shared or synced, it goes everywhere. This cannot be undone.`}
          confirmLabel="Delete file"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { const path = confirmDelete; setConfirmDelete(null); void removeFile(path); }}
        />
      )}
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
