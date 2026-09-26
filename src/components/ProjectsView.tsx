import { appLocale } from '../user-preferences';
import { useId, useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';
import type { JSX } from 'react';
import type { Project } from '../types';
import { ShellIcon } from './ShellIcon';
import { CloseButton } from './CloseButton';
import { ProjectIcon, ProjectIdentityPicker } from './ProjectIdentity';
import { ContextMenu, ConfirmDialog } from './ContextMenu';
import { PlusIcon } from './Icons';
import { StorageFileBrowser } from './StorageFileBrowser';
import { EmptyState } from './EmptyState';
import { readTextSources, describeRejection } from '../sources';
import { PROJECT_NAME_MAX_LENGTH } from '../project-limits';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import '../i18n/projects';

interface ProjectsViewProps {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onPatch: (id: string, patch: Partial<Project>) => void;
  onCreate: (body: { icon?: string; color?: string; name: string; goal: string; instructions: string; files: { name: string; content: string }[] }) => Promise<void>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
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

export function ProjectsView({ projects, onOpenProject, onPatch, onCreate, onDelete, onEdit }: ProjectsViewProps): JSX.Element {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const tabsId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const clearFilter = () => { setQuery(''); searchRef.current?.focus(); };
  const [menu, setMenu] = useState<{project: Project; at:{x:number;y:number}} | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const archivedCount = projects.filter((p) => p.archived).length;
  // The headline describes "Your projects"; archived ones are counted on their own tab.
  const activeProjects = projects.filter((p) => !p.archived);
  const chatCount = activeProjects.reduce((n, p) => n + p.chats.length, 0);
  const visibleProjects = projects
    .filter((p) => (tab === 'archived' ? p.archived : !p.archived))
    .filter((p) => `${p.name} ${p.goal || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt) || a.name.localeCompare(b.name));

  return (
    <div className="main projects-workspace">
      <div className="settings-scroll">
        {/* #413: one page-header pattern (display title + intro, shared with Settings and
            Customise) instead of Projects' own oversized hero — see docs/design-notes/page-headers.md.
            The primary action moves down beside the tabs, where every other page's header-adjacent
            action already lives (no title ever carries an inline control). */}
        <div className="settings-title projects-title"><h1>{t('projects.title')}</h1>
          <p>
            {projects.length === 0
              ? t('projects.heroEmpty')
              : `${t.plural('projects.count.projects', activeProjects.length)} · ${t.plural('projects.count.chats', chatCount)}`}
          </p>
        </div>
        <div className="projects-head">
          <div className="seg" role="tablist" aria-label={t('projects.listLabel')} onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 'active' : e.key === 'End' ? 'archived' : tab === 'active' ? 'archived' : 'active';
            setTab(next);
            e.currentTarget.querySelector<HTMLButtonElement>(`[data-project-tab="${next}"]`)?.focus();
          }}>
            <button role="tab" id={`${tabsId}-active`} data-project-tab="active" aria-controls={`${tabsId}-panel`} tabIndex={tab === 'active' ? 0 : -1} aria-selected={tab === 'active'} className={tab === 'active' ? 'is-selected' : ''} onClick={() => setTab('active')}>
              {t('projects.tabYours')}
            </button>
            <button role="tab" id={`${tabsId}-archived`} data-project-tab="archived" aria-controls={`${tabsId}-panel`} tabIndex={tab === 'archived' ? 0 : -1} aria-selected={tab === 'archived'} className={tab === 'archived' ? 'is-selected' : ''} onClick={() => setTab('archived')}>
              {archivedCount ? t('projects.tabArchivedCount', { count: archivedCount }) : t('projects.tabArchived')}
            </button>
          </div>
          <input
            ref={searchRef}
            className="projects-search"
            type="search"
            aria-label={t('projects.filterLabel')}
            placeholder={t('projects.filterPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="projects-sort" aria-label={t('projects.sortLabel')} value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
            <option value="recent">{t('projects.sortRecent')}</option>
            <option value="name">{t('projects.sortName')}</option>
          </select>
          {/* With no projects the empty state carries the one primary action. */}
          {projects.length > 0 && <button className="btn btn-primary projects-new" onClick={() => setCreating(true)}><PlusIcon /><span>{t('projects.newProject')}</span></button>}
        </div>

        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {projects.length === 0 ? (
          <EmptyState icon="folder" title={t('projects.emptyTitle')}
            action={<button className="btn btn-primary" onClick={() => setCreating(true)}><PlusIcon /><span>{t('projects.newProject')}</span></button>}>
            {t('projects.emptyBody')}
          </EmptyState>
        ) : (
          <div className="projects-grid">
            {visibleProjects.length === 0 && (
              <EmptyState compact icon={query.trim() ? 'search' : 'archive'} title={query.trim() ? t('projects.noMatchTitle') : tab === 'archived' ? t('projects.noArchivedTitle') : t('projects.noActiveTitle')}
                action={query.trim() ? <button className="modal-btn secondary" onClick={clearFilter}>{t('projects.clearFilter')}</button> : tab === 'active' ? <button className="modal-btn secondary" onClick={() => setTab('archived')}>{t('projects.viewArchived')}</button> : undefined}>
                {query.trim() ? t('projects.noMatchBody', { query: query.trim() }) : tab === 'archived' ? t('projects.noArchivedBody') : t('projects.noActiveBody')}
              </EmptyState>
            )}
            {visibleProjects.map((p) => (
              <article key={p.id} className="project-card surface">
                <div className="project-card-top">
                  <span className="project-badge" aria-hidden="true"><ProjectIcon project={p} size={24}/></span>
                  <h2 className="project-card-name"><button className="project-card-open" onClick={() => onOpenProject(p.id)} aria-label={t('projects.openProject', { name: p.name })}>{p.name}</button></h2>
                  <button className="project-card-options" aria-label={t('projects.optionsFor', { name: p.name })} onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setMenu({project:p,at:{x:r.left,y:r.bottom+4}});}}><ShellIcon name="more"/></button>
                </div>
                {p.goal && <p className="project-card-goal">{p.goal}</p>}
                <div className="project-card-meta">
                  {p.pinned && <span className="project-card-pin"><ShellIcon name="pin" size={14}/>{t('projects.pinned')}</span>}
                  {p.archived && <span className="project-chip">{t('projects.archived')}</span>}
                  <span className="project-chip">{t.plural('projects.count.chats', p.chats.length)}</span>
                  {p.files.length > 0 && <span className="project-chip">{t.plural('projects.count.files', p.files.length)}</span>}
                  {p.modes?.length && (p.modes.length > 1 || p.modes[0] !== 'chat') ? <span className="project-chip" aria-label={t('projects.availableIn', { modes: p.modes.join(', ') })}>{p.modes.map((m) => m === 'chat' ? t('projects.modeChat') : m === 'cowork' ? t('projects.modeCowork') : t('projects.modeCode')).join(' · ')}</span> : null}
                  <time className="project-card-time" dateTime={new Date(p.updatedAt).toISOString()} title={t('projects.updatedAt', { date: new Date(p.updatedAt).toLocaleString(appLocale()) })}>{timeAgo(t, p.updatedAt)}</time>
                  {p.archived && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => { e.stopPropagation(); onPatch(p.id, { archived: false }); }}
                    >
                      {t('projects.restore')}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        </div>
      </div>

      {menu && <ContextMenu at={menu.at} onClose={()=>setMenu(null)} items={[
        {label:t('projects.menu.settings'),icon:<ShellIcon name="settings"/>,onSelect:()=>onEdit(menu.project.id)},
        {label:menu.project.pinned?t('projects.menu.unpin'):t('projects.menu.pin'),icon:<ShellIcon name="pin"/>,onSelect:()=>onPatch(menu.project.id,{pinned:!menu.project.pinned})},
        {label:menu.project.archived?t('projects.menu.restore'):t('projects.menu.archive'),icon:<ShellIcon name="folder"/>,onSelect:()=>onPatch(menu.project.id,{archived:!menu.project.archived})},
        {label:t('projects.menu.delete'),danger:true,onSelect:()=>setConfirmDelete(menu.project.id)}
      ]}/>}
      {confirmDelete && <ConfirmDialog title={t('projects.confirmDeleteTitle', { name: projects.find(p=>p.id===confirmDelete)?.name || t('projects.aProject') })} body={t('projects.confirmDeleteBody')} confirmLabel={t('projects.confirmDeleteConfirm')} danger onCancel={()=>setConfirmDelete(null)} onConfirm={()=>{onDelete(confirmDelete);setConfirmDelete(null);}}/>}
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
  const t = useT();
  const dialog = useModalDialog();
  const [icon, setIcon] = useState('folder');
  const [color, setColor] = useState('default');
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
    setErr(rejected.length ? t('projects.notAdded', { reason: describeRejection(rejected) }) : null);
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
      await onCreate({ icon, color, name: name.trim(), goal: goal.trim(), instructions, files });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('projects.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="modal-overlay native-modal" aria-label={t('projects.createLabel')} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      <div className="modal-card aero dialog-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t('projects.createTitle')}</h2>
          <CloseButton onClick={onClose}/>
        </div>

        <ProjectIdentityPicker icon={icon} color={color} onChange={(i,c)=>{setIcon(i);setColor(c);}}/>
        <label className="modal-label" htmlFor="proj-name">{t('projects.nameQuestion')}</label>
        <input
          id="proj-name"
          className="modal-input"
          placeholder={t('projects.namePlaceholder')}
          value={name}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          data-initial-focus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <small
          className={`project-name-counter${name.length >= PROJECT_NAME_MAX_LENGTH - 10 ? ' is-near-limit' : ''}`}
          aria-label={t('projects.nameLengthCounterLabel', { count: name.length, max: PROJECT_NAME_MAX_LENGTH })}
        >
          {t('projects.nameLengthCounter', { count: name.length, max: PROJECT_NAME_MAX_LENGTH })}
        </small>

        <label className="modal-label" htmlFor="proj-goal">{t('projects.goalQuestion')}</label>
        <textarea
          id="proj-goal"
          className="modal-input"
          placeholder={t('projects.goalPlaceholder')}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />

        <label className="modal-label" htmlFor="proj-instr">{t('projects.instructionsLabel')}</label>
        <textarea
          id="proj-instr"
          className="modal-input"
          placeholder={t('projects.instructionsPlaceholder')}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <label className="modal-label">{t('projects.filesLabel')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="modal-filepick">
            <input type="file" multiple accept=".txt,.md,.json,.csv,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.sh,.html,.css" onChange={(e) => void addFiles(e.target.files)} />
            <span>{t('projects.addFiles')}</span>
          </label>
          <button className="modal-filepick" style={{ background: 'none', cursor: 'pointer' }} onClick={() => setBrowsing(true)}>
            <span>{t('projects.pullFromStorage')}</span>
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
                  <ShellIcon name="close" size={16}/>
                </button>
              </span>
            ))}
          </div>
        )}

        {err && <p className="modal-err">{err}</p>}

        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onClose}>{t('projects.cancel')}</button>
          <button className="modal-btn primary" onClick={() => void submit()} disabled={!name.trim() || busy}>
            {busy ? t('projects.creating') : t('projects.createProject')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
