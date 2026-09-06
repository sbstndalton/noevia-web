import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  createProject,
  deleteChat,
  deleteFreeChat,
  deleteProject,
  fetchChatHistory,
  fetchDiaryCorpus,
  fetchDiaryMonth,
  fetchDiarySource,
  fetchHealth,
  fetchInstalledModels,
  fetchProfile,
  fetchStats,
  fetchWorkspace,
  saveChatHistory,
  saveFreeChats,
  saveProjectConfig,
  saveProjectChats,
  streamChat,
} from './api';
import type {
  ChatMeta,
  DiaryCorpus,
  DiaryMonth,
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
import { InsightsView } from './components/InsightsView';
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

export default function App(): JSX.Element {
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [view, setView] = useState<View>(() => {
    if (sessionStorage.getItem('cowork-new-account')) { sessionStorage.removeItem('cowork-new-account'); return { kind: 'settings' }; }
    return { kind: 'projects' };
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeChats, setFreeChats] = useState<ChatMeta[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({ inferenceUp: null, diaryUp: null });
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [corpus, setCorpus] = useState<DiaryCorpus | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [diaryMonths, setDiaryMonths] = useState<DiaryMonth[]>([]);
  const [diaryScreen, setDiaryScreen] = useState<'picker' | 'month' | 'insights'>('picker'); // diary lands on the month picker (skipped for the first-run zero-state)
  const [diaryMonthId, setDiaryMonthId] = useState<string | null>(null); // null = today
  const [streaming, setStreaming] = useState(false);
  const [diaryOutcome, setDiaryOutcome] = useState<string | null>(null);

  // Diary first-run: on a fresh corpus the month list is empty and today's file
  // doesn't exist yet — land directly in the writing zero-state instead of the
  // month picker. Anything already in the corpus (returning user) keeps the
  // picker landing.
  useEffect(() => {
    if (view.kind !== 'diary') return;
    let stale = false;
    fetchDiarySource()
      .then((s) => {
        if (stale) return;
        setDiaryMonths(Array.isArray(s.months) ? s.months : []);
        if (Array.isArray(s.months) && s.months.length === 0) setDiaryScreen('month');
      })
      .catch(() => {
        if (!stale) setDiaryMonths([]);
      });
    return () => {
      stale = true;
    };
  }, [view.kind]);
  const [diaryBusy, setDiaryBusy] = useState(false);
  const [diaryEnabled, setDiaryEnabled] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const loadedChats = useRef<Set<string>>(new Set());
  const patchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // AbortController for the in-flight generation (chat or diary). Aborting
  // stops the client-side stream; the server's disconnect handling (Phase 1)
  // then terminates the upstream request.
  const streamAbort = useRef<AbortController | null>(null);
  const abortStream = useCallback(() => {
    streamAbort.current?.abort();
    streamAbort.current = null;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cowork-theme', theme);
  }, [theme]);

  // Switching chats/views away from an in-flight generation, or unmounting,
  // stops the stream — matching Claude-style chat UX where navigation ends
  // the current response rather than letting it keep streaming.
  useEffect(() => {
    return () => {
      streamAbort.current?.abort();
      streamAbort.current = null;
    };
  }, [view.kind, view.kind === 'chat' ? view.chatId : null, streamAbort]);

  const refreshModels = useCallback(() => {
    fetchInstalledModels()
      .then((list) => {
        setModels(list);
        setModelsError(null);
      })
      .catch(() => setModelsError('Model manager unavailable or disabled.'));
  }, []);

  const refreshProjects = useCallback(() => {
    fetchWorkspace()
      .then((w) => {
        setProjects(w.projects || []);
        setFreeChats(Array.isArray(w.freeChats) ? w.freeChats : []);
      })
      .catch(() => undefined);
  }, []);

  // One-time migration: fold any localStorage free-chats into the server list
  // (free chats used to live only in this browser), then retire the key.
  useEffect(() => {
    const raw = localStorage.getItem('cowork-free-chats');
    if (!raw) return;
    localStorage.removeItem('cowork-free-chats');
    let legacy: ChatMeta[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) legacy = parsed;
    } catch {
      /* ignore malformed */
    }
    if (legacy.length === 0) return;
    fetchWorkspace()
      .then((w) => {
        const server = Array.isArray(w.freeChats) ? w.freeChats : [];
        const known = new Set(server.map((c) => c.id));
        const merged = [...server, ...legacy.filter((c) => !known.has(c.id))].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        saveFreeChats(merged)
          .then(refreshProjects)
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, [refreshProjects]);

  useEffect(() => {
    refreshProjects();
    refreshModels();
    fetchProfile().then((profile) => setDiaryEnabled(profile.user.diaryEnabled)).catch(() => undefined);
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth({ inferenceUp: false, diaryUp: null }));
    // Re-poll health so an inference outage that starts mid-session surfaces
    // in the Chat/Diary warning banners instead of only failing on send.
    const t = setInterval(() => {
      fetchHealth().then(setHealth).catch(() => setHealth((prev) => ({ ...prev, inferenceUp: false })));
    }, 30_000);
    return () => clearInterval(t);
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

  // Diary tab: the corpus refetches when the selected month changes (null =
  // today). Writes always go to today.
  useEffect(() => {
    if (view.kind !== 'diary') return;
    fetchDiarySource()
      .then((s) => setDiaryMonths(Array.isArray(s.months) ? s.months : []))
      .catch(() => setDiaryMonths([]));
  }, [view.kind]);

  useEffect(() => {
    if (view.kind !== 'diary' || diaryScreen !== 'month') return;
    setCorpus(null);
    setCorpusError(null);
    const load = diaryMonthId ? fetchDiaryMonth(diaryMonthId) : fetchDiaryCorpus();
    load
      .then((c) => {
        setCorpus(c);
        setCorpusError(null);
      })
      .catch(() => setCorpusError('Could not reach the diary sidecar (read-only).'));
  }, [view.kind, diaryScreen, diaryMonthId]);

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
      const controller = new AbortController();
      streamAbort.current = controller;

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
        saveFreeChats([
          { id: chatId, title: text.slice(0, 80), updatedAt: Date.now() },
          ...freeChats,
        ])
          .then(() => refreshProjects())
          .catch(() => undefined);
      }

      try {
        let acc = '';
        let reasoning = '';
        const tools: { name: string; args: string }[] = [];
        for await (const ev of streamChat(
          {
            spaceId: projectId || 'free',
            message: text,
            history,
            projectId,
            chatId,
          },
          controller.signal,
        )) {
          if (ev.type === 'meta' && ev.route) {
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, senderLabel: `Assistant · Auto (${ev.route})` } : m)),
            }));
          } else if (ev.type === 'reasoning' && ev.text) {
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
          } else if (ev.type === 'tool_result' && ev.name) {
            tools.push({ name: `${ev.name} ✓`, args: (ev.text || '').slice(0, 120) });
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) =>
                m.id === replyId ? { ...m, toolCalls: [...tools] } : m,
              ),
            }));
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // User pressed Stop (or navigated away): keep what streamed in,
          // mark nothing as an error.
          setMessagesByChat((prev) => ({
            ...prev,
            [chatId]: (prev[chatId] ?? []).map((m) =>
              m.id === replyId && !m.content && !m.reasoning
                ? { ...m, content: '(generation stopped)', senderLabel: 'Stopped' }
                : m,
            ),
          }));
        } else {
          const detail = err instanceof Error ? err.message : 'unknown error';
          setMessagesByChat((prev) => ({
            ...prev,
            [chatId]: (prev[chatId] ?? []).map((m) =>
              m.id === replyId ? { ...m, content: `Request failed — ${detail}`, error: true } : m,
            ),
          }));
        }
      } finally {
        if (streamAbort.current === controller) streamAbort.current = null;
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

  // Retry a failed exchange: drop the failed assistant bubble and the user
  // message that triggered it, then re-send that same text. History rebuild
  // in handleSend excludes error messages, so nothing stale leaks in.
  const retryLast = useCallback(
    (chatId: string) => {
      if (streaming) return;
      const msgs = messagesByChat[chatId] ?? [];
      const errIdx = msgs.findIndex((m) => m.error);
      if (errIdx === -1) return;
      const failedText = msgs[errIdx - 1]?.role === 'user' ? msgs[errIdx - 1].content : null;
      if (!failedText) return;
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] ?? []).slice(0, errIdx - 1),
      }));
      void handleSend(chatId, view.kind === 'chat' ? view.projectId ?? activeChatMeta?.projectId ?? null : null, failedText);
    },
    [activeChatMeta, handleSend, messagesByChat, streaming, view],
  );

  const sendToDiary = useCallback(
    async (text: string) => {
      if (diaryBusy) return;
      setDiaryBusy(true);
      setDiaryOutcome(null);
      const controller = new AbortController();
      streamAbort.current = controller;
      try {
        let verdict = 'skipped';
        for await (const ev of streamChat({ spaceId: 'diary', message: text, history: [] }, controller.signal)) {
          if (ev.type === 'diary' && ev.decision) verdict = ev.decision;
        }
        setDiaryOutcome(verdict);
        // Refresh whatever view is open; new exchanges always land in today's file,
        // so jump the selector back to today to show the result.
        setDiaryScreen('month');
        setDiaryMonthId(null);
        fetchDiaryCorpus()
          .then((c) => setCorpus(c))
          .catch(() => undefined);
      } catch (err) {
        if (controller.signal.aborted) {
          setDiaryOutcome('stopped');
        } else {
          const detail = err instanceof Error ? err.message : 'unknown error';
          setDiaryOutcome(`error — ${detail}`);
        }
      } finally {
        if (streamAbort.current === controller) streamAbort.current = null;
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
      // Honor the setup wizard's "Auto Fast/Smart for new projects" preference.
      const defaultRouting =
        localStorage.getItem('cowork-default-routing') === 'auto' ? ('auto' as const) : undefined;
      const project = await createProject({ ...body, routing: defaultRouting });
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

  // Handles both project chats and free chats (projectId null).
  const handleDeleteChat = useCallback(
    (projectId: string | null, chatId: string) => {
      const req = projectId ? deleteChat(projectId, chatId) : deleteFreeChat(chatId);
      req
        .then(() => {
          loadedChats.current.delete(chatId);
          setMessagesByChat((prev) => {
            const next = { ...prev };
            delete next[chatId];
            return next;
          });
          if (projectId) setView({ kind: 'project', id: projectId });
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
      ...projects.slice(0, 3).map((p) => ({ task: p.name, model: p.model || '(loaded model)' })),
      ...(diaryEnabled ? [{ task: 'Diary app', model: 'sidecar pipeline' }] : []),
    ],
    [diaryEnabled, projects],
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
        onOpenChat={(chatId, projectId) => setView({ kind: 'chat', chatId, projectId })}
        onDeleteChat={(chatId) => handleDeleteChat(null, chatId)}
        onRenameProject={(id, name) => handlePatchProject(id, { name })}
        onDeleteProject={handleDeleteProject}
        onOpenDiary={() => setView({ kind: 'diary' })}
        diaryEnabled={diaryEnabled}
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
          chatId={view.chatId}
          title={activeChatMeta?.title ?? (view.projectId ? 'New task' : 'New chat')}
          projectName={activeProject?.name ?? null}
          modelLabel={
            activeProject?.routing === 'auto'
              ? 'Auto (Fast/Smart)'
              : activeProject?.model ?? models.find((m) => m.loaded)?.name ?? 'local model'
          }
          messages={messages}
          streaming={streaming}
          inferenceUp={health.inferenceUp}
          onSend={sendToCurrent}
          onRetry={retryLast}
          onStop={abortStream}
          onBack={activeProject ? () => setView({ kind: 'project', id: activeProject.id }) : null}
          onOpenModels={() => setPopupOpen(true)}
          onOpenSettings={() => setView({ kind: 'settings' })}
        />
      )}

      {view.kind === 'diary' && diaryEnabled && diaryScreen !== 'insights' && (
        <DiaryView
          corpus={corpus}
          corpusError={corpusError}
          months={diaryMonths}
          screen={diaryScreen}
          selectedMonthId={diaryMonthId}
          onOpenMonth={(id) => { setDiaryScreen('month'); setDiaryMonthId(id); }}
          onOpenInsights={() => setDiaryScreen('insights')}
          onBackToPicker={() => setDiaryScreen('picker')}
          onSelectMonth={setDiaryMonthId}
          onRefresh={() => {
            const load = diaryMonthId ? fetchDiaryMonth(diaryMonthId) : fetchDiaryCorpus();
            load.then((c) => setCorpus(c)).catch(() => undefined);
          }}
          modelLabel="pipeline"
          busy={diaryBusy}
          inferenceUp={health.inferenceUp}
          outcome={diaryOutcome}
          onSend={(text) => void sendToDiary(text)}
          onImported={(day) => {
            // An import lands on its own (possibly past) date: refresh the
            // month list, jump the month selector to the entry's month, and
            // refetch the corpus.
            fetchDiarySource()
              .then((s) => {
                setDiaryMonths(Array.isArray(s.months) ? s.months : []);
                if (day) {
                  const monthId = day.slice(0, 7);
                  if (Array.isArray(s.months) && s.months.some((m) => m.id === monthId)) setDiaryMonthId(monthId);
                }
              })
              .catch(() => undefined);
            fetchDiaryCorpus()
              .then((c) => setCorpus(c))
              .catch(() => undefined);
          }}
        />
      )}

      {view.kind === 'diary' && diaryEnabled && diaryScreen === 'insights' && (
        <InsightsView
          onBack={() => setDiaryScreen('picker')}
          onOpenMonth={(monthId) => { setDiaryScreen('month'); setDiaryMonthId(monthId); }}
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
          diaryEnabled={diaryEnabled}
          onDiaryEnabledChange={(enabled) => {
            setDiaryEnabled(enabled);
          }}
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
      {view.kind !== 'diary' && <StatsBar stats={stats} />}
      </div>
    </div>
  );
}
