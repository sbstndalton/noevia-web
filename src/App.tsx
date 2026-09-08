import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  createProject,
  deleteChat,
  deleteFreeChat,
  deleteProject,
  fetchChatHistory,
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
  HealthState,
  HistoryEntry,
  InstalledModel,
  LiveStats,
  Message,
  Project,
  ProjectFile,
  ToolCallView,
} from './types';
import { ChatView } from './components/ChatView';
import { DiaryView } from './components/DiaryView';
import { ModelPopup } from './components/ModelPopup';
import { ProjectView } from './components/ProjectView';
import { ProjectsView } from './components/ProjectsView';
import { SettingsShell } from './components/SettingsShell';
import { CodingWorkspace } from './components/CodingWorkspace';
import { FeaturePreview } from './components/PreviewPanel';
import { Sidebar } from './components/Sidebar';
import { StatsBar } from './components/StatsBar';

type View =
  | { kind: 'diary' }
  | { kind: 'preview'; title: string }
  | { kind: 'projects' }
  | { kind: 'project'; id: string }
  | { kind: 'chat'; chatId: string; projectId?: string | null };

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('cowork-theme');
  return stored === 'light' ? 'light' : 'dark';
}

export default function App(): JSX.Element {
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [settingsOpen, setSettingsOpen] = useState(() => { const fresh = !!sessionStorage.getItem('cowork-new-account'); sessionStorage.removeItem('cowork-new-account'); return fresh; });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [appMode, setAppMode] = useState<'chat'|'code'>('chat');
  const [view, setView] = useState<View>({ kind: 'projects' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeChats, setFreeChats] = useState<ChatMeta[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({ inferenceUp: null, diaryUp: null });
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [streaming, setStreaming] = useState(false);
  const messagesRef = useRef(messagesByChat);
  messagesRef.current = messagesByChat;
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c0e12' : '#F5F6F9');
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
            reasoning: h.reasoning,
            toolCalls: h.toolCalls,
            stats: h.stats,
          })),
        }));
      })
      .catch(() => undefined);
  }, [view]);

  const allChats: ChatMeta[] = useMemo(() => {
    // Spreading a malformed entry (a bare chat-id string) yields a record with
    // no title, which throws downstream and blanks the app. The server
    // sanitizes these, but never render-crash on data we did not write.
    const fromProjects = projects.flatMap((p) =>
      (p.chats || [])
        .filter((c): c is ChatMeta => !!c && typeof c === 'object' && typeof c.id === 'string')
        .map((c) => ({ ...c, projectId: p.id })),
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
        // Reasoning, tool activity and cost are persisted too, so reopening a
        // chat shows the same thinking block and stats it had while streaming
        // instead of a bare answer. The server strips these before replaying
        // history to a model, so they cost nothing in prompt tokens.
        .map((m) => ({
          role: m.role,
          content: m.content,
          model: m.senderLabel,
          reasoning: m.reasoning || undefined,
          toolCalls: m.toolCalls && m.toolCalls.length ? m.toolCalls : undefined,
          stats: m.stats,
        })),
    ).catch(() => undefined);
  }, []);

  const handleSend = useCallback(
    async (chatId: string, projectId: string | null, text: string, base?: Message[]) => {
      if (streaming) return;
      const userMsg: Message = { id: uid(), role: 'user', content: text };
      const existing = base ?? messagesRef.current[chatId] ?? [];
      const history: HistoryEntry[] = existing.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
      setMessagesByChat(prev => ({ ...prev, [chatId]: [...existing, userMsg] }));
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

      const startedAt = Date.now();
      try {
        let acc = '';
        let reasoning = '';
        const tools: ToolCallView[] = [];
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
            // One tool call arrives as many deltas (the name once, then the
            // arguments a few characters at a time). The server sends the
            // accumulated state keyed by index, so slot it in rather than
            // appending — appending rendered one chip per delta, most of them
            // nameless with a fragment of JSON for arguments.
            const at = typeof ev.index === 'number' ? ev.index : tools.length;
            tools[at] = { name: ev.name || 'tool', args: ev.args || '', status: 'running' };
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) =>
                m.id === replyId ? { ...m, toolCalls: tools.filter(Boolean).map((t) => ({ ...t })) } : m,
              ),
            }));
          } else if (ev.type === 'tool_pending') {
            // A write tool is waiting on the user. The stream stays open, so
            // the chip becomes an approve/deny prompt in place rather than the
            // reply appearing to stall for no reason.
            const at = typeof ev.index === 'number' ? ev.index : Math.max(0, tools.length - 1);
            tools[at] = {
              name: ev.name || 'tool',
              args: ev.args || '',
              status: 'pending',
              approvalId: ev.id,
            };
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) =>
                m.id === replyId ? { ...m, toolCalls: tools.filter(Boolean).map((t) => ({ ...t })) } : m,
              ),
            }));
          } else if (ev.type === 'usage') {
            const stats = {
              promptTokens: ev.promptTokens,
              completionTokens: ev.completionTokens,
              totalTokens: ev.totalTokens,
              tokensPerSecond: ev.tokensPerSecond,
              elapsedMs: Date.now() - startedAt,
            };
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, stats } : m)),
            }));
          } else if (ev.type === 'error') {
            throw new Error(ev.text || 'Generation failed');
          } else if (ev.type === 'tool_result' && ev.name) {
            // Mark the call that produced it as complete rather than adding a
            // second chip for the same call. This also clears any 'pending'
            // state, so an approved or refused call stops offering buttons
            // that would now 404.
            const done = tools.findIndex((t) => t && t.name === ev.name);
            const denied = (ev.text || '').startsWith('ERROR: the user');
            const chip = {
              name: `${ev.name} ${denied ? '⃠' : '✓'}`,
              args: (ev.text || '').slice(0, 120),
              status: denied ? ('denied' as const) : ('done' as const),
            };
            if (done >= 0) tools[done] = chip; else tools.push(chip);
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) =>
                m.id === replyId ? { ...m, toolCalls: tools.filter(Boolean).map((t) => ({ ...t })) } : m,
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
  const retryLast = useCallback((chatId: string, messageId: string) => {
    if (streaming) return;
    const msgs = messagesRef.current[chatId] ?? [];
    const index = msgs.findIndex(m => m.id === messageId && m.error);
    // Retry is offered only for the final exchange. Never truncate later history.
    if (index !== msgs.length - 1 || index < 1 || msgs[index - 1].role !== 'user') return;
    const projectId = view.kind === 'chat' ? view.projectId ?? activeChatMeta?.projectId ?? null : null;
    void handleSend(chatId, projectId, msgs[index - 1].content, msgs.slice(0, index - 1));
  }, [activeChatMeta, handleSend, streaming, view]);

  // Edit an earlier message and re-run the conversation from that point.
  // Everything after the edited message is dropped rather than kept as dead
  // context: the point is to correct the prompt that led somewhere wrong, so
  // paying to re-send the wrong turns (and letting the model keep reading
  // them) would defeat it. The truncated tail is gone — same trade the
  // "edit" affordance makes in ChatGPT/Claude.
  const editAndResend = useCallback(
    (chatId: string, messageId: string, nextText: string) => {
      if (streaming) return;
      const msgs = messagesRef.current[chatId] ?? [];
      const index = msgs.findIndex((m) => m.id === messageId);
      if (index < 0 || msgs[index].role !== 'user') return;
      const text = nextText.trim();
      if (!text) return;
      const projectId =
        view.kind === 'chat' ? view.projectId ?? activeChatMeta?.projectId ?? null : null;
      void handleSend(chatId, projectId, text, msgs.slice(0, index));
    },
    [activeChatMeta, handleSend, streaming, view],
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
      <div className="regular-workspace" style={{display:appMode==='chat'?'contents':'none'}}>
      <Sidebar
        onEnterCode={() => setAppMode('code')}
        onPreview={(title) => setView({kind:'preview',title})}
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
        onOpenSettings={() => setSettingsOpen(true)}
        health={health}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />

      <div className="app-stack">
      <div className="app-main">

      {view.kind === 'preview' && <FeaturePreview title={view.title}/> }
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
          onEditMessage={editAndResend}
          streaming={streaming}
          inferenceUp={health.inferenceUp}
          onSend={sendToCurrent}
          onRetry={retryLast}
          onStop={abortStream}
          onBack={activeProject ? () => setView({ kind: 'project', id: activeProject.id }) : null}
          onOpenModels={() => setPopupOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {diaryEnabled && <div className="diary-mount" style={{ display: view.kind === 'diary' ? 'contents' : 'none' }}><DiaryView inferenceUp={health.inferenceUp} /></div>}

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
      {view.kind !== 'diary' && <button className="inspector-toggle" aria-expanded={inspectorOpen} aria-controls="noevia-inspector" aria-label={inspectorOpen?'Close context inspector':'Open context inspector'} onClick={()=>setInspectorOpen(!inspectorOpen)}>☷</button>}
      {view.kind !== 'diary' && inspectorOpen && <aside id="noevia-inspector" className="noevia-inspector"><h2>Context & models</h2><h3>AI parameters</h3><p>Routing: {activeProject?.routing === 'auto'?'Auto · Fast / Smart':'Manual'}</p><p>Model: {activeProject?.model || models.find(m=>m.loaded)?.name || 'Not selected'}</p><button onClick={()=>setPopupOpen(true)}>Configure models & routing</button><h3>Linked knowledge</h3>{activeProject ? <><p>{activeProject.name}</p>{activeProject.files.length ? <ul>{activeProject.files.map((file,i)=><li key={i}>{file.name}</li>)}</ul>:<p>No knowledge files linked.</p>}<p>{activeProject.memories.length} saved memories</p></>:<p>Open a project to see its linked knowledge and memories.</p>}</aside>}
      </div>
      {appMode === 'code'  && <CodingWorkspace onExit={() => setAppMode('chat')} onSettings={() => setSettingsOpen(true)} theme={theme} onToggleTheme={() => setTheme(t=>t==='light'?'dark':'light')}/>}
      {settingsOpen && (
        <SettingsShell
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onTheme={setTheme}
          models={models}
          routes={routes}
          modelsError={modelsError}
          projects={projects}
          health={health}
          stats={stats}
          onOpenModels={() => { setSettingsOpen(false); setAppMode('chat'); setPopupOpen(true); }}
          diaryEnabled={diaryEnabled}
          onDiaryEnabledChange={(enabled) => {
            setDiaryEnabled(enabled);
          }}
        />
      )}

    </div>
  );
}
