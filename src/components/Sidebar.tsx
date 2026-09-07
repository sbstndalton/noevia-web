import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { AccountMenu } from './AccountMenu';
import { ShellIcon } from './ShellIcon';
import type { ChatMeta, HealthState, Project } from '../types';
import {
  BookIcon,
  Logo,
  PlusIcon,
} from './Icons';

interface SidebarProps {
  projects: Project[];
  chats: ChatMeta[];
  activeView: 'diary' | 'settings' | 'projects' | 'project' | 'chat' | 'preview';
  activeProjectId: string | null;
  activeChatId: string | null;
  onNewChat: () => void;
  onEnterCode: () => void;
  onPreview: (title: string) => void;
  onOpenProjects: () => void;
  onOpenProject: (id: string) => void;
  onOpenChat: (chatId: string, projectId: string | null) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenDiary: () => void;
  diaryEnabled: boolean;
  onOpenSettings: () => void;
  health: HealthState;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

function statusText(health: HealthState): string {
  if (health.inferenceUp) return 'Inference · online';
  if (health.inferenceUp === false) return 'Inference · unreachable';
  return 'Inference · checking…';
}

export function Sidebar({
  projects,
  chats,
  activeView,
  activeProjectId,
  activeChatId,
  onNewChat,
  onEnterCode,
  onPreview,
  onOpenProjects,
  onOpenProject,
  onOpenChat,
  onDeleteChat,
  onRenameProject,
  onDeleteProject,
  onOpenDiary,
  diaryEnabled,
  onOpenSettings,
  health,
  theme,
  onToggleTheme,
}: SidebarProps): JSX.Element {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  // Per-project menu: rename inline, open settings, delete.
  // The menu uses position:fixed (anchored to the button's viewport rect) because
  // .spaces is overflow-y:auto and would clip an absolutely-positioned dropdown.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Two-step confirm for chat deletion, mirroring the project-delete pattern:
  // first click arms, second click ("Yes, delete") fires. Clicking elsewhere
  // or re-opening resets both arms.
  const [confirmChatDeleteId, setConfirmChatDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.proj-row')) return;
      setMenuFor(null);
      setConfirmDeleteId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuFor]);

  // Disarm a pending chat-delete when clicking anywhere outside chat rows.
  useEffect(() => {
    if (!confirmChatDeleteId) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.chat-row')) return;
      setConfirmChatDeleteId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [confirmChatDeleteId]);

  const startRename = (p: Project) => {
    setRenamingId(p.id);
    setRenameDraft(p.name);
    setMenuFor(null);
  };

  const commitRename = () => {
    const name = renameDraft.trim();
    if (renamingId && name) onRenameProject(renamingId, name);
    setRenamingId(null);
  };
  return (
    <div className={`sidebar${activeView === 'diary' ? ' diary-sidebar' : ''}`}>
      <div className="shell-sidebar-head"><div className="side-logo"><Logo/><span>noevia</span></div><button className="shell-icon-button" aria-label="Search projects and chats" aria-expanded={searching} onClick={()=>{setSearching(!searching);if(searching)setQuery('');}}><ShellIcon name="search"/></button></div>
      <div className="app-mode-switch" aria-label="Workspace mode"><button className="is-selected" aria-pressed="true"><ShellIcon name="chat"/>Chat</button><button onClick={onEnterCode} aria-pressed="false"><ShellIcon name="code"/>Code</button></div>
      {searching&&<input className="shell-search" autoFocus aria-label="Search projects and chats" placeholder="Search projects and chats…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setSearching(false);setQuery('');}}}/>}

      <button className="new-chat-btn" onClick={onNewChat} title="New chat">
        <PlusIcon />
        <span>New chat</span>
      </button>

      <div className="side-nav">
        <button
          className={`nav-item${activeView === 'projects' ? ' is-active' : ''}`}
          onClick={onOpenProjects}
        >
          <BookIcon />
          <span className="nav-name">Projects</span>
        </button>
      </div>

      <nav className="shell-extra-nav" aria-label="Explore noevia">{[['Scheduled','clock'],['Plugins','plugins'],['Explore','explore']].map(([label,icon])=><button className="nav-item" key={label} onClick={()=>onPreview(label)}><ShellIcon name={icon}/><span className="nav-name">{label}</span></button>)}</nav>
      <div className="spaces">
        <div className="section-label">Projects</div>
        {projects.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map((p) => (
          <div key={p.id} className={`proj-row${activeProjectId === p.id && activeView !== 'projects' ? ' is-active' : ''}`}>
            {renamingId === p.id ? (
              <input
                className="proj-rename-input"
                value={renameDraft}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button
                className={`nav-item${activeProjectId === p.id && activeView !== 'projects' ? ' is-active' : ''}`}
                onClick={() => onOpenProject(p.id)}
              >
                <span className="nav-emoji" role="img" aria-label={p.name}>📁</span>
                <span className="nav-name">{p.name}</span>
              </button>
            )}
            <button
              className={`proj-menu-btn${menuFor === p.id ? ' is-open' : ''}`}
              title="Project options"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                setMenuFor(menuFor === p.id ? null : p.id);
                setConfirmDeleteId(null);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {menuFor === p.id && menuPos && (
              <div className="proj-menu" role="menu" style={{ top: menuPos.top, right: menuPos.right }}>
                <button className="proj-menu-item" onClick={() => startRename(p)}>Rename</button>
                <button
                  className="proj-menu-item"
                  onClick={() => {
                    setMenuFor(null);
                    onOpenProject(p.id);
                  }}
                >
                  Project settings
                </button>
                {confirmDeleteId === p.id ? (
                  <div className="proj-menu-confirm">
                    <span>Delete project?</span>
                    <button
                      className="proj-menu-item danger"
                      onClick={() => {
                        setMenuFor(null);
                        onDeleteProject(p.id);
                      }}
                    >
                      Yes, delete
                    </button>
                    <button className="proj-menu-item" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                  </div>
                ) : (
                  <button className="proj-menu-item danger" onClick={() => setConfirmDeleteId(p.id)}>Delete project</button>
                )}
              </div>
            )}
          </div>
        ))}
        {projects.length === 0 && (
          <p className="side-hint">No projects yet — create one from the Projects page.</p>
        )}
      </div>

      {chats.length > 0 && (
        <>
          <div className="divider" />
          <div className="spaces">
            <div className="section-label">Recent chats</div>
            {chats.filter(c=>c.title.toLowerCase().includes(query.toLowerCase())).slice(0, 12).map((c) => (
              <div
                key={c.id}
                className={`chat-row${activeChatId === c.id && activeView === 'chat' ? ' is-active' : ''}`}
              >
                <button
                  className="nav-item"
                  onClick={() => onOpenChat(c.id, c.projectId ?? null)}
                  title={c.title}
                >
                  <span className="nav-emoji" role="img" aria-label="chat">💬</span>
                  <span className="nav-name">{c.title}</span>
                </button>
                <button
                  className={`recents-del${confirmChatDeleteId === c.id ? ' confirm-arm' : ''}`}
                  title={confirmChatDeleteId === c.id ? 'Click again to delete' : 'Delete chat'}
                  onClick={() => {
                    if (confirmChatDeleteId === c.id) {
                      setConfirmChatDeleteId(null);
                      onDeleteChat(c.id);
                    } else {
                      setConfirmChatDeleteId(c.id);
                    }
                  }}
                >
                  {confirmChatDeleteId === c.id ? 'Sure?' : '✕'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ flexGrow: 1 }} />

      {diaryEnabled && <button
        className={`nav-item${activeView === 'diary' ? ' is-active' : ''}`}
        onClick={onOpenDiary}
      >
        <span className="nav-emoji" role="img" aria-label="Diary">📔</span>
        <span className="nav-name">Diary</span>

      </button>}

      <div className="divider" />

      <div className="side-footer"><div className="status-row"><span className="status-dot" style={health.inferenceUp===false?{background:'var(--accent)'}:undefined}/><span className="status-text">{statusText(health)}</span></div><AccountMenu onSettings={onOpenSettings} onToggleTheme={onToggleTheme} theme={theme}/></div>
    </div>
  );
}
