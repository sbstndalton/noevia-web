import { ReasoningControl } from './ReasoningControl';
import { ComposerActions } from './ComposerActions';
import { ComposerModel } from './ComposerModel';
import { sourceStatus } from '../source-status';
import { FolderPicker } from './FolderPicker';
import { ShellIcon } from './ShellIcon';
import { ProjectIcon } from './ProjectIdentity';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Project } from '../types';
import { SendIcon } from './Icons';
import { StorageFileBrowser } from './StorageFileBrowser';
import { ConfirmDialog } from './ContextMenu';
import { fileToBase64, MAX_DOCUMENT_BYTES } from '../sources';
import { deleteProjectImage, projectImageUrl, uploadProjectFile, deleteProjectFile } from '../api';

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
  onSave: (projectId: string, patch: Partial<Project>) => Promise<void>;
  onOpenChat: (projectId: string, chatId: string) => void;
  onPatch: (projectId: string, patch: Partial<Project>) => void;
  onDeleteChat: (projectId: string, chatId: string) => void;
  streamingChats: Record<string, true>;
  onRefresh: () => void | Promise<void>;
  onOpenModels: () => void;
  modelLabel: string;
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
  onSave,
  onOpenChat,
  onPatch,
  onDeleteChat,
  streamingChats,
  onRefresh,
  onOpenModels,
  modelLabel,
}: ProjectViewProps): JSX.Element {
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerStatus, setComposerStatus] = useState('');
  const [panel, setPanel] = useState<'instructions' | 'memory' | null>(null);
  const [tab, setTab] = useState<'chats' | 'sources'>('chats');
  const [draft, setDraft] = useState('');
  const [pickingFolder, setPickingFolder] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [addError, setAddError] = useState('');
  const [busyDocs, setBusyDocs] = useState(false);
  const [uploadRows, setUploadRows] = useState<{ name: string; stage: string; percent?: number; started: number; finished?: number }[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!busyDocs) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [busyDocs]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list || busyDocs) return;
    const files = Array.from(list);
    setAddError(''); setBusyDocs(true);
    setUploadRows(files.map(f => ({ name: f.name, stage: 'Queued', started: Date.now() })));
    const update = (i: number, value: { stage: string; percent?: number; finished?: number }) => setUploadRows(rows => rows.map((r, n) => n === i ? { ...r, percent: undefined, ...value } : r));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Over the 25 MB limit');
        update(i, { stage: 'Reading file' });
        await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) }, value => update(i, value));
        update(i, { stage: 'Saved', percent: 100, finished: Date.now() });
        onRefresh();
      } catch (err) { update(i, { stage: err instanceof Error ? err.message : 'Upload failed', finished: Date.now() }); }
    }
    setBusyDocs(false);
  };

  const updateFolders = async (folders: string[]) => {
    setSyncing(true);
    setAddError('');
    try { await onSave(project.id, {sourceFolders: folders}); }
    catch (e) { setAddError(e instanceof Error ? e.message : 'Could not update linked folders.'); }
    finally { setSyncing(false); }
  };

  const removeFile = async (path: string) => {
    try {
      await deleteProjectFile(project.id, path);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not delete that file');
    }
    onRefresh();
  };

  const chats = [...project.chats]
    .filter((c) => !c.archived)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  const groups = ['Documents', 'Images', 'Text', 'Other'];
  const fileGroup = (f: Project['files'][number]) => f.attachment?.group || (f.document ? 'Documents' : 'Text');

  const send = () => {
    const text = draft.trim();
    if (!text || composerBusy || busyDocs || syncing) return;
    setDraft('');
    onSendFirst(project.id, text);
  };

  return (
    <div className="main">
      <div className="project-layout">
        <div className="project-main">
          <header className="project-head">
            <h1 className="project-title"><ProjectIcon project={project} size={30}/>{project.name}</h1>
            {project.goal && <p className="project-goal">{project.goal}</p>}
          </header>

          <div className="seg project-tabs" role="tablist" aria-label="Project">
            <button role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'is-selected' : ''} onClick={() => setTab('chats')}>
              Chats{chats.length ? ` (${chats.length})` : ''}
            </button>
            <button role="tab" aria-selected={tab === 'sources'} className={tab === 'sources' ? 'is-selected' : ''} onClick={() => setTab('sources')}>
              Sources{project.files.length + (project.assets || []).filter(a => !a.sourceName).length ? ` (${project.files.length + (project.assets || []).filter(a => !a.sourceName).length})` : ''}
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
            <div className="project-scroll project-sources">
              <p className="rail-empty">
                Reference files and images available to chats in this project.
              </p>

              <section className="project-storage-summary">
                <h3>Upload folder</h3>
                <p className="rail-empty">Files are saved under this upload folder in Documents, Images, Text, or Other. Without connected storage, noevia keeps the originals.</p>
                {project.projectFolder ? <p className="storage-path"><ShellIcon name="folder"/><span>{project.projectFolder}</span></p>
                  : <p className="rail-empty">A folder is created on your first upload when storage is connected.</p>}
              </section>
              <details className="project-linked-folders">
                <summary>Linked reference folders ({(project.sourceFolders || []).filter(f=>f!==project.projectFolder).length})</summary>
                <p className="rail-empty">Read files from other storage folders without moving them. Refresh to pick up changes; unlinking keeps the original files.</p>
                <ul className="source-list">{(project.sourceFolders || []).filter(f=>f!==project.projectFolder).map(f=><li key={f}>
                  <span className="source-name" title={f}><ShellIcon name="folder"/> {f}</span>
                  <button className="btn btn-ghost btn-sm" disabled={syncing} onClick={()=>void updateFolders((project.sourceFolders || []).filter(x=>x!==f))} aria-label={`Unlink ${f}`}>Unlink</button>
                </li>)}</ul>
                <button className="btn btn-secondary btn-sm" disabled={syncing} onClick={()=>setPickingFolder(true)}>Link folder</button>
              </details>
              <div className="source-actions">
                <button className="btn btn-secondary btn-sm" disabled={syncing || busyDocs} onClick={()=>void updateFolders(project.sourceFolders || [])}>{syncing ? 'Refreshing…' : 'Refresh from storage'}</button>
              </div>

              <div className="source-actions">
                <label className={`btn btn-secondary btn-sm${busyDocs ? ' is-busy' : ''}`}>
                  {busyDocs ? 'Uploading files…' : 'Upload files'}
                  <input type="file" multiple disabled={busyDocs} style={{ display: 'none' }} onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />
                </label>
                <button className="btn btn-secondary btn-sm" onClick={() => setBrowsing(true)}>Import text from storage</button>
              </div>
              <p className="rail-empty">Up to 25 MB per file. Documents such as DOCX are accepted; archive bundles are not. Files without a reader stay available as originals.</p>
              {uploadRows.length > 0 && <details open={busyDocs}><summary>{busyDocs ? 'Uploading files…' : `Upload results (${uploadRows.length})${uploadRows.some(r => r.stage !== 'Saved') ? ' · some files were not added' : ' · saved'}`}</summary><ul className="source-list upload-progress" aria-label="Upload progress" aria-live="polite">{uploadRows.map((r, i) => <li key={i}>
                <span><strong>{r.name}</strong><small className="source-status">{r.stage}{r.percent !== undefined ? ` · ${r.percent}%` : ''} · {Math.max(0, Math.round(((r.finished || now) - r.started) / 1000))}s</small></span>
              </li>)}</ul></details>}
              {groups.map(group => {
                const files = project.files.filter(f => fileGroup(f) === group);
                const legacyImages = group === 'Images' ? (project.assets || []).filter(a => !a.sourceName) : [];
                if (!files.length && !legacyImages.length) return null;
                return <section key={group} aria-label={group}>
                  <h3 className="rail-label">{group} ({files.length + legacyImages.length})</h3>
                  <ul className="source-list">{files.map(f => {
                    const deletable = !!f.source && (!!f.attachment || (project.sourceFolders || []).some(d => f.name.startsWith(d + '/') && !f.name.slice(d.length + 1).includes('/')));
                    return <li key={f.name}>
                      {f.attachment?.assetId && <img className="source-thumbnail" src={projectImageUrl(project.id, f.attachment.assetId)} alt="" />}
                      <span className="source-name" title={f.name}><ShellIcon name="file"/><span>{f.name.split('/').pop()}
                        <small className="source-status">{f.document ? sourceStatus(f) : f.attachment?.state === 'stored' ? (f.attachment.reason || 'Original stored · reader not available yet') : f.attachment?.state === 'vision' ? 'Uploaded · image read when you send a message' : f.attachment?.state === 'partial' ? (f.attachment.reason || 'Text preview limited · original kept') : 'Text ready'}</small>
                        <small className="source-status">{f.source ? f.name : 'Stored in noevia'}{f.attachment ? ` · ${(f.attachment.bytes / 1024 / 1024).toFixed(2)} MB` : ''}</small>
                      </span></span>
                      {(f.attachment || f.document?.byteHash) && <a className="btn btn-ghost btn-sm" href={`/api/projects/${encodeURIComponent(project.id)}/${f.attachment ? 'uploads' : 'documents'}/original?name=${encodeURIComponent(f.name)}`} download>Original</a>}
                      <button className="btn btn-ghost btn-sm" aria-label={`${deletable ? 'Delete' : 'Remove'} ${f.name}`} onClick={() => deletable ? setConfirmDelete(f.name) : onPatch(project.id, { files: project.files.filter(x => !x.source && x.name !== f.name) })}>{deletable ? 'Delete' : 'Remove'}</button>
                    </li>;
                  })}
                  {legacyImages.map(a => <li key={a.id}><img className="source-thumbnail" src={projectImageUrl(project.id, a.id)} alt=""/><span className="source-name"><span>{a.name}<small className="source-status">Earlier upload · stored in noevia. Refresh to copy to connected storage.</small></span></span><button className="btn btn-ghost btn-sm" onClick={() => void deleteProjectImage(project.id, a.id).then(onRefresh)}>Remove</button></li>)}
                  </ul>
                </section>;
              })}
              {addError && <p className="modal-err source-add-error">{addError}</p>}
            </div>
          )}

          {/* Starting a chat from the project page is the point of being here,
              so the composer is present rather than a button that empties into
              a blank chat. */}
          <div className="project-composer">
            <div className="composer-inner chat-composer-inner">
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
              <ComposerActions key={project.id} project={project} disabled={composerBusy || busyDocs || syncing} onChanged={onRefresh} onModels={onOpenModels} onBusy={setComposerBusy} onStatus={setComposerStatus} />
              <ComposerModel label={modelLabel} onClick={onOpenModels} />
          <ReasoningControl project={project} disabled={composerBusy || busyDocs || syncing} onChanged={onRefresh} />
              <button className="send-btn" onClick={send} disabled={!draft.trim() || composerBusy || busyDocs || syncing} title="Send" aria-label="Send">
                <SendIcon />
              </button>
            </div>
            {composerStatus && <div className="composer-action-status" role="status">{composerStatus}</div>}
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

          <RailRow label="Sources" hint={`${project.files.length + (project.assets || []).filter(a => !a.sourceName).length}`} onClick={() => setTab('sources')} />

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
      {pickingFolder && <FolderPicker onClose={()=>setPickingFolder(false)} onPick={path=>{setPickingFolder(false);void updateFolders([...new Set([...(project.sourceFolders || []),path])]);}}/>}
      {browsing && (
        <StorageFileBrowser
          onClose={() => setBrowsing(false)}
          onPick={(picked) => {
            const next = project.files.filter(f=>!f.source);
            for (const f of picked) {
              next.push({ name: uniqueName(f.name, [...project.files,...next]), content: f.content });
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
