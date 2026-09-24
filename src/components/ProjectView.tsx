import { InstructionSkills } from './InstructionSkills';
import { ReasoningControl } from './ReasoningControl';
import { ComposerActions } from './ComposerActions';
import { ComposerModel } from './ComposerModel';
import { ComposerTextarea } from './ComposerTextarea';
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
import { fileToBase64, uploadLimit } from '../sources';
import { filesAfterRemoval } from '../project-files';
import { deleteProjectImage, projectImageUrl, uploadProjectFile, deleteProjectFile } from '../api';
import { ResearchPanel } from './research/ResearchPanel';
import { useResearchAccess } from './research/useResearchAccess';
import { CodePanel } from './code/CodePanel';
import { useCodeAccess } from './code/useCodeAccess';
import { BrowserPanel } from './browser/BrowserPanel';
import { useBrowserAccess } from './browser/useBrowserAccess';
import { EmptyState } from './EmptyState';

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
  onEdit: () => void;
  modelLabel: string;
}

/** Documents noevia itself produced in this project. Only deep-research
 *  reports are generated today; the `.sources.json` sidecar rides along with
 *  its report rather than listing as an output of its own. */
function outputsOf(project: Project): { name: string; base: string; date: string; sources?: string }[] {
  const names = new Set(project.files.map((f) => f.name));
  return project.files
    .filter((f) => /^Research \d{4}-\d{2}-\d{2} .+\.md$/.test(f.name.split('/').pop() || ''))
    .map((f) => {
      const base = (f.name.split('/').pop() || f.name).replace(/\.md$/, '');
      const sidecar = f.name.replace(/\.md$/, '.sources.json');
      return { name: f.name, base, date: base.slice(9, 19), sources: names.has(sidecar) ? sidecar : undefined };
    })
    .sort((a, b) => b.base.localeCompare(a.base));
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
  onEdit,
  modelLabel,
}: ProjectViewProps): JSX.Element {
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerStatus, setComposerStatus] = useState('');
  const [panel, setPanel] = useState<'instructions' | 'memory' | 'context' | null>(null);
  const [tab, setTab] = useState<'chats' | 'sources' | 'research' | 'code' | 'browser'>('chats');
  const researchAccess = useResearchAccess(project.id);
  const codeAccess = useCodeAccess(project.id);
  const browserAccess = useBrowserAccess(project.id);
  useEffect(() => { if (tab === 'research' && !researchAccess) setTab('chats'); }, [tab, researchAccess]);
  useEffect(() => { if (tab === 'code' && !codeAccess) setTab('chats'); }, [tab, codeAccess]);
  useEffect(() => { if (tab === 'browser' && !browserAccess) setTab('chats'); }, [tab, browserAccess]);
  const [draft, setDraft] = useState('');
  const [skillFiles, setSkillFiles] = useState<string[]>([]);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [addError, setAddError] = useState('');
  const [busyDocs, setBusyDocs] = useState(false);
  const [uploadRows, setUploadRows] = useState<{ name: string; stage: string; percent?: number; started: number; finished?: number }[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!busyDocs) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [busyDocs]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmImageDelete, setConfirmImageDelete] = useState<string | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list || busyDocs) return;
    const files = Array.from(list);
    setAddError(''); setBusyDocs(true);
    setUploadRows(files.map(f => ({ name: f.name, stage: 'Queued', started: Date.now() })));
    const update = (i: number, value: { stage: string; percent?: number; finished?: number }) => setUploadRows(rows => rows.map((r, n) => n === i ? { ...r, percent: undefined, ...value } : r));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.size > uploadLimit(file.name)) throw new Error('File exceeds the limit: 25 MB, or 60 MB for PDF reduction');
        update(i, { stage: 'Reading file' });
        const result = await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) }, value => update(i, value));
        update(i, { stage: result.attachment?.reduction?.note || 'Saved', percent: 100, finished: Date.now() });
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

  const sourceCount = project.files.length + (project.assets || []).filter((a) => !a.sourceName).length;
  const linkedFolders = (project.sourceFolders || []).filter((f) => f !== project.projectFolder);
  const outputs = outputsOf(project);
  const chatEnabled = !project.modes?.length || project.modes.includes('chat');
  const send = () => {
    const text = draft.trim();
    if (!chatEnabled || !text || composerBusy || busyDocs || syncing) return;
    setDraft('');
    onSendFirst(project.id, text);
  };

  return (
    <div className="main project-page">
      <div className="project-layout">
        <div className="project-main">
          <header className="project-head">
            <div className="project-head-main">
              <h1 className="project-title"><ProjectIcon project={project} size={30}/>{project.name}</h1>
              {project.goal && <p className="project-goal">{project.goal}</p>}
            </div>
            <div className="project-head-actions">
              {chatEnabled && <button className="btn btn-secondary btn-sm" onClick={() => onNewChat(project.id)}>New chat</button>}
              <button className="btn btn-secondary btn-sm" onClick={onEdit}>Project settings</button>
            </div>
          </header>

          <div className="seg project-tabs" role="tablist" aria-label="Project">
            <button role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'is-selected' : ''} onClick={() => setTab('chats')}>
              Chats{chats.length ? ` (${chats.length})` : ''}
            </button>
            <button role="tab" aria-selected={tab === 'sources'} className={tab === 'sources' ? 'is-selected' : ''} onClick={() => setTab('sources')}>
              Sources{project.files.length + (project.assets || []).filter(a => !a.sourceName).length ? ` (${project.files.length + (project.assets || []).filter(a => !a.sourceName).length})` : ''}
            </button>
            {researchAccess && <button role="tab" aria-selected={tab === 'research'} className={tab === 'research' ? 'is-selected' : ''} onClick={() => setTab('research')}>
              Research
            </button>}
            {codeAccess && <button role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'is-selected' : ''} onClick={() => setTab('code')}>
              Code
            </button>}
            {browserAccess && <button role="tab" aria-selected={tab === 'browser'} className={tab === 'browser' ? 'is-selected' : ''} onClick={() => setTab('browser')}>
              Browser
            </button>}
          </div>

          {tab === 'code' && codeAccess ? (
            <div className="project-scroll"><CodePanel projectId={project.id}/></div>
          ) : tab === 'browser' && browserAccess ? (
            <div className="project-scroll"><BrowserPanel projectId={project.id}/></div>
          ) : tab === 'research' && researchAccess ? (
            <div className="project-scroll"><ResearchPanel key={project.id} projectId={project.id} onSaved={onRefresh}/></div>
          ) : tab === 'chats' ? (
            <div className="project-scroll">
              {/* Outputs are documents noevia made here, not files you uploaded,
                  so they sit above the chats rather than among the sources. */}
              {outputs.length > 0 && (
                <section className="project-outputs" aria-label="Outputs">
                  <h2 className="rail-label">Outputs ({outputs.length})</h2>
                  <ul className="output-row">
                    {outputs.slice(0, 8).map((o) => (
                      <li key={o.name}>
                        <a className="output-card surface" href={`/api/projects/${encodeURIComponent(project.id)}/documents/original?name=${encodeURIComponent(o.name)}`} download>
                          <ShellIcon name="file"/>
                          <span className="output-name">{o.base.slice(20) || o.base}</span>
                          <span className="output-meta">Research report · {o.date}</span>
                        </a>
                        {o.sources && (
                          <a className="output-sources" href={`/api/projects/${encodeURIComponent(project.id)}/documents/original?name=${encodeURIComponent(o.sources)}`} download>Sources</a>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {chats.length > 0 && <h2 className="rail-label">Recent chats</h2>}
              {chats.length === 0 ? (
                <EmptyState icon="chat" title="No chats yet">Ask something below to start the first chat in {project.name}. Its instructions and sources come along.</EmptyState>
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
                        <ShellIcon name="close" size={16}/>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="project-scroll project-sources">
              <InstructionSkills key={project.id} projectId={project.id} updatedAt={project.updatedAt} onRefresh={onRefresh} onFiles={setSkillFiles} />
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
                <p className="source-status">Linked folders refresh when you return and about every five minutes while this project is open. Refresh pauses during chat generation, while offline, or when this tab is hidden.</p>
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
              <p className="rail-empty">Up to 25 MB per file. PDFs up to 60 MB are compressed automatically, with a text-only fallback if needed. Documents such as DOCX are accepted; archive bundles are not. Files without a reader stay available as originals.</p>
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
                    // Deletable mirrors the server's ownsFile: a file sitting directly in an
                    // attached folder (its own or a linked one) may be deleted from storage.
                    // A synced file that does NOT meet that bar (e.g. reached through a nested
                    // sub-path) can never be detached here either — the config-patch endpoint
                    // rebuilds every synced entry from the project's own record regardless of
                    // what a patch sends, so there is nothing "Remove" could do for it.
                    const deletable = !!f.source && (!!f.attachment || (project.sourceFolders || []).some(d => f.name.startsWith(d + '/') && !f.name.slice(d.length + 1).includes('/')));
                    const undeletableSynced = !!f.source && !deletable;
                    return <li key={f.name}>
                      {f.attachment?.assetId && <img className="source-thumbnail" src={projectImageUrl(project.id, f.attachment.assetId)} alt="" />}
                      <span className="source-name" title={f.name}><ShellIcon name="file"/><span>{f.name.split('/').pop()}
                        <small className="source-status">{skillFiles.includes(f.name) ? 'Instruction skill · review and enable above' : f.document ? sourceStatus(f) : f.attachment?.state === 'stored' ? (f.attachment.reason || 'Original stored · reader not available yet') : f.attachment?.state === 'vision' ? 'Uploaded · image read when you send a message' : f.attachment?.state === 'partial' ? (f.attachment.reason || 'Text preview limited · original kept') : 'Text ready'}</small>
                        <small className="source-status">{f.source ? f.name : 'Stored in noevia'}{f.attachment ? ` · ${(f.attachment.bytes / 1024 / 1024).toFixed(2)} MB` : ''}</small>
                        {undeletableSynced && <small className="source-status">Synced from {f.source}; remove it in storage.</small>}
                      </span></span>
                      {(f.attachment || f.document?.byteHash) && <a className="btn btn-ghost btn-sm" href={`/api/projects/${encodeURIComponent(project.id)}/${f.attachment ? 'uploads' : 'documents'}/original?name=${encodeURIComponent(f.name)}`} download>Original</a>}
                      {!undeletableSynced && <button className="btn btn-ghost btn-sm" aria-label={`${deletable ? 'Delete' : 'Remove'} ${f.name}`} onClick={() => deletable ? setConfirmDelete(f.name) : onPatch(project.id, { files: filesAfterRemoval(project.files, f.name) })}>{deletable ? 'Delete' : 'Remove'}</button>}
                    </li>;
                  })}
                  {legacyImages.map(a => <li key={a.id}><img className="source-thumbnail" src={projectImageUrl(project.id, a.id)} alt=""/><span className="source-name"><span>{a.name}<small className="source-status">Earlier upload · stored in noevia. Refresh to copy to connected storage.</small></span></span><button className="btn btn-ghost btn-sm" onClick={() => setConfirmImageDelete(a.id)}>Remove</button></li>)}
                  </ul>
                </section>;
              })}
              {addError && <p className="modal-err source-add-error">{addError}</p>}
            </div>
          )}

          {/* Starting a chat from the project page is the point of being here,
              so the composer is present rather than a button that empties into
              a blank chat. */}
          {!chatEnabled && <p className="route-note" role="status">This project is not enabled for Chat. Turn Chat on under Project settings → Available in to send messages here.</p>}
          {/* Research and Code each have their own way to start something; a chat composer
              under them is a second, unrelated send button taking half the height. */}
          <div className="project-composer" hidden={!chatEnabled || tab === 'research' || tab === 'code' || tab === 'browser'}>
            {/* What rides along with the next message, stated before it is sent
                rather than discovered afterwards. Each chip opens what it counts. */}
            <ul className="composer-context-chips" aria-label="Context sent with every message in this project">
              <li>
                <button type="button" className="chip" onClick={() => setPanel(panel === 'instructions' ? null : 'instructions')}>
                  Instructions{project.instructions ? '' : ' · none yet'}
                </button>
              </li>
              <li>
                <button type="button" className="chip" onClick={() => setPanel(panel === 'memory' ? null : 'memory')}>
                  Memory · {project.memories.length}
                </button>
              </li>
              <li>
                <button type="button" className="chip" onClick={() => setTab('sources')}>
                  Sources · {sourceCount}
                </button>
              </li>
              {linkedFolders.length > 0 && (
                <li>
                  <button type="button" className="chip" onClick={() => setTab('sources')}>
                    Linked folders · {linkedFolders.length}
                  </button>
                </li>
              )}
            </ul>
            <div className="composer-inner chat-composer-inner pane">
              <ComposerTextarea
                rows={1}
                aria-label={`Message ${project.name}`}
                placeholder={`Message ${project.name}`}
                value={draft}
                onValue={setDraft}
                onSubmit={send}
              />
              <ComposerActions key={project.id} project={project} disabled={composerBusy || busyDocs || syncing} onChanged={onRefresh} onModels={onOpenModels} onBusy={setComposerBusy} onStatus={setComposerStatus} />
              <ComposerModel label={modelLabel} onClick={onOpenModels} />
          <ReasoningControl project={project} disabled={composerBusy || busyDocs || syncing} onChanged={onRefresh} />
              <button className="send-btn glass glass-lens is-primary is-press" onClick={send} disabled={!draft.trim() || composerBusy || busyDocs || syncing} title="Send" aria-label="Send">
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

          <RailRow label="Sources" hint={`${sourceCount}`} onClick={() => setTab('sources')} />

          <RailRow
            label="Context"
            hint={panel === 'context' ? 'Hide' : 'Show'}
            onClick={() => setPanel(panel === 'context' ? null : 'context')}
          />
          {panel === 'context' && (
            <div className="rail-context">
              <p><span>Model</span><span>{modelLabel}</span></p>
              <p><span>Thinking</span><span>{project.reasoningEffort && project.reasoningEffort !== 'default' ? project.reasoningEffort : 'Default'}</span></p>
              <p><span>Toolboxes</span><span>{(project.toolboxes || ['core']).join(', ')}</span></p>
              <p><span>Upload folder</span><span>{project.projectFolder || 'Created on first upload'}</span></p>
              <p><span>Linked folders</span><span>{linkedFolders.length}</span></p>
              <p><span>Outputs</span><span>{outputs.length}</span></p>
            </div>
          )}

          {/* Listed because the sample's project screen has it; it does nothing
              yet, and says so rather than pretending. */}
          <div className="rail-row-btn is-unavailable" aria-disabled="true">
            <span className="rail-row-label">Scheduled</span>
            <span className="rail-row-hint">Not yet available</span>
          </div>

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
      {confirmImageDelete && (
        <ConfirmDialog
          title="Remove this image?"
          body="This deletes the earlier upload from noevia's own storage. This cannot be undone."
          confirmLabel="Remove image"
          danger
          onCancel={() => setConfirmImageDelete(null)}
          onConfirm={() => {
            const assetId = confirmImageDelete;
            setConfirmImageDelete(null);
            void deleteProjectImage(project.id, assetId)
              .then(onRefresh)
              .catch((e: unknown) => setAddError(e instanceof Error ? e.message : 'Could not remove that image'));
          }}
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
