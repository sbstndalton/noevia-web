import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  createProject,
  deleteChat,
  deleteProject,
  fetchChatHistory,
  fetchDiaryCorpus,
  fetchHealth,
  fetchInstalledModels,
  fetchStats,
  fetchWorkspace,
  saveChatHistory,
  saveProjectConfig,
  saveProjectChats,
  streamChat,
} from './api';
import type {
  ChatMeta,
  DiaryCorpus,
  HealthState,
  HistoryEntry,
  InstalledModel,
  LiveStats,
  Message,
  Project,
  ProjectFile,
} from './types';
import { ChatView } from './components/ChatView';
import { DiaryView } from './components/DiaryView';
import { ModelPopup } from './components/ModelPopup';
import { ProjectView } from './components/ProjectView';
import { ProjectsView } from './components/ProjectsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { StatsBar } from './components/StatsBar';

type View =
  | { kind: 'diary' }
  | { kind: 'settings' }
  | { kind: 'projects' }
  | { kind: 'project'; id: string }
  | { kind: 'chat'; chatId: string; projectId?: string | null };

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('cowork-theme');
  return stored === 'dark' ? 'dark' : 'light';
}

function loadFreeChats(): ChatMeta[] {
  try {
    const raw = JSON.parse(localStorage.getItem('cowork-free-chats') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export default function App(): JSX.Element {
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [view, setView] = useState<View>({ kind: 'projects' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeChats, setFreeChats] = useState<ChatMeta[]>(loadFreeChats);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({ lemonadeUp: null, diaryUp: null });
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [corpus, setCorpus] = useState<DiaryCorpus | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [diaryOutcome, setDiaryOutcome] = useState<string | null>(null);
  const [diaryBusy, setDiaryBusy] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const loadedChats = useRef<Set<string>>(new Set());
  const patchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cowork-theme', theme);
  }, [theme]);

  const refreshModels = useCallback(() => {
    fetchInstalledModels()
      .then((list) => {
        setModels(list);
        setModelsError(null);
      })
      .catch(() => setModelsError('Lemonade unreachable — is the stack up?'));
  }, []);

  const refreshProjects = useCallback(() => {
    fetchWorkspace()
      .then((w) => setProjects(w.projects || []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshProjects();
    refreshModels();
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth({ lemonadeUp: false, diaryUp: null }));
  }, [refreshModels, refreshProjects]);

  // Live engine stats — the bottom bar refreshes in near-real-time.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchStats()
        .then((s) => alive && setStats(s))
        .catch(() => alive && setStats((prev) => (prev ? { ...prev, up: false } : prev)));
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (view.kind !== 'diary') return;
    setCorpus(null);
    setCorpusError(null);
    fetchDiaryCorpus()
      .then((c) => {
        setCorpus(c);
        setCorpusError(null);
      })
      .catch(() => setCorpusError('Could not reach the diary sidecar (read-only).'));
  }, [view.kind]);

  // Lazily load a chat's persisted history when it is opened.
  useEffect(() => {
    if (view.kind !== 'chat') return;
    const id = view.chatId;
    if (loadedChats.current.has(id)) return;
    loadedChats.current.add(id);
    fetchChatHistory(id)
      .then((history) => {
        setMessagesByChat((prev) => ({
          ...prev,
          [id]: history.map((h) => ({
            id: uid(),
            role: h.role,
            content: h.content,
            senderLabel: h.model,
          })),
        }));
      })
      .catch(() => undefined);
  }, [view]);

  const allChats: ChatMeta[] = useMemo(() => {
    const fromProjects = projects.flatMap((p) =>
      (p.chats || []).map((c) => ({ ...c, projectId: p.id })),
    );
    return [...fromProjects, ...freeChats].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [projects, freeChats]);

  const activeChatMeta = view.kind === 'chat' ? allChats.find((c) => c.id === view.chatId) ?? null : null;
  const activeProject =
    view.kind === 'project'
      ? projects.find((p) => p.id === view.id) ?? null
      : view.kind === 'chat' && view.projectId
        ? projects.find((p) => p.id === view.projectId) ?? null
        : activeChatMeta?.projectId
          ? projects.find((p) => p.id === activeChatMeta.projectId) ?? null
          : null;

  const messages: Message[] = view.kind === 'chat' ? messagesByChat[view.chatId] ?? [] : [];

  const persist = useCallback((chatId: string, msgs: Message[]) => {
    saveChatHistory(
      chatId,
      msgs
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content, model: m.senderLabel })),
    ).catch(() => undefined);
  }, []);

  const handleSend = useCallback(
    async (chatId: string, projectId: string | null, text: string) => {
      if (streaming) return;
      const userMsg: Message = { id: uid(), role: 'user', content: text };
      let history: HistoryEntry[] = [];
      setMessagesByChat((prev) => {
        const existing = prev[chatId] ?? [];
        history = existing
          .filter((m) => !m.error)
          .map((m) => ({ role: m.role, content: m.content }));
        return { ...prev, [chatId]: [...existing, userMsg] };
      });
      const replyId = uid();
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: [
          ...(prev[chatId] ?? []),
          { id: replyId, role: 'assistant', content: '', reasoning: '', toolCalls: [] },
        ],
      }));
      setStreaming(true);

      // Register the chat in its project (or the free-chats list) on first send.
      if (projectId) {
        const project = projects.find((p) => p.id === projectId);
        if (project && !(project.chats || []).some((c) => c.id === chatId)) {
          const nextChats = [
            { id: chatId, title: text.slice(0, 80), updatedAt: Date.now() },
            ...(project.chats || []),
          ];
          saveProjectChats(projectId, nextChats)
            .then(() => refreshProjects())
            .catch(() => undefined);
        }
      } else if (!freeChats.some((c) => c.id === chatId)) {
        const next = [{ id: chatId, title: text.slice(0, 80), updatedAt: Date.now(), projectId: null }, ...freeChats];
        setFreeChats(next);
        localStorage.setItem('cowork-free-chats', JSON.stringify(next));
      }

      try {
        let acc = '';
        let reasoning = '';
        const tools: { name: string; args: string }[] = [];
        for await (const ev of streamChat({
          spaceId: projectId || 'free',
          message: text,
          history,
          projectId,
          chatId,
        })) {
          if (ev.type === 'reasoning' && ev.text) {
            reasoning += ev.text;
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, reasoning } : m)),
            }));
          } else if (ev.type === 'delta' && ev.text) {
            acc += ev.text;
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, content: acc } : m)),
            }));
          } else if (ev.type === 'tool') {
            tools.push({ name: ev.name || 'tool', args: ev.args || '' });
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) =>
                m.id === replyId ? { ...m, toolCalls: [...tools] } : m,
              ),
            }));
          }
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown error';
        setMessagesByChat((prev) => ({
          ...prev,
          [chatId]: (prev[chatId] ?? []).map((m) =>
            m.id === replyId ? { ...m, content: `Request failed — ${detail}`, error: true } : m,
          ),
        }));
      } finally {
        setStreaming(false);
        setMessagesByChat((prev) => {
          const msgs = prev[chatId] ?? [];
          persist(chatId, msgs);
          return prev;
        });
      }
    },
    [freeChats, persist, projects, streaming],
  );

  const sendToCurrent = useCallback(
    (text: string) => {
      if (view.kind !== 'chat') return;
      const chatId = view.chatId;
      const projectId = view.projectId ?? activeChatMeta?.projectId ?? null;
      void handleSend(chatId, projectId, text);
    },
    [activeChatMeta, handleSend, view],
  );

  const sendToDiary = useCallback(
    async (text: string) => {
      if (diaryBusy) return;
      setDiaryBusy(true);
      setDiaryOutcome(null);
      try {
        let verdict = 'skipped';
        for await (const ev of streamChat({ spaceId: 'diary', message: text, history: [] })) {
          if (ev.type === 'diary' && ev.decision) verdict = ev.decision;
        }
        setDiaryOutcome(verdict);
        fetchDiaryCorpus()
          .then((c) => setCorpus(c))
          .catch(() => undefined);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown error';
        setDiaryOutcome(`error — ${detail}`);
      } finally {
        setDiaryBusy(false);
      }
    },
    [diaryBusy],
  );

  const startFreeChat = useCallback(() => {
    const chatId = `c-${uid()}`;
    setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }));
    setView({ kind: 'chat', chatId, projectId: null });
  }, []);

  const startProjectChat = useCallback(
    (projectId: string) => {
      const chatId = `c-${uid()}`;
      setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }));
      setView({ kind: 'chat', chatId, projectId });
    },
    [],
  );

  const handleCreateProject = useCallback(
    async (body: { name: string; goal: string; instructions: string; files: ProjectFile[] }) => {
      const project = await createProject(body);
      refreshProjects();
      setView({ kind: 'project', id: project.id });
    },
    [refreshProjects],
  );

  const handleDeleteProject = useCallback(
    (id: string) => {
      deleteProject(id)
        .then(() => {
          refreshProjects();
          setView({ kind: 'projects' });
        })
        .catch(() => undefined);
    },
    [refreshProjects],
  );

  const handleDeleteChat = useCallback(
    (projectId: string, chatId: string) => {
      deleteChat(projectId, chatId)
        .then(() => {
          loadedChats.current.delete(chatId);
          setMessagesByChat((prev) => {
            const next = { ...prev };
            delete next[chatId];
            return next;
          });
          setView({ kind: 'project', id: projectId });
          refreshProjects();
        })
        .catch(() => undefined);
    },
    [refreshProjects],
  );

  // Rail edits are debounced per project so typing doesn't hammer projects.json.
  const handlePatchProject = useCallback(
    (projectId: string, patch: Partial<Project>) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, ...patch, updatedAt: Date.now() } : p)),
      );
      if (patchTimers.current[projectId]) clearTimeout(patchTimers.current[projectId]);
      patchTimers.current[projectId] = setTimeout(() => {
        const p = projects.find((x) => x.id === projectId);
        if (!p) return;
        saveProjectConfig(projectId, patch)
          .then(() => refreshProjects())
          .catch(() => undefined);
        void p;
      }, 600);
    },
    [projects, refreshProjects],
  );

  const routes = useMemo(
    () => [
      ...projects.slice(0, 3).map((p) => ({ task: p.name, model: p.model })),
      { task: 'Diary tab', model: 'sidecar pipeline' },
    ],
    [projects],
  );

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        chats={allChats}
        activeView={view.kind}
        activeProjectId={activeProject?.id ?? null}
        activeChatId={view.kind === 'chat' ? view.chatId : null}
        onNewChat={startFreeChat}
        onOpenProjects={() => setView({ kind: 'projects' })}
        onOpenProject={(id) => setView({ kind: 'project', id })}
        onOpenDiary={() => setView({ kind: 'diary' })}
        onOpenSettings={() => setView({ kind: 'settings' })}
        health={health}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />

      <div className="app-stack">
      <div className="app-main">

      {view.kind === 'projects' && (
        <ProjectsView
          projects={projects}
          onOpenProject={(id) => setView({ kind: 'project', id })}
          onCreate={handleCreateProject}
          onDelete={handleDeleteProject}
        />
      )}

      {view.kind === 'project' && activeProject && (
        <ProjectView
          project={activeProject}
          onNewChat={startProjectChat}
          onOpenChat={(_projectId, chatId) => setView({ kind: 'chat', chatId, projectId: _projectId })}
          onPatch={handlePatchProject}
          onDeleteChat={handleDeleteChat}
        />
      )}

      {view.kind === 'chat' && (
        <ChatView
          title={activeChatMeta?.title ?? (view.projectId ? 'New task' : 'New chat')}
          projectName={activeProject?.name ?? null}
          modelLabel={activeProject?.model ?? models.find((m) => m.loaded)?.name ?? 'local model'}
          messages={messages}
          streaming={streaming}
          onSend={sendToCurrent}
          onBack={activeProject ? () => setView({ kind: 'project', id: activeProject.id }) : null}
          onOpenModels={() => setPopupOpen(true)}
          onOpenSettings={() => setView({ kind: 'settings' })}
        />
      )}

      {view.kind === 'diary' && (
        <DiaryView
          corpus={corpus}
          corpusError={corpusError}
          modelLabel="pipeline"
          busy={diaryBusy}
          outcome={diaryOutcome}
          onSend={(text) => void sendToDiary(text)}
        />
      )}

      {view.kind === 'settings' && (
        <SettingsView
          models={models}
          routes={routes}
          modelsError={modelsError}
          projects={projects}
          health={health}
          stats={stats}
          onOpenModels={() => setPopupOpen(true)}
        />
      )}

      {popupOpen && (
        <ModelPopup
          projects={projects}
          activeProject={activeProject}
          onClose={() => setPopupOpen(false)}
          onProjectsChanged={() => {
            refreshProjects();
            refreshModels();
          }}
        />
      )}

      </div>
      {view.kind !== 'diary' && <StatsBar />}
      </div>
    </div>
  );
}
