import { InstructionSkills } from './InstructionSkills';
import { ReasoningControl } from './ReasoningControl';
import { ComposerActions } from './ComposerActions';
import { ComposerModel } from './ComposerModel';
import { ComposerTextarea } from './ComposerTextarea';
import { sourceStatus } from '../source-status';
import { ShellIcon } from './ShellIcon';
import { ProjectIcon } from './ProjectIdentity';
import { useEffect, useRef, useState } from 'react';
import type { ProjectTab } from '../routes';
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
import { useT } from '../i18n';
import type { Translate } from '../i18n';

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
  codeRequest?: string;
  /** The tab the address bar names (#359): applied on open and on Back/Forward. A gated tab
   *  (research, code, browser) waits until this account's access to it is confirmed. */
  requestedTab?: ProjectTab;
  /** Every tab change, so the address bar follows. `replace` marks one the view made itself (an
   *  access fallback, a code request, the tab it opened on) rather than one the person chose. */
  onTabChange?: (tab: ProjectTab, opts: { replace: boolean }) => void;
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

function timeAgo(t: Translate, ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return t('projects.timeAgo.justNow');
  if (mins < 60) return t.plural('projects.timeAgo.minutes', mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.plural('projects.timeAgo.hours', hours);
  const days = Math.floor(hours / 24);
  if (days === 1) return t('projects.timeAgo.yesterday');
  return t.plural('projects.timeAgo.days', days);
}

export function ProjectView({
  project,
  codeRequest,
  requestedTab,
  onTabChange,
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
  const t = useT();
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerStatus, setComposerStatus] = useState('');
  const [panel, setPanel] = useState<'instructions' | 'memory' | 'context' | null>(null);
  const [tab, setTab] = useState<ProjectTab>(() => (requestedTab === 'sources' ? 'sources' : 'chats'));
  const researchAccess = useResearchAccess(project.id);
  const codeAccess = useCodeAccess(project.id);
  const browserAccess = useBrowserAccess(project.id);
  // A tab change the view makes on its own is reported as a redirect, not a navigation (#359).
  const autoTab = useRef(true);
  const setTabAuto = (next: ProjectTab) => { autoTab.current = true; setTab(next); };
  // A gated tab named by the address bar, held until its access check answers.
  const wantedTab = useRef<ProjectTab | null>(requestedTab && requestedTab !== 'chats' && requestedTab !== 'sources' ? requestedTab : null);
  const pick = (next: ProjectTab) => { wantedTab.current = null; autoTab.current = false; setTab(next); };
  const allowed = (next: ProjectTab) => next === 'chats' || next === 'sources' || (next === 'research' && researchAccess) || (next === 'code' && codeAccess) || (next === 'browser' && browserAccess);
  const tabNow = useRef(tab);
  tabNow.current = tab;
  useEffect(() => {
    if (!requestedTab || requestedTab === tabNow.current) return;
    if (allowed(requestedTab)) { wantedTab.current = null; setTabAuto(requestedTab); } else wantedTab.current = requestedTab;
    // Access flags are deliberately not deps here: the effect below applies a held tab once they answer.
  }, [requestedTab]);
  useEffect(() => {
    const wanted = wantedTab.current;
    if (wanted && allowed(wanted)) { wantedTab.current = null; setTabAuto(wanted); }
  }, [researchAccess, codeAccess, browserAccess]);
  const reportTab = useRef(onTabChange);
  reportTab.current = onTabChange;
  useEffect(() => { reportTab.current?.(tab, { replace: autoTab.current }); autoTab.current = false; }, [tab]);
  useEffect(() => { if (codeRequest && codeAccess) setTabAuto('code'); }, [codeRequest, codeAccess]);
  useEffect(() => { if (tab === 'research' && !researchAccess) setTabAuto('chats'); }, [tab, researchAccess]);
  useEffect(() => { if (tab === 'code' && !codeAccess) setTabAuto('chats'); }, [tab, codeAccess]);
  useEffect(() => { if (tab === 'browser' && !browserAccess) setTabAuto('chats'); }, [tab, browserAccess]);
  const [draft, setDraft] = useState('');
  const [skillFiles, setSkillFiles] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [addError, setAddError] = useState('');
  const [busyDocs, setBusyDocs] = useState(false);
  const [uploadRows, setUploadRows] = useState<{ name: string; stage: string; percent?: number; started: number; finished?: number }[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!busyDocs) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [busyDocs]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmImageDelete, setConfirmImageDelete] = useState<string | null>(null);
  // #397: this delete is permanent (unlike the sidebar's quick-archive, #362, which is
  // reversible via Archived), so it goes through the same confirm-before-destroy pattern as
  // "Delete file"/"Remove image" above, reusing the sidebar's own delete-chat copy.
  const [confirmDeleteChat, setConfirmDeleteChat] = useState<{ id: string; title: string } | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list || busyDocs) return;
    const files = Array.from(list);
    setAddError(''); setBusyDocs(true);
    setUploadRows(files.map(f => ({ name: f.name, stage: t('projects.view.queued'), started: Date.now() })));
    const update = (i: number, value: { stage: string; percent?: number; finished?: number }) => setUploadRows(rows => rows.map((r, n) => n === i ? { ...r, percent: undefined, ...value } : r));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.size > uploadLimit(file.name)) throw new Error(t('projects.view.fileTooLarge'));
        update(i, { stage: t('projects.view.readingFile') });
        const result = await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) }, value => update(i, value));
        update(i, { stage: result.attachment?.reduction?.note || t('projects.view.saved'), percent: 100, finished: Date.now() });
        onRefresh();
      } catch (err) { update(i, { stage: err instanceof Error ? err.message : t('projects.view.uploadFailed'), finished: Date.now() }); }
    }
    setBusyDocs(false);
  };

  const updateFolders = async (folders: string[]) => {
    setSyncing(true);
    setAddError('');
    try { await onSave(project.id, {sourceFolders: folders}); }
    catch (e) { setAddError(e instanceof Error ? e.message : t('projects.view.folderUpdateError')); }
    finally { setSyncing(false); }
  };

  const removeFile = async (path: string) => {
    try {
      await deleteProjectFile(project.id, path);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t('projects.view.deleteFileError'));
    }
    onRefresh();
  };

  const chats = [...project.chats]
    .filter((c) => !c.archived)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  const groupKeys = [['Documents', 'projects.view.groupDocuments'], ['Images', 'projects.view.groupImages'], ['Text', 'projects.view.groupText'], ['Other', 'projects.view.groupOther']] as const;
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
              <p className="project-detail-meta">{project.archived ? `${t('projects.archived')} · ` : ''}{t.plural('projects.count.chats', project.chats.length)} · {t('projects.view.updatedLabel')} <time dateTime={new Date(project.updatedAt).toISOString()} title={new Date(project.updatedAt).toLocaleString()}>{timeAgo(t, project.updatedAt)}</time></p>
            </div>
            <div className="project-head-actions">
              {chatEnabled && <button className="btn btn-secondary btn-sm" onClick={() => onNewChat(project.id)}>{t('projects.view.newChat')}</button>}
              <button className="btn btn-secondary btn-sm" onClick={onEdit}>{t('projects.view.projectSettings')}</button>
            </div>
          </header>

          <div className="seg project-tabs" role="tablist" aria-label={t('projects.view.tablistLabel')}>
            <button role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'is-selected' : ''} onClick={() => pick('chats')}>
              {chats.length ? t('projects.view.tabChatsCount', { count: chats.length }) : t('projects.view.tabChats')}
            </button>
            <button role="tab" aria-selected={tab === 'sources'} className={tab === 'sources' ? 'is-selected' : ''} onClick={() => pick('sources')}>
              {sourceCount ? t('projects.view.tabSourcesCount', { count: sourceCount }) : t('projects.view.tabSources')}
            </button>
            {researchAccess && <button role="tab" aria-selected={tab === 'research'} className={tab === 'research' ? 'is-selected' : ''} onClick={() => pick('research')}>
              {t('projects.view.tabResearch')}
            </button>}
            {codeAccess && <button role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'is-selected' : ''} onClick={() => pick('code')}>
              {t('projects.view.tabCode')}
            </button>}
            {browserAccess && <button role="tab" aria-selected={tab === 'browser'} className={tab === 'browser' ? 'is-selected' : ''} onClick={() => pick('browser')}>
              {t('projects.view.tabBrowser')}
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
                <section className="project-outputs" aria-label={t('projects.view.outputs')}>
                  <h2 className="rail-label">{t('projects.view.outputsCount', { count: outputs.length })}</h2>
                  <ul className="output-row">
                    {outputs.slice(0, 8).map((o) => (
                      <li key={o.name}>
                        <a className="output-card surface" href={`/api/projects/${encodeURIComponent(project.id)}/documents/original?name=${encodeURIComponent(o.name)}`} download>
                          <ShellIcon name="file"/>
                          <span className="output-name">{o.base.slice(20) || o.base}</span>
                          <span className="output-meta">{t('projects.view.researchReport', { date: o.date })}</span>
                        </a>
                        {o.sources && (
                          <a className="output-sources" href={`/api/projects/${encodeURIComponent(project.id)}/documents/original?name=${encodeURIComponent(o.sources)}`} download>{t('projects.view.sources')}</a>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {chats.length > 0 && <h2 className="rail-label">{t('projects.view.recentChats')}</h2>}
              {chats.length === 0 ? (
                <EmptyState icon="chat" title={t('projects.view.noChatsTitle')}>{t('projects.view.noChatsBody', { name: project.name })}</EmptyState>
              ) : (
                <ul className="chat-index">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <button className="chat-index-row" onClick={() => onOpenChat(project.id, c.id)}>
                        <span className="chat-index-main">
                          <span className="chat-index-title">
                            {c.pinned && <ShellIcon name="pin" size={14}/>}
                            <span>{c.title || t('projects.view.newTask')}</span>
                          </span>
                          {/* The title is the first message, so until a second
                              one arrives the preview repeats it verbatim. */}
                          {c.preview && c.preview.trim() !== (c.title || '').trim() && (
                            <span className="chat-index-preview">{c.preview}</span>
                          )}
                          {streamingChats[c.id] && <span className="chat-index-status"><span className="chat-working" aria-hidden="true"><i /><i /><i /></span>{t('projects.view.generatingResponse')}</span>}
                        </span>
                        <time className="chat-index-time" dateTime={new Date(c.updatedAt).toISOString()} title={new Date(c.updatedAt).toLocaleString()}>{timeAgo(t, c.updatedAt)}</time>
                      </button>
                      <button
                        className="recents-del"
                        title={t('projects.view.deleteChat')}
                        aria-label={t('projects.view.deleteNamed', { name: c.title || t('projects.view.chat') })}
                        onClick={() => setConfirmDeleteChat({ id: c.id, title: c.title || t('sidebar.thisChat') })}
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
                {t('projects.view.referenceFilesHint')}
              </p>

              <section className="project-storage-summary">
                <h3>{t('projects.view.uploadFolder')}</h3>
                <p className="rail-empty">{t('projects.view.uploadFolderBody')}</p>
                {project.projectFolder ? <p className="storage-path"><ShellIcon name="folder"/><span>{project.projectFolder}</span></p>
                  : <p className="rail-empty">{t('projects.edit.folderOnFirstUpload')}</p>}
              </section>
              <details className="project-linked-folders">
                <summary>{t('projects.view.linkedFoldersCount', { count: linkedFolders.length })}</summary>
                <p className="rail-empty">{t('projects.view.linkedFoldersBody')}</p>
                <ul className="source-list">{(project.sourceFolders || []).filter(f=>f!==project.projectFolder).map(f=><li key={f}>
                  <span className="source-name" title={f}><ShellIcon name="folder"/> {f}</span>
                </li>)}</ul>
                <button className="btn btn-secondary btn-sm" onClick={onEdit}>{t('projects.view.editLinkedFolders')}</button>
                <p className="source-status">{t('projects.view.linkedFoldersRefreshNote')}</p>
              </details>
              <div className="source-actions">
                <button className="btn btn-secondary btn-sm" disabled={syncing || busyDocs} onClick={()=>void updateFolders(project.sourceFolders || [])}>{syncing ? t('projects.view.refreshing') : t('projects.view.refreshFromStorage')}</button>
              </div>

              <div className="source-actions">
                <label className={`btn btn-secondary btn-sm${busyDocs ? ' is-busy' : ''}`}>
                  {busyDocs ? t('projects.view.uploadingFiles') : t('projects.view.uploadFiles')}
                  <input type="file" multiple disabled={busyDocs} style={{ display: 'none' }} onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />
                </label>
                <button className="btn btn-secondary btn-sm" onClick={() => setBrowsing(true)}>{t('projects.view.importFromStorage')}</button>
              </div>
              <p className="rail-empty">{t('projects.view.uploadLimitsNote')}</p>
              {uploadRows.length > 0 && <details open={busyDocs}><summary>{busyDocs ? t('projects.view.uploadingFiles') : t('projects.view.uploadResults', { count: uploadRows.length, status: uploadRows.some(r => r.stage !== t('projects.view.saved')) ? t('projects.view.someNotAdded') : t('projects.view.savedStatus') })}</summary><ul className="source-list upload-progress" aria-label={t('projects.view.uploadProgress')} aria-live="polite">{uploadRows.map((r, i) => <li key={i}>
                <span><strong>{r.name}</strong><small className="source-status">{r.stage}{r.percent !== undefined ? ` · ${r.percent}%` : ''} · {t('projects.view.seconds', { count: Math.max(0, Math.round(((r.finished || now) - r.started) / 1000)) })}</small></span>
              </li>)}</ul></details>}
              {groupKeys.map(([group, groupKey]) => {
                const files = project.files.filter(f => fileGroup(f) === group);
                const legacyImages = group === 'Images' ? (project.assets || []).filter(a => !a.sourceName) : [];
                if (!files.length && !legacyImages.length) return null;
                const label = t(groupKey);
                return <section key={group} aria-label={label}>
                  <h3 className="rail-label">{t('projects.view.groupCount', { group: label, count: files.length + legacyImages.length })}</h3>
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
                        <small className="source-status">{skillFiles.includes(f.name) ? t('projects.view.instructionSkill') : f.document ? sourceStatus(f) : f.attachment?.state === 'stored' ? (f.attachment.reason || t('projects.view.originalStored')) : f.attachment?.state === 'vision' ? t('projects.view.uploadedImage') : f.attachment?.state === 'partial' ? (f.attachment.reason || t('projects.view.textPreviewLimited')) : t('projects.view.textReady')}</small>
                        <small className="source-status">{f.source ? f.name : t('projects.view.storedInNoevia')}{f.attachment ? ` · ${(f.attachment.bytes / 1024 / 1024).toFixed(2)} MB` : ''}</small>
                        {undeletableSynced && <small className="source-status">{t('projects.view.syncedFrom', { source: f.source || '' })}</small>}
                      </span></span>
                      {(f.attachment || f.document?.byteHash) && <a className="btn btn-ghost btn-sm" href={`/api/projects/${encodeURIComponent(project.id)}/${f.attachment ? 'uploads' : 'documents'}/original?name=${encodeURIComponent(f.name)}`} download>{t('projects.view.original')}</a>}
                      {!undeletableSynced && <button className="btn btn-ghost btn-sm" aria-label={t(deletable ? 'projects.view.deleteNamed' : 'projects.view.removeNamed', { name: f.name })} onClick={() => deletable ? setConfirmDelete(f.name) : onPatch(project.id, { files: filesAfterRemoval(project.files, f.name) })}>{deletable ? t('projects.view.delete') : t('projects.view.remove')}</button>}
                    </li>;
                  })}
                  {legacyImages.map(a => <li key={a.id}><img className="source-thumbnail" src={projectImageUrl(project.id, a.id)} alt=""/><span className="source-name"><span>{a.name}<small className="source-status">{t('projects.view.earlierUpload')}</small></span></span><button className="btn btn-ghost btn-sm" onClick={() => setConfirmImageDelete(a.id)}>{t('projects.view.remove')}</button></li>)}
                  </ul>
                </section>;
              })}
              {addError && <p className="modal-err source-add-error">{addError}</p>}
            </div>
          )}

          {/* Starting a chat from the project page is the point of being here,
              so the composer is present rather than a button that empties into
              a blank chat. */}
          {!chatEnabled && <p className="route-note" role="status">{t('projects.view.chatDisabled')}</p>}
          {/* Research and Code each have their own way to start something; a chat composer
              under them is a second, unrelated send button taking half the height. */}
          <div className="project-composer" hidden={!chatEnabled || tab === 'research' || tab === 'code' || tab === 'browser'}>
            {/* What rides along with the next message, stated before it is sent
                rather than discovered afterwards. Each chip opens what it counts. */}
            <ul className="composer-context-chips" aria-label={t('projects.view.contextChipsLabel')}>
              <li>
                <button type="button" className="chip" onClick={() => setPanel(panel === 'instructions' ? null : 'instructions')}>
                  {project.instructions ? t('projects.view.instructions') : t('projects.view.instructionsNone')}
                </button>
              </li>
              <li>
                <button type="button" className="chip" onClick={() => setPanel(panel === 'memory' ? null : 'memory')}>
                  {t('projects.view.memoryCount', { count: project.memories.length })}
                </button>
              </li>
              <li>
                <button type="button" className="chip" onClick={() => pick('sources')}>
                  {t('projects.view.sourcesCount', { count: sourceCount })}
                </button>
              </li>
              {linkedFolders.length > 0 && (
                <li>
                  <button type="button" className="chip" onClick={() => pick('sources')}>
                    {t('projects.view.linkedFoldersChip', { count: linkedFolders.length })}
                  </button>
                </li>
              )}
            </ul>
            <div className="composer-inner chat-composer-inner pane">
              <ComposerTextarea
                rows={1}
                aria-label={t('composer.placeholderProject', { name: project.name })}
                placeholder={t('composer.placeholderProject', { name: project.name })}
                value={draft}
                onValue={setDraft}
                onSubmit={send}
              />
              <ComposerActions key={project.id} project={project} disabled={composerBusy || busyDocs || syncing} onChanged={onRefresh} onModels={onOpenModels} onBusy={setComposerBusy} onStatus={setComposerStatus} />
              <ComposerModel label={modelLabel} onClick={onOpenModels} />
          <ReasoningControl project={project} disabled={composerBusy || busyDocs || syncing} onChanged={onRefresh} />
              <button className="send-btn glass glass-lens is-primary is-press" onClick={send} disabled={!draft.trim() || composerBusy || busyDocs || syncing} title={t('projects.view.send')} aria-label={t('projects.view.send')}>
                <SendIcon />
              </button>
            </div>
            {composerStatus && <div className="composer-action-status" role="status">{composerStatus}</div>}
            <button className="project-newchat" onClick={() => onNewChat(project.id)}>
              {t('projects.view.openEmptyChat', { name: project.name })}
            </button>
          </div>
        </div>

        <div className="project-rail">
          <RailRow
            label={t('projects.view.instructions')}
            hint={project.instructions ? t('projects.view.charsCount', { count: project.instructions.length }) : t('projects.view.add')}
            onClick={() => setPanel(panel === 'instructions' ? null : 'instructions')}
          />
          {panel === 'instructions' && (
            <RailTextarea
              value={project.instructions}
              placeholder={t('projects.view.instructionsPlaceholder')}
              onChange={(v) => onPatch(project.id, { instructions: v })}
              onFile={(text) => onPatch(project.id, { instructions: text })}
              fileMode="replace"
            />
          )}

          <RailRow
            label={t('projects.view.memory')}
            hint={project.memories.length ? t.plural('projects.view.lineCount', project.memories.length) : t('projects.view.edit')}
            onClick={() => setPanel(panel === 'memory' ? null : 'memory')}
          />
          {panel === 'memory' && (
            <RailTextarea
              value={project.memories.join('\n')}
              placeholder={t('projects.view.memoryPlaceholder')}
              onChange={(v) => onPatch(project.id, { memories: v.split('\n').map((x) => x.trim()).filter(Boolean) })}
              onFile={(text) => onPatch(project.id, { memories: [...project.memories, ...text.split('\n').map((x) => x.trim()).filter(Boolean)] })}
              fileMode="append"
            />
          )}

          <RailRow label={t('projects.view.sources')} hint={`${sourceCount}`} onClick={() => pick('sources')} />

          <RailRow
            label={t('projects.view.context')}
            hint={panel === 'context' ? t('projects.view.hide') : t('projects.view.show')}
            onClick={() => setPanel(panel === 'context' ? null : 'context')}
          />
          {panel === 'context' && (
            <div className="rail-context">
              <p><span>{t('projects.view.model')}</span><span>{modelLabel}</span></p>
              <p><span>{t('projects.view.thinking')}</span><span>{project.reasoningEffort && project.reasoningEffort !== 'default' ? project.reasoningEffort : t('projects.view.default')}</span></p>
              <p><span>{t('projects.view.toolboxes')}</span><span>{(project.toolboxes || ['core']).join(', ')}</span></p>
              <p><span>{t('projects.view.uploadFolder')}</span><span>{project.projectFolder || t('projects.view.createdOnFirstUpload')}</span></p>
              <p><span>{t('projects.view.linkedFolders')}</span><span>{linkedFolders.length}</span></p>
              <p><span>{t('projects.view.outputs')}</span><span>{outputs.length}</span></p>
            </div>
          )}

          {/* Listed because the sample's project screen has it; it does nothing
              yet, and says so rather than pretending. */}
          <div className="rail-row-btn is-unavailable" aria-disabled="true">
            <span className="rail-row-label">{t('projects.view.scheduled')}</span>
            <span className="rail-row-hint">{t('projects.view.notYetAvailable')}</span>
          </div>

          <p className="rail-empty" style={{ marginTop: 10 }}>
            {t('projects.view.railFooterNote')}
          </p>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('projects.view.deleteFileTitle', { name: confirmDelete.split('/').pop() || '' })}
          body={t('projects.view.deleteFileBody', { path: confirmDelete })}
          confirmLabel={t('projects.view.deleteFile')}
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { const path = confirmDelete; setConfirmDelete(null); void removeFile(path); }}
        />
      )}
      {confirmImageDelete && (
        <ConfirmDialog
          title={t('projects.view.removeImageTitle')}
          body={t('projects.view.removeImageBody')}
          confirmLabel={t('projects.view.removeImage')}
          danger
          onCancel={() => setConfirmImageDelete(null)}
          onConfirm={() => {
            const assetId = confirmImageDelete;
            setConfirmImageDelete(null);
            void deleteProjectImage(project.id, assetId)
              .then(onRefresh)
              .catch((e: unknown) => setAddError(e instanceof Error ? e.message : t('projects.view.removeImageError')));
          }}
        />
      )}
      {confirmDeleteChat && (
        <ConfirmDialog
          title={t('sidebar.confirmDeleteChatTitle', { name: confirmDeleteChat.title })}
          body={t('sidebar.confirmDeleteChatBody')}
          confirmLabel={t('sidebar.deleteChat')}
          danger
          onCancel={() => setConfirmDeleteChat(null)}
          onConfirm={() => { const chatId = confirmDeleteChat.id; setConfirmDeleteChat(null); onDeleteChat(project.id, chatId); }}
        />
      )}
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
  const t = useT();
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
          <span>{fileMode === 'append' ? t('projects.view.appendFile') : t('projects.view.replaceFile')}</span>
        </label>
      )}
    </div>
  );
}
