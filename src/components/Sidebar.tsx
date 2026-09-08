import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { AccountMenu } from './AccountMenu';
import { ContextMenu, ConfirmDialog } from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import { fetchToolboxes } from '../api';
import type { McpStatus } from '../api';
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
  onDeleteChat: (projectId: string | null, chatId: string) => void;
  onPatchChat: (projectId: string | null, chatId: string, patch: Partial<ChatMeta>) => void;
  onPatchProject: (id: string, patch: Partial<Project>) => void;
  onEditProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenDiary: () => void;
  diaryEnabled: boolean;
  onOpenSettings: () => void;
  health: HealthState;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

// Scheduled, Plugins and Explore all route to PreviewPanel and do nothing.
// Advertising three features that dead-end is itself what makes the product
// feel unfinished, so they stay hidden until they execute. Flip to true to
// restore them — the nav markup below is unchanged.
const SHOW_PLACEHOLDER_NAV = false;

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
  onPatchChat,
  onPatchProject,
  onEditProject,
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
  // One menu model for both entity types, opened from a right-click or the
  // hamburger. Destructive choices route through `confirm` rather than an
  // inline two-step arm, so the subject is named before anything happens.
  const [menu, setMenu] = useState<
    { kind: 'project' | 'chat'; id: string; projectId: string | null; at: { x: number; y: number } } | null
  >(null);
  const [confirm, setConfirm] = useState<
    { title: string; body: string; confirmLabel: string; danger?: boolean; run: () => void } | null
  >(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // MCP reachability. Nothing surfaced this before; a configured server that
  // has failed to discover its tools should say so rather than look healthy.
  const [mcp, setMcp] = useState<McpStatus | null>(null);

  useEffect(() => {
    void fetchToolboxes().then((r) => setMcp(r.mcp ?? null)).catch(() => undefined);
  }, []);

  const startRename = (id: string, current: string) => {
    setRenamingId(id);
    setRenameDraft(current);
  };

  const commitRename = (projectId: string | null, isChat: boolean) => {
    const name = renameDraft.trim();
    if (renamingId && name) {
      if (isChat) onPatchChat(projectId, renamingId, { title: name });
      else onPatchProject(renamingId, { name });
    }
    setRenamingId(null);
  };

  // Pinned first, archived hidden. Archived items stay reachable from the
  // Projects page's Archived tab rather than vanishing.
  const visibleProjects = projects
    .filter((p) => !p.archived && p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const visibleChats = chats
    .filter((c) => !c.archived && (c.title || '').toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  const projectMenu = (p: Project): MenuItem[] => [
    { label: p.pinned ? 'Unpin' : 'Pin', onSelect: () => onPatchProject(p.id, { pinned: !p.pinned }) },
    { label: 'Rename', onSelect: () => startRename(p.id, p.name) },
    { label: 'Edit project', onSelect: () => onEditProject(p.id) },
    {
      label: 'Archive',
      onSelect: () =>
        setConfirm({
          title: `Archive ${p.name}?`,
          body: 'It leaves the sidebar and moves to Archived on the Projects page. Its chats and files are kept, and you can restore it at any time.',
          confirmLabel: 'Archive',
          run: () => onPatchProject(p.id, { archived: true }),
        }),
    },
    {
      label: 'Delete project',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: `Delete ${p.name}?`,
          body: `This permanently deletes the project along with its ${(p.chats || []).length} chat${(p.chats || []).length === 1 ? '' : 's'} and ${(p.files || []).length} file${(p.files || []).length === 1 ? '' : 's'}. This cannot be undone.`,
          confirmLabel: 'Delete project',
          danger: true,
          run: () => onDeleteProject(p.id),
        }),
    },
  ];

  const chatMenu = (c: ChatMeta): MenuItem[] => [
    { label: c.pinned ? 'Unpin' : 'Pin', onSelect: () => onPatchChat(c.projectId ?? null, c.id, { pinned: !c.pinned }) },
    { label: 'Rename', onSelect: () => startRename(c.id, c.title || '') },
    {
      label: 'Archive',
      onSelect: () => onPatchChat(c.projectId ?? null, c.id, { archived: true }),
    },
    {
      label: 'Delete chat',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: `Delete "${c.title || 'this chat'}"?`,
          body: 'The conversation and its history are permanently removed. This cannot be undone.',
          confirmLabel: 'Delete chat',
          danger: true,
          run: () => onDeleteChat(c.projectId ?? null, c.id),
        }),
    },
  ];
  return (
    <div className={`sidebar${activeView === 'diary' ? ' diary-sidebar' : ''}`}>
      <div className="shell-sidebar-head"><div className="side-logo"><Logo/><span>noevia</span></div><div className="side-head-actions"><button className="shell-icon-button" aria-label={theme==='dark'?'Switch to Polymetal Day':'Switch to Polymetal Night'} title={theme==='dark'?'Polymetal Day':'Polymetal Night'} onClick={onToggleTheme}><ShellIcon name="sun"/></button><button className="shell-icon-button" aria-label="Search projects and chats" aria-expanded={searching} onClick={()=>{setSearching(!searching);if(searching)setQuery('');}}><ShellIcon name="search"/></button></div></div>
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
        {diaryEnabled && (
          <button
            className={`nav-item${activeView === 'diary' ? ' is-active' : ''}`}
            onClick={onOpenDiary}
          >
            <span className="nav-emoji" role="img" aria-label="Diary">📔</span>
            <span className="nav-name">Diary</span>
          </button>
        )}
      </div>

      {SHOW_PLACEHOLDER_NAV && <nav className="shell-extra-nav" aria-label="Explore noevia">{[['Scheduled','clock'],['Plugins','plugins'],['Explore','explore']].map(([label,icon])=><button className="nav-item" key={label} onClick={()=>onPreview(label)}><ShellIcon name={icon}/><span className="nav-name">{label}</span></button>)}</nav>}
      <div className="spaces">
        <div className="section-label">Projects</div>
        {visibleProjects.map((p) => (
          <div
            key={p.id}
            className={`proj-row${activeProjectId === p.id && activeView !== 'projects' ? ' is-active' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ kind: 'project', id: p.id, projectId: null, at: { x: e.clientX, y: e.clientY } });
            }}
          >
            {renamingId === p.id ? (
              <input
                className="proj-rename-input"
                value={renameDraft}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => commitRename(null, false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(null, false);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button
                className={`nav-item${activeProjectId === p.id && activeView !== 'projects' ? ' is-active' : ''}`}
                onClick={() => onOpenProject(p.id)}
              >
                <span className="nav-emoji" role="img" aria-label={p.name}>{p.pinned ? '📌' : '📁'}</span>
                <span className="nav-name">{p.name}</span>
                {/* What this project is working from, on hover — the sources it
                    pulls context from, which is otherwise only visible inside
                    the project. */}
                <span className="row-card" role="tooltip">
                  <strong>{p.name}</strong>
                  {p.goal && <em>{p.goal}</em>}
                  <span>{(p.chats || []).length} chat{(p.chats || []).length === 1 ? '' : 's'} · {(p.files || []).length} source{(p.files || []).length === 1 ? '' : 's'}</span>
                  {(p.files || []).slice(0, 4).map((f) => <span key={f.name} className="row-card-src">{f.name}</span>)}
                  {(p.files || []).length > 4 && <span className="row-card-src">+{(p.files || []).length - 4} more</span>}
                  {(p.files || []).length === 0 && <span className="row-card-src">No sources attached</span>}
                </span>
              </button>
            )}
            <button
              className={`proj-menu-btn${menu?.kind === 'project' && menu.id === p.id ? ' is-open' : ''}`}
              title="Project options"
              aria-label={`Options for ${p.name}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ kind: 'project', id: p.id, projectId: null, at: { x: r.left, y: r.bottom + 4 } });
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        ))}
        {visibleProjects.length === 0 && (
          <p className="side-hint">No projects yet — create one from the Projects page.</p>
        )}
      </div>

      {visibleChats.length > 0 && (
        <>
          <div className="divider" />
          <div className="spaces">
            <div className="section-label">Recent chats</div>
            {visibleChats.slice(0, 12).map((c) => (
              <div
                key={c.id}
                className={`chat-row${activeChatId === c.id && activeView === 'chat' ? ' is-active' : ''}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: 'chat', id: c.id, projectId: c.projectId ?? null, at: { x: e.clientX, y: e.clientY } });
                }}
              >
                {renamingId === c.id ? (
                  <input
                    className="proj-rename-input"
                    value={renameDraft}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(c.projectId ?? null, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(c.projectId ?? null, true);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    className="nav-item"
                    onClick={() => onOpenChat(c.id, c.projectId ?? null)}
                    title={c.title}
                  >
                    <span className="nav-emoji" role="img" aria-label="chat">{c.pinned ? '📌' : '💬'}</span>
                    <span className="nav-name">{c.title}</span>
                  </button>
                )}
                <button
                  className={`proj-menu-btn${menu?.kind === 'chat' && menu.id === c.id ? ' is-open' : ''}`}
                  title="Chat options"
                  aria-label={`Options for ${c.title || 'this chat'}`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ kind: 'chat', id: c.id, projectId: c.projectId ?? null, at: { x: r.left, y: r.bottom + 4 } });
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ flexGrow: 1 }} />

      <div className="divider" />

      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={
            menu.kind === 'project'
              ? (() => { const p = projects.find((x) => x.id === menu.id); return p ? projectMenu(p) : []; })()
              : (() => { const c = chats.find((x) => x.id === menu.id); return c ? chatMenu(c) : []; })()
          }
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const run = confirm.run; setConfirm(null); run(); }}
        />
      )}

      <div className="side-footer">{mcp?.configured && (
        <div className={`mcp-row${mcp.error ? ' is-degraded' : ''}`}>
          <span className="status-dot" style={mcp.error ? { background: 'var(--danger)' } : { background: 'var(--good)' }} />
          <span className="status-text">{mcp.error ? 'Local MCP · unavailable' : `Local MCP · ${mcp.discovered ?? 0} tools`}</span>
        </div>
      )}<div className="status-row"><span className="status-dot" style={health.inferenceUp===false?{background:'var(--accent)'}:undefined}/><span className="status-text">{statusText(health)}</span></div><AccountMenu onSettings={onOpenSettings} onToggleTheme={onToggleTheme} theme={theme}/></div>
    </div>
  );
}
