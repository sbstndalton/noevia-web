import { useState } from 'react';
import { PreviewPanel } from './PreviewPanel';
import { ShellIcon } from './ShellIcon';
import { PluginsView } from './plugins/PluginsView';
import { useCodeAccess } from './code/useCodeAccess';

/** The Code page. Its navigation is the shared sidebar in Code mode (Sidebar `mode="code"`), so
 *  Chat and Code keep one sidebar, one collapse state and one look (user review, 2026-09-19).
 *
 *  #368: the working harness only runs inside a project's own Code tab (ProjectView.tsx's
 *  `<CodePanel>`, gated by the same `useCodeAccess`). This landing page has no project to run a
 *  task in, so a viewer who could use that harness gets a picker into the real thing instead of
 *  the honest "not connected yet" stub everyone else still sees. */
export function CodingWorkspace({ page, onStartChat, projects, onProjectsChanged, onOpenProjectCode }: { page: string; onStartChat?: (prompt: string) => void; projects?: { id: string; name: string }[]; onProjectsChanged?: () => void; onOpenProjectCode?: (projectId: string) => void }) {
  const [draft,setDraft]=useState('');
  const [panel,setPanel]=useState(false);
  const list = projects ?? [];
  // Access is per admin and the feature flag, not per project (server/routes/code.cjs checks the
  // flag and the role before it ever looks at the project id) — any real project answers the same
  // way, so the first one stands in for "can this viewer reach Code mode at all".
  const codeAccess = useCodeAccess(list[0]?.id ?? '-');
  const canOpenProjectCode = codeAccess && !!onOpenProjectCode;
  return <div className="coding-workspace">
    <main className="coding-main"><header className="coding-header"><span>{page}</span><div><span className="preview-badge">{page==='New task'&&canOpenProjectCode?'Runs in a project':'Interface preview · no execution'}</span><button className="shell-icon-button" aria-label="Toggle coding side panel" aria-expanded={panel} onClick={()=>setPanel(!panel)}><ShellIcon name="panel"/></button></div></header><div className="coding-content">{page==='New task'?(canOpenProjectCode?<CodeProjectPicker projects={list} onOpen={onOpenProjectCode!}/>:<><div className="coding-welcome"><span className="code-emblem"><ShellIcon name="code" size={28}/></span><h1>What should we build next?</h1><p>A focused space for code, projects, and the work ahead.</p></div><div className="coding-quick-actions">{['Build a feature','Review code','Fix a bug'].map(label=><button disabled key={label}>{label}</button>)}</div><div className="coding-composer"><div className="coding-context-chips"><button disabled><ShellIcon name="folder"/>Select project</button><button disabled><ShellIcon name="git"/>Choose branch</button><button disabled>Local environment</button></div><label className="coding-draft-label" htmlFor="coding-draft">Describe a coding task</label><textarea id="coding-draft" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Describe a task or ask a coding question…" rows={3}/><div className="coding-composer-footer"><div><button disabled><ShellIcon name="plus" size={14}/>Add context</button><button disabled>Auto</button></div><div><button disabled>Select model</button><button className="code-submit" disabled aria-label="Run task — not connected"><ShellIcon name="arrow-up" size={16}/></button></div></div><p className="preview-footnote">Draft only. Running tasks, reading repositories, and editing code are not connected yet.</p></div></>):page==='Plugins'?<PluginsView embedded onStartChat={onStartChat} projects={projects} onProjectsChanged={onProjectsChanged}/>:<PreviewPanel title={page} description="This area belongs to your coding workspace. Its functionality will be added later." items={page==='Pull requests'?['Open pull requests','Code reviews','Checks and status']:page==='Scheduled'?['Scheduled coding tasks','Run history']:['Environments','Worktrees','Hooks','Artifacts']}/>}</div></main>
    {panel&&<aside className="coding-side-panel"><h2>Workspace</h2>{['Files','Changes','Terminal'].map(label=><details key={label}><summary>{label}</summary><p>No project connected. This panel is a preview.</p></details>)}</aside>}
  </div>;
}

/** Sends an admin with a working Code harness to the project that actually runs it (#368), rather
 *  than leaving them on a stub once the feature is live. Reuses the app's own project list and its
 *  existing project+Code navigation (`onOpenProjectCode`, wired from App.tsx the same way
 *  `ActiveCodeTasks`'s `onOpenProject` already is). */
/** Exported for tests: a pure, hook-free presentational component (unlike CodingWorkspace itself,
 *  which resolves access through an effect and so cannot render its "granted" state statically). */
export function CodeProjectPicker({ projects, onOpen }: { projects: { id: string; name: string }[]; onOpen: (projectId: string) => void }) {
  return <>
    <div className="coding-welcome"><span className="code-emblem"><ShellIcon name="code" size={28}/></span><h1>Open a project to run Code</h1><p>Code mode runs inside each project's own Code tab, with its repository and task history. Pick a project to continue.</p></div>
    {projects.length
      ? <ul className="plugin-grid coding-project-picker" aria-label="Projects with Code access">{projects.map((p) => <li key={p.id} className="plugin-card surface"><span className="plugin-card-icon"><ShellIcon name="folder" size={20}/></span><span className="plugin-card-text"><b>{p.name}</b></span><span className="plugin-card-actions"><button className="btn btn-secondary btn-sm" onClick={() => onOpen(p.id)}>Open Code</button></span></li>)}</ul>
      : <p className="preview-footnote">Create a project, then open its Code tab to run a task.</p>}
  </>;
}
