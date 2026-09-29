import { useState } from 'react';
import { PreviewPanel } from './PreviewPanel';
import { ShellIcon } from './ShellIcon';
import { PluginsView } from './plugins/PluginsView';
import { useCodeAccess } from './code/useCodeAccess';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

// The page id stays English (App and Sidebar route on it); this maps it to the sidebar's own catalogue key (#617).
const PAGE_KEYS: Record<string, MessageKey> = { 'New task': 'sidebar.newTask', 'Pull requests': 'sidebar.code.pullRequests', Scheduled: 'sidebar.code.scheduled', Plugins: 'sidebar.code.plugins', Explore: 'sidebar.code.explore' };
const PREVIEW_ITEMS: Record<string, MessageKey[]> = {
  'Pull requests': ['code.landing.itemPullRequests', 'code.landing.itemReviews', 'code.landing.itemChecks'],
  Scheduled: ['code.landing.itemScheduled', 'code.landing.itemRunHistory'],
};
const OTHER_PREVIEW_ITEMS: MessageKey[] = ['code.landing.itemEnvironments', 'code.landing.itemWorktrees', 'code.landing.itemHooks', 'code.landing.itemArtifacts'];
const QUICK_ACTIONS: MessageKey[] = ['code.landing.quickBuild', 'code.landing.quickReview', 'code.landing.quickFix'];
const SIDE_SECTIONS: MessageKey[] = ['code.landing.sideFiles', 'code.landing.sideChanges', 'code.landing.sideTerminal'];

/** The Code page. Its navigation is the shared sidebar in Code mode (Sidebar `mode="code"`), so
 *  Chat and Code keep one sidebar, one collapse state and one look (user review, 2026-09-19).
 *
 *  #368: the working harness only runs inside a project's own Code tab (ProjectView.tsx's
 *  `<CodePanel>`, gated by the same `useCodeAccess`). This landing page has no project to run a
 *  task in, so a viewer who could use that harness gets a picker into the real thing instead of
 *  the honest "not connected yet" stub everyone else still sees. */
export function CodingWorkspace({ page, onStartChat, projects, projectsLoaded = true, onProjectsChanged, onOpenProjectCode }: { page: string; onStartChat?: (prompt: string) => void; projects?: { id: string; name: string; archived?: boolean }[]; projectsLoaded?: boolean; onProjectsChanged?: () => void; onOpenProjectCode?: (projectId: string) => void }) {
  const t = useT();
  const [draft,setDraft]=useState('');
  const [panel,setPanel]=useState(false);
  const list = projects ?? [];
  // Access is per admin and the feature flag, not per project (server/routes/code.cjs checks the
  // flag and the role before it ever looks at the project id) — any real project answers the same
  // way, so the first one stands in for "can this viewer reach Code mode at all". useCodeAccess
  // itself never probes a placeholder id (#450): with no real id yet it reports 'checking'.
  const accessProbe = useCodeAccess(list[0]?.id ?? '');
  // Zero projects, once the list has actually finished loading (`projectsLoaded`), is a real,
  // decided answer — there is no id left to probe, and the outcome (the honest stub) is the same
  // whether or not this viewer would otherwise have access. Only *not knowing yet* whether the
  // list is genuinely empty (it is still loading) should read as 'checking'; otherwise a viewer
  // with zero projects would see the loading skeleton forever.
  const codeAccess = accessProbe === 'checking' && projectsLoaded && list.length === 0 ? 'denied' : accessProbe;
  const checking = codeAccess === 'checking';
  const canOpenProjectCode = codeAccess === 'allowed' && !!onOpenProjectCode;
  // 'Checking' must read as neither claim below is true yet — not "no execution" (denied, wrong
  // for an admin who does have access) and not "runs in a project" (not confirmed yet either).
  const newTaskBadge = checking ? t('code.landing.checking') : canOpenProjectCode ? t('code.landing.runsInProject') : t('code.landing.preview');
  const pageName = PAGE_KEYS[page] ? t(PAGE_KEYS[page]) : page;
  return <div className="coding-workspace">
    <main className="coding-main"><header className="coding-header"><span>{pageName}</span><div><span className="preview-badge">{page==='New task'?newTaskBadge:t('code.landing.preview')}</span><button className="shell-icon-button" aria-label={t('code.landing.togglePanel')} aria-expanded={panel} onClick={()=>setPanel(!panel)}><ShellIcon name="panel"/></button></div></header><div className="coding-content">{page==='New task'?(checking?<CodingAccessSkeleton/>:canOpenProjectCode?<CodeProjectPicker projects={list} onOpen={onOpenProjectCode!}/>:<><div className="coding-welcome"><span className="code-emblem"><ShellIcon name="code" size={28}/></span><h1>{t('code.landing.welcomeTitle')}</h1><p>{t('code.landing.welcomeBody')}</p></div><div className="coding-quick-actions">{QUICK_ACTIONS.map(key=><button disabled key={key}>{t(key)}</button>)}</div><div className="coding-composer"><div className="coding-context-chips"><button disabled><ShellIcon name="folder"/>{t('code.landing.selectProject')}</button><button disabled><ShellIcon name="git"/>{t('code.landing.chooseBranch')}</button><button disabled>{t('code.landing.localEnvironment')}</button></div><label className="coding-draft-label" htmlFor="coding-draft">{t('code.landing.draftLabel')}</label><textarea id="coding-draft" value={draft} onChange={e=>setDraft(e.target.value)} placeholder={t('code.landing.draftPlaceholder')} rows={3}/><div className="coding-composer-footer"><div><button disabled><ShellIcon name="plus" size={14}/>{t('code.landing.addContext')}</button><button disabled>{t('code.landing.auto')}</button></div><div><button disabled>{t('code.landing.selectModel')}</button><button className="code-submit" disabled aria-label={t('code.landing.runDisabled')}><ShellIcon name="arrow-up" size={16}/></button></div></div><p className="preview-footnote">{t('code.landing.footnote')}</p></div></>):page==='Plugins'?<PluginsView embedded initialTab="plugins" onStartChat={onStartChat} projects={projects} onProjectsChanged={onProjectsChanged}/>:<PreviewPanel title={pageName} description={t('code.landing.previewDescription')} items={(PREVIEW_ITEMS[page] ?? OTHER_PREVIEW_ITEMS).map(key=>t(key))}/>}</div></main>
    {panel&&<aside className="coding-side-panel"><h2>{t('code.landing.sideWorkspace')}</h2>{SIDE_SECTIONS.map(key=><details key={key}><summary>{t(key)}</summary><p>{t('code.landing.sideNote')}</p></details>)}</aside>}
  </div>;
}

/** Neutral loading state for the "New task" page while `useCodeAccess` is still 'checking'
 *  (#450) — same footprint as the welcome hero + composer it replaces, so settling into the real
 *  content (or the honest stub) is not itself a layout jump. Never asserts "connected" or
 *  "not connected"; the pulse (shared with typing/working dots, `motion.css`) is the only motion
 *  and stops under reduced motion. Exported for tests. */
export function CodingAccessSkeleton() {
  const t = useT();
  return <div className="coding-checking" role="status">
    <span className="sr-only">{t('code.landing.checking')}</span>
    <div className="coding-skeleton-hero" aria-hidden="true">
      <span className="coding-skeleton-block coding-skeleton-emblem"/>
      <span className="coding-skeleton-block coding-skeleton-title"/>
      <span className="coding-skeleton-block coding-skeleton-subtitle"/>
    </div>
    <div className="coding-skeleton-composer" aria-hidden="true">
      <div className="coding-skeleton-chips"><span className="coding-skeleton-block coding-skeleton-chip"/><span className="coding-skeleton-block coding-skeleton-chip"/><span className="coding-skeleton-block coding-skeleton-chip"/></div>
      <span className="coding-skeleton-block coding-skeleton-textarea"/>
    </div>
  </div>;
}

/** Sends an admin with a working Code harness to the project that actually runs it (#368), rather
 *  than leaving them on a stub once the feature is live. Reuses the app's own project list and its
 *  existing project+Code navigation (`onOpenProjectCode`, wired from App.tsx the same way
 *  `ActiveCodeTasks`'s `onOpenProject` already is). */
/** Exported for tests: a pure, hook-free presentational component (unlike CodingWorkspace itself,
 *  which resolves access through an effect and so cannot render its "granted" state statically). */
export function CodeProjectPicker({ projects: all, onOpen }: { projects: { id: string; name: string; archived?: boolean }[]; onOpen: (projectId: string) => void }) {
  const t = useT();
  // #566: archived projects are not offered here.
  const projects = all.filter((p) => !p.archived);
  return <>
    <div className="coding-welcome"><span className="code-emblem"><ShellIcon name="code" size={28}/></span><h1>{t('code.picker.title')}</h1><p>{t('code.picker.body')}</p></div>
    {projects.length
      ? <ul className="plugin-grid coding-project-picker" aria-label={t('code.picker.listLabel')}>{projects.map((p) => <li key={p.id} className="plugin-card surface"><span className="plugin-card-icon"><ShellIcon name="folder" size={20}/></span><span className="plugin-card-text"><b>{p.name}</b></span><span className="plugin-card-actions"><button className="btn btn-secondary btn-sm" onClick={() => onOpen(p.id)}>{t('code.picker.open')}</button></span></li>)}</ul>
      : <p className="preview-footnote">{t('code.picker.noProjects')}</p>}
  </>;
}
