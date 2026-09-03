import type { JSX } from 'react';
import type { ChatMeta, HealthState, Project } from '../types';
import {
  BookIcon,
  Logo,
  MoonIcon,
  PlusIcon,
  SlidersIcon,
  SunIcon,
} from './Icons';

interface SidebarProps {
  projects: Project[];
  chats: ChatMeta[];
  activeView: 'diary' | 'settings' | 'projects' | 'project' | 'chat';
  activeProjectId: string | null;
  activeChatId: string | null;
  onNewChat: () => void;
  onOpenProjects: () => void;
  onOpenProject: (id: string) => void;
  onOpenChat: (chatId: string, projectId: string | null) => void;
  onOpenDiary: () => void;
  onOpenSettings: () => void;
  health: HealthState;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

function statusText(health: HealthState): string {
  if (health.lemonadeUp) return 'Lemonade · local · online';
  if (health.lemonadeUp === false) return 'Lemonade · unreachable';
  return 'Lemonade · checking…';
}

export function Sidebar({
  projects,
  chats,
  activeView,
  activeProjectId,
  activeChatId,
  onNewChat,
  onOpenProjects,
  onOpenProject,
  onOpenChat,
  onOpenDiary,
  onOpenSettings,
  health,
  theme,
  onToggleTheme,
}: SidebarProps): JSX.Element {
  return (
    <div className="sidebar">
      <div className="side-logo">
        <Logo />
        <span>Cowork</span>
      </div>

      <button className="new-chat-btn" onClick={onNewChat} title="New chat">
        <PlusIcon />
        <span>New</span>
      </button>

      <div className="side-nav">
        <button
          className={`nav-item${activeView === 'projects' ? ' is-active' : ''}`}
          onClick={onOpenProjects}
        >
          <BookIcon />
          <span className="nav-name">Projects</span>
        </button>
        <button
          className={`nav-item${activeView === 'diary' ? ' is-active' : ''}`}
          onClick={onOpenDiary}
        >
          <span className="nav-emoji" role="img" aria-label="Diary">📔</span>
          <span className="nav-name">Diary</span>
        </button>
      </div>

      <div className="divider" />

      <div className="spaces">
        <div className="section-label">Projects</div>
        {projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item${activeProjectId === p.id && activeView !== 'projects' ? ' is-active' : ''}`}
            onClick={() => onOpenProject(p.id)}
          >
            <span className="nav-emoji" role="img" aria-label={p.name}>📁</span>
            <span className="nav-name">{p.name}</span>
          </button>
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
            {chats.slice(0, 8).map((c) => (
              <button
                key={c.id}
                className={`nav-item${activeChatId === c.id && activeView === 'chat' ? ' is-active' : ''}`}
                onClick={() => onOpenChat(c.id, c.projectId ?? null)}
                title={c.title}
              >
                <span className="nav-emoji" role="img" aria-label="chat">💬</span>
                <span className="nav-name">{c.title}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ flexGrow: 1 }} />

      <div className="side-footer">
        <button
          className="nav-item"
          onClick={onOpenSettings}
          style={activeView === 'settings' ? { background: 'var(--bg-active)' } : undefined}
        >
          <SlidersIcon />
          <span className="nav-name">Settings</span>
        </button>
        <button className="theme-row" onClick={onToggleTheme} title="Toggle light/dark theme">
          {theme === 'light' ? <SunIcon /> : <MoonIcon />}
          <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
        </button>
        <div className="status-row">
          <span
            className="status-dot"
            style={health.lemonadeUp === false ? { background: 'var(--accent)' } : undefined}
          />
          <span className="status-text">{statusText(health)}</span>
        </div>
      </div>
    </div>
  );
}
