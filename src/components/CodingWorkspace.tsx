import { useState } from 'react';
import { PreviewPanel } from './PreviewPanel';
import { ShellIcon } from './ShellIcon';
import { PluginsView } from './plugins/PluginsView';

/** The Code page. Its navigation is the shared sidebar in Code mode (Sidebar `mode="code"`), so
 *  Chat and Code keep one sidebar, one collapse state and one look (user review, 2026-09-19). */
export function CodingWorkspace({ page, onStartChat }: { page: string; onStartChat?: (prompt: string) => void }) {
  const [draft,setDraft]=useState('');
  const [panel,setPanel]=useState(false);
  return <div className="coding-workspace">
    <main className="coding-main"><header className="coding-header"><span>{page}</span><div><span className="preview-badge">Interface preview · no execution</span><button className="shell-icon-button" aria-label="Toggle coding side panel" aria-expanded={panel} onClick={()=>setPanel(!panel)}><ShellIcon name="panel"/></button></div></header><div className="coding-content">{page==='New task'?<><div className="coding-welcome"><span className="code-emblem"><ShellIcon name="code" size={28}/></span><h1>What should we build next?</h1><p>A focused space for code, projects, and the work ahead.</p></div><div className="coding-quick-actions">{['Build a feature','Review code','Fix a bug'].map(label=><button disabled key={label}>{label}</button>)}</div><div className="coding-composer"><div className="coding-context-chips"><button disabled><ShellIcon name="folder"/>Select project</button><button disabled><ShellIcon name="git"/>Choose branch</button><button disabled>Local environment</button></div><label className="coding-draft-label" htmlFor="coding-draft">Describe a coding task</label><textarea id="coding-draft" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Describe a task or ask a coding question…" rows={3}/><div className="coding-composer-footer"><div><button disabled><ShellIcon name="plus" size={14}/>Add context</button><button disabled>Auto</button></div><div><button disabled>Select model</button><button className="code-submit" disabled aria-label="Run task — not connected"><ShellIcon name="arrow-up" size={16}/></button></div></div><p className="preview-footnote">Draft only. Running tasks, reading repositories, and editing code are not connected yet.</p></div></>:page==='Plugins'?<PluginsView embedded onStartChat={onStartChat}/>:<PreviewPanel title={page} description="This area belongs to your coding workspace. Its functionality will be added later." items={page==='Pull requests'?['Open pull requests','Code reviews','Checks and status']:page==='Scheduled'?['Scheduled coding tasks','Run history']:['Environments','Worktrees','Hooks','Artifacts']}/>}</div></main>
    {panel&&<aside className="coding-side-panel"><h2>Workspace</h2>{['Files','Changes','Terminal'].map(label=><details key={label}><summary>{label}</summary><p>No project connected. This panel is a preview.</p></details>)}</aside>}
  </div>;
}
