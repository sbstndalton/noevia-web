import { titleAfterSend } from './chat-title';
import { ShellIcon } from './components/ShellIcon';
import { sourceRefresher } from './source-refresh';
import { sourceRefreshIssues } from './source-status';
import { useAppearance } from './useAppearance';
import { useWorkspaceChanged } from './components/data/workspace-changed';
import { useGlobalShortcuts, OPEN_SEARCH } from './components/shortcuts/useGlobalShortcuts';
import { ShortcutsDialog } from './components/shortcuts/ShortcutsDialog';
import { notifyIfAway } from './components/notifications/notify';
import { useModelsChanged } from './models-changed';
import { modelChoiceLabel } from './model-guidance';
import { TOOL_RESULT_LIMIT } from './components/ToolCalls';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  createProject,
  deleteChat,
  deleteFreeChat,
  deleteProject,
  fetchChatHistoryRevision,
  fetchHealth,
  fetchInstalledModels,
  fetchProfile,
  fetchStats,
  fetchWorkspace,
  saveChatHistory,
  saveFreeChats,
  saveProjectConfig,
  syncProjectSources,
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
import { ModelPopup } from './components/ModelPopup';
import { ProjectView } from './components/ProjectView';
import { Coding, Diary, ModelManager, Projects, Settings, prefetchViewsWhenIdle } from './lazy-views';
import type { SettingsSection } from './components/SettingsShell';
import { FeaturePreview } from './components/PreviewPanel';
import { useFeatureFlags } from './components/features/useFeatureFlags';
import { Sidebar } from './components/Sidebar';
import { EditProjectModal } from './components/EditProjectModal';
import { Inspector } from './components/Inspector';
import { StatsBar } from './components/StatsBar';
import { settleToolCalls } from './tool-call-state';
import { mergeTranscripts } from './transcript-merge';
import { readLastPlace, writeLastPlace, clearLastPlace } from './last-view';

type View =
  | { kind: 'diary' }
  | { kind: 'preview'; title: string }
  | { kind: 'projects' }
  | { kind: 'models'; model?: string }
  | { kind: 'project'; id: string }
  | { kind: 'chat'; chatId: string; projectId?: string | null };

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App(): JSX.Element {
  const {theme,preference,setTheme,setPreference,appearanceStatus,appearanceError,retryAppearance} = useAppearance();
  const [settingsSection,setSettingsSection] = useState<string>(() => readLastPlace()?.settings ?? 'general');
  // Each open is a fresh Settings: reopening while the last one is still animating out replaces it.
  const [settingsKey, setSettingsKey] = useState(0);
  const openSettings = (section: SettingsSection = 'general') => { setSettingsSection(section); setSettingsKey((k) => k + 1); setAppMode('chat'); setSettingsOpen(true); };
  // `model` opens that model's tuning view directly; without it, the model list.
  const openModelManager = (model?: string) => { setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'models', model }); };
  useEffect(() => { const open = (e: Event) => { const model = (e as CustomEvent<{ model?: string }>).detail?.model; setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'models', model }); }; window.addEventListener('noevia:open-model-settings', open); return () => window.removeEventListener('noevia:open-model-settings', open); }, []);
  const [settingsOpen, setSettingsOpen] = useState(() => { const fresh = !!sessionStorage.getItem('cowork-new-account'); sessionStorage.removeItem('cowork-new-account'); return fresh || !!readLastPlace()?.settings; });
  const [appMode, setAppMode] = useState<'chat'|'code'>('chat');
  // The Code workspace is a lazy chunk. Hiding the chat the moment Code was chosen left a
  // blank page until the chunk resolved (user review, 2026-09-18), so the chat stays on
  // screen until the Code workspace has mounted, and the two swap before paint.
  const [codeShown, setCodeShown] = useState(false);
  useEffect(() => { if (appMode !== 'code') setCodeShown(false); }, [appMode]);
  const featureFlags = useFeatureFlags();
  const showPreviews = featureFlags.previews === true;
  // Turning previews off while in Code must not leave both workspaces hidden.
  useEffect(() => { if (!showPreviews && appMode === 'code') setAppMode('chat'); }, [showPreviews, appMode]);
  // Reload lands where you left off, not on a new chat. `restored` is kept so the
  // workspace load below can drop a reference to something that no longer exists.
  const restored = useRef(readLastPlace());
  const [view, setView] = useState<View>(() => restored.current?.view ?? { kind: 'chat', chatId: `c-${uid()}`, projectId: null });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeChats, setFreeChats] = useState<ChatMeta[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const pendingFirstSend = useRef<{ chatId: string; projectId: string | null; text: string } | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({ inferenceUp: null, diaryUp: null });
  const [stats, setStats] = useState<LiveStats | null>(null);
  // Per chat, not global. A generation now continues while you look at
  // something else, so "is something streaming" is only ever a question about
  // a particular chat — and one chat working must not lock the composer of
  // another.
  const [streamingChats, setStreamingChats] = useState<Record<string, true>>({});
  const messagesRef = useRef(messagesByChat);
  messagesRef.current = messagesByChat;
  const [diaryEnabled, setDiaryEnabled] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const loadedChats = useRef<Set<string>>(new Set(view.kind === 'chat' ? [view.chatId] : []));
  const patchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingPatches = useRef<Record<string, Partial<Project>>>({});
  const lastSourceSync = useRef<Record<string, number>>({});
  const pendingSourceSync = useRef(new Set<string>());
  // AbortController for the in-flight generation (chat or diary). Aborting
  // stops the client-side stream; the server's disconnect handling (Phase 1)
  // then terminates the upstream request.
  const streamAbort = useRef<Record<string, AbortController>>({});
  const sendingChats = useRef<Set<string>>(new Set());
  const historyRevisions = useRef<Record<string, string | null>>({});
  const historySaves = useRef<Record<string, Promise<void>>>({});
  const abortStream = useCallback((chatId: string) => {
    streamAbort.current[chatId]?.abort();
    delete streamAbort.current[chatId];
  }, []);



  // Navigating away used to abort the generation, so stepping into another
  // chat mid-answer threw the answer away — you came back to nothing and had
  // to ask again. A reply now runs to completion wherever you are, and is
  // waiting when you return. Only leaving the app entirely cancels, because
  // nothing is left to receive the result.
  useEffect(() => {
    const controllers = streamAbort.current;
    return () => {
      for (const c of Object.values(controllers)) c.abort();
    };
  }, [streamAbort]);

  const refreshModels = useCallback(() => {
    fetchInstalledModels()
      .then((list) => {
        setModels(list);
        setModelsLoaded(true);
        setModelsError(null);
      })
      .catch(() => setModelsError('Model manager unavailable or disabled.'));
  }, []);

  // Settings can download, register, rename, delete, load or unload a model.
  // The chat's own list is fetched once at start-up, so without this the header
  // and model picker kept showing the pre-change set until a reload.
  useModelsChanged(refreshModels);

  const refreshProjects = useCallback(() => {
    return fetchWorkspace()
      .then((w) => {
        setProjects((w.projects || []).map((p) => ({ ...p, ...pendingPatches.current[p.id] })));
        setFreeChats(Array.isArray(w.freeChats) ? w.freeChats : []);
        setWorkspaceLoaded(true);
      })
      .catch(() => undefined);
  }, []);
  useWorkspaceChanged(refreshProjects);

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
    fetchProfile().then((profile) => {
      setDiaryEnabled(profile.user.diaryEnabled);
      setAccountId(profile.user.id);
      // A different account on this browser starts on its own fresh chat rather
      // than on a reference it cannot load.
      if (restored.current && restored.current.user && restored.current.user !== profile.user.id) {
        restored.current = null;
        clearLastPlace();
        setSettingsOpen(false);
        setView({ kind: 'chat', chatId: `c-${uid()}`, projectId: null });
      }
    }).catch(() => undefined);
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth({ inferenceUp: false, diaryUp: null }));
    // Re-poll health so an inference outage that starts mid-session surfaces
    // in the Chat/Diary warning banners instead of only failing on send.
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      fetchHealth().then(setHealth).catch(() => setHealth((prev) => ({ ...prev, inferenceUp: false })));
    }, 30_000);
    return () => clearInterval(t);
  }, [refreshModels, refreshProjects]);

  useEffect(() => prefetchViewsWhenIdle(), []);

  // Remember where you are, so a reload returns here. `preview` is skipped: an
  // unbuilt surface is not somewhere to come back to.
  useEffect(() => {
    if (view.kind === 'preview') return;
    writeLastPlace({ user: accountId, view, settings: settingsOpen ? settingsSection : null });
  }, [view, settingsOpen, settingsSection, accountId]);

  // A restored project or project chat that no longer exists (deleted on another
  // device, or archived) would otherwise render an empty shell with no way back.
  useEffect(() => {
    const place = restored.current;
    if (!place || !workspaceLoaded) return;
    restored.current = null;
    const projectExists = (id: string) => projects.some((p) => p.id === id);
    const stale =
      (place.view.kind === 'project' && !projectExists(place.view.id)) ||
      (place.view.kind === 'chat' && !!place.view.projectId && !projectExists(place.view.projectId));
    if (stale) setView({ kind: 'chat', chatId: `c-${uid()}`, projectId: null });
  }, [workspaceLoaded, projects]);

  // Live engine stats — the bottom bar refreshes in near-real-time while the
  // tab is visible; a background tab stops polling and catches up on return.
  useEffect(() => {
    let alive = true, pending = false;
    const tick = () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      void fetchStats()
        // The engine gauge reports nothing between requests on some backends; keep the
        // last provider-reported rate instead of blanking a number the user just saw.
        .then((s) => alive && setStats((prev) => ({ ...s, tokensPerSecond: s.tokensPerSecond ?? prev?.tokensPerSecond ?? null })))
        .catch(() => alive && setStats((prev) => (prev ? { ...prev, up: false, mtp: [] } : prev)))
        .finally(() => { pending = false; });
    };
    tick();
    const t = setInterval(tick, 2500);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  // Lazily load a chat's persisted history when it is opened.
  useEffect(() => {
    if (view.kind !== 'chat') return;
    const id = view.chatId;
    if (loadedChats.current.has(id)) return;
    loadedChats.current.add(id);
    fetchChatHistoryRevision(id)
      .then(({ history, revision }) => {
        historyRevisions.current[id] = revision;
        setMessagesByChat((prev) => ({
          ...prev,
          [id]: history.map((h) => ({
            id: uid(),
            role: h.role,
            content: h.content,
            senderLabel: h.model,
            reasoning: h.reasoning,
            toolCalls: settleToolCalls(h.toolCalls),
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

  // Only the open project is refreshed; hidden/offline tabs and active inference wait.
  const sourceProjectId = activeProject?.id;
  const sourceFolderKey = (activeProject?.sourceFolders || []).join('\n');
  const sourceBusy = !!activeProject?.chats.some(chat => streamingChats[chat.id]);
  useEffect(() => {
    if (!sourceProjectId || !sourceFolderKey) return;
    const watcher = sourceRefresher({
      key: `${sourceProjectId}:${sourceFolderKey}`, attempts: lastSourceSync.current,
      pending: pendingSourceSync.current,
      available: () => document.visibilityState === 'visible' && navigator.onLine && !sourceBusy,
      refresh: () => syncProjectSources(sourceProjectId),
      updated: result => {
        if (result.skipped.length) setProjectError(sourceRefreshIssues(result.skipped));
        void refreshProjects();
      },
      failed: error => setProjectError(`Sources could not be refreshed — ${error instanceof Error ? error.message : 'storage unavailable'}.`),
    });
    const revisit = () => { void watcher.run(); };
    revisit();
    const timer = window.setInterval(() => { void watcher.run(5 * 60000); }, 60000);
    window.addEventListener('focus', revisit);
    window.addEventListener('online', revisit);
    document.addEventListener('visibilitychange', revisit);
    return () => {
      watcher.dispose(); window.clearInterval(timer);
      window.removeEventListener('focus', revisit); window.removeEventListener('online', revisit);
      document.removeEventListener('visibilitychange', revisit);
    };
  }, [sourceProjectId, sourceFolderKey, sourceBusy, refreshProjects]);

  const messages: Message[] = view.kind === 'chat' ? messagesByChat[view.chatId] ?? [] : [];

  const persist = useCallback((chatId: string, msgs: Message[]) => {
    // Reasoning, tool activity and cost are persisted too, so reopening a
    // chat shows the same thinking block and stats it had while streaming
    // instead of a bare answer. The server strips these before replaying
    // history to a model, so they cost nothing in prompt tokens.
    const entries: HistoryEntry[] = msgs.filter((m) => !m.error).map((m) => ({
      role: m.role,
      content: m.content,
      model: m.senderLabel,
      reasoning: m.reasoning || undefined,
      toolCalls: m.toolCalls && m.toolCalls.length ? m.toolCalls : undefined,
      stats: m.stats,
    }));
    // Saves for one chat run in order. If another device saved first, merge its copy with ours
    // (nothing either side wrote is dropped), show the merged transcript, and save that.
    const run = async () => {
      let next = entries;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await saveChatHistory(chatId, next, historyRevisions.current[chatId]);
        if (result.ok) { historyRevisions.current[chatId] = result.revision; return; }
        const merged = mergeTranscripts(result.conflict.history, next);
        historyRevisions.current[chatId] = result.conflict.revision;
        if (merged !== next) {
          next = merged;
          setMessagesByChat((prev) => ({ ...prev, [chatId]: merged.map((h) => ({ id: uid(), role: h.role, content: h.content, senderLabel: h.model, reasoning: h.reasoning, toolCalls: settleToolCalls(h.toolCalls), stats: h.stats })) }));
        }
      }
    };
    historySaves.current[chatId] = (historySaves.current[chatId] || Promise.resolve()).then(run).catch(() => undefined);
  }, []);

  const handleSend = useCallback(
    async (chatId: string, projectId: string | null, text: string, base?: Message[]) => {
      // `streamingChats` is render state, so two sends in one tick both see it false. The ref
      // is updated synchronously and is the real guard against a duplicate generation.
      if (streamingChats[chatId] || sendingChats.current.has(chatId)) return;
      sendingChats.current.add(chatId);
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
      setStreamingChats((prev) => ({ ...prev, [chatId]: true }));
      const controller = new AbortController();
      streamAbort.current[chatId] = controller;

      // Upsert the chat's meta on every send, not only the first. Registering
      // once meant updatedAt froze at creation, so a list sorted by recency
      // never actually moved, and there was nothing to preview a chat with.
      const upsert = (list: ChatMeta[]): ChatMeta[] => {
        const existing = list.find((c) => c.id === chatId);
        const meta: ChatMeta = existing
          ? { ...existing, title: titleAfterSend(existing.title, messagesRef.current[chatId] ?? [], base, text), preview: text.slice(0, 200), updatedAt: Date.now() }
          : { id: chatId, title: text.slice(0, 80), preview: text.slice(0, 200), updatedAt: Date.now() };
        return [meta, ...list.filter((c) => c.id !== chatId)];
      };
      if (projectId) {
        const project = projects.find((p) => p.id === projectId);
        if (project) {
          saveProjectChats(projectId, upsert(project.chats || []))
            .then(() => refreshProjects())
            .catch(() => undefined);
        }
      } else {
        saveFreeChats(upsert(freeChats))
          .then(() => refreshProjects())
          .catch(() => undefined);
      }

      const startedAt = Date.now();
      let failed = false;
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
          if (ev.type === 'meta' && ev.reasoning) {
            window.dispatchEvent(new Event('cowork-reasoning-updated'));
            setMessagesByChat(prev => ({...prev,[chatId]:(prev[chatId] ?? []).map(m => m.id === replyId ? {...m,reasoningMode:ev.reasoning,reasoningEffort:ev.reasoningEffort} : m)}));
          }
          if (ev.type === 'meta' && ev.route) {
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, senderLabel: `Assistant · Auto (${ev.route})` } : m)),
            }));
          } else if (ev.type === 'status' && ev.text) {
            setMessagesByChat(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(m => m.id === replyId ? { ...m, processingStatus: ev.text } : m) }));
          } else if (ev.type === 'warning' && ev.text) {
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, warning: ev.text } : m)),
            }));
          } else if (ev.type === 'reasoning' && ev.text) {
            reasoning += ev.text;
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, reasoning } : m)),
            }));
          } else if (ev.type === 'preamble' && ev.text) {
            // Narration the model wrote before calling tools belongs with its
            // thinking, not in the answer.
            const at = acc.lastIndexOf(ev.text);
            if (at >= 0) acc = acc.slice(0, at) + acc.slice(at + ev.text.length);
            reasoning += (reasoning ? '\n\n' : '') + ev.text.trim();
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, content: acc.trimStart(), reasoning } : m)),
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
            notifyIfAway('Approval needed', 'A tool is waiting for you in noevia.', `approval-${chatId}`);
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
            // The footer's own /api/stats poll only ticks every 2.5s and its rate
            // reflects whichever request last completed engine-wide, so a reply
            // finishing between ticks left it showing a stale number for the rest
            // of that window. This event carries the same provider-reported rate
            // for the round that just finished — apply it the instant it arrives
            // rather than waiting for the next poll to catch up.
            setStats((prev) => (prev ? { ...prev, up: true, tokensPerSecond: ev.tokensPerSecond ?? prev.tokensPerSecond } : prev));
          } else if (ev.type === 'error') {
            throw new Error(ev.text || 'Generation failed');
          } else if (ev.type === 'tool_result' && ev.name) {
            // Mark the call that produced it as complete rather than adding a
            // second chip for the same call. This also clears any 'pending'
            // state, so an approved or refused call stops offering buttons
            // that would now 404.
            const done = typeof ev.index === 'number' ? ev.index : tools.findIndex((t) => t && t.name === ev.name);
            const denied = (ev.text || '').startsWith('ERROR: the user');
            const chip = {
              name: ev.name,
              args: done >= 0 && tools[done] ? tools[done].args : '',
              result: (ev.text || '').slice(0, TOOL_RESULT_LIMIT),
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
                ? { ...m, content: 'Stopped before a reply was written.', senderLabel: 'Stopped' }
                : m,
            ),
          }));
        } else {
          failed = true;
          const detail = err instanceof Error ? err.message : 'unknown error';
          setMessagesByChat((prev) => ({
            ...prev,
            [chatId]: (prev[chatId] ?? []).map((m) =>
              m.id === replyId ? { ...m, content: `Request failed — ${detail}`, error: true } : m,
            ),
          }));
        }
      } finally {
        // Titles and replies stay out of the notification: lock screens are not private.
        if (!controller.signal.aborted) notifyIfAway(failed ? 'Reply failed' : 'Reply ready', failed ? 'noevia could not finish answering.' : 'noevia finished answering.', `reply-${chatId}`);
        sendingChats.current.delete(chatId);
        if (streamAbort.current[chatId] === controller) delete streamAbort.current[chatId];
        setStreamingChats((prev) => {
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
        setMessagesByChat((prev) => {
          const msgs = (prev[chatId] ?? []).map((m) => (m.id === replyId && m.toolCalls ? { ...m, toolCalls: settleToolCalls(m.toolCalls) } : m));
          persist(chatId, msgs);
          return { ...prev, [chatId]: msgs };
        });
      }
    },
    [freeChats, persist, projects, streamingChats],
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
    if (streamingChats[chatId]) return;
    const msgs = messagesRef.current[chatId] ?? [];
    const index = msgs.findIndex(m => m.id === messageId && m.error);
    // Retry is offered only for the final exchange. Never truncate later history.
    if (index !== msgs.length - 1 || index < 1 || msgs[index - 1].role !== 'user') return;
    const projectId = view.kind === 'chat' ? view.projectId ?? activeChatMeta?.projectId ?? null : null;
    void handleSend(chatId, projectId, msgs[index - 1].content, msgs.slice(0, index - 1));
  }, [activeChatMeta, handleSend, streamingChats, view]);

  // Edit an earlier message and re-run the conversation from that point.
  // Everything after the edited message is dropped rather than kept as dead
  // context: the point is to correct the prompt that led somewhere wrong, so
  // paying to re-send the wrong turns (and letting the model keep reading
  // them) would defeat it. The truncated tail is gone — same trade the
  // "edit" affordance makes in ChatGPT/Claude.
  const editAndResend = useCallback(
    (chatId: string, messageId: string, nextText: string) => {
      if (streamingChats[chatId]) return;
      const msgs = messagesRef.current[chatId] ?? [];
      const index = msgs.findIndex((m) => m.id === messageId);
      if (index < 0 || msgs[index].role !== 'user') return;
      const text = nextText.trim();
      if (!text) return;
      const projectId =
        view.kind === 'chat' ? view.projectId ?? activeChatMeta?.projectId ?? null : null;
      void handleSend(chatId, projectId, text, msgs.slice(0, index));
    },
    [activeChatMeta, handleSend, streamingChats, view],
  );

  const startFreeChat = useCallback(() => {
    const chatId = `c-${uid()}`;
    loadedChats.current.add(chatId);
    setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }));
    setView({ kind: 'chat', chatId, projectId: null });
  }, []);

  // A prompt suggestion (Settings → Connectors) starts a new chat and sends it once that chat is on screen.
  const startFreeChatWith = useCallback((text: string) => {
    const chatId = `c-${uid()}`;
    loadedChats.current.add(chatId);
    pendingFirstSend.current = { chatId, projectId: null, text };
    setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }));
    setSettingsOpen(false);
    setAppMode('chat');
    setView({ kind: 'chat', chatId, projectId: null });
  }, []);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const appleKeys = useGlobalShortcuts({
    search: () => { setSettingsOpen(false); setAppMode('chat'); window.dispatchEvent(new Event(OPEN_SEARCH)); },
    newChat: () => { setSettingsOpen(false); setAppMode('chat'); startFreeChat(); },
    settings: () => openSettings(),
    help: () => setShortcutsOpen(true),
  });

  const startProjectChat = useCallback(
    (projectId: string) => {
      const chatId = `c-${uid()}`;
      loadedChats.current.add(chatId);
      setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }));
      setView({ kind: 'chat', chatId, projectId });
    },
    [],
  );

  // Send straight from the project page: open a new chat in the project and
  // deliver the first message into it, rather than dropping into a blank chat
  // the person then has to retype into.
  //
  // The send cannot happen inline with setView. Navigating away from a chat
  // aborts any in-flight generation, and that cleanup runs when the new view
  // commits — after this handler — so a stream started here would be aborted
  // by the very navigation that opened it. Hand the message to an effect that
  // fires once the view is the one we are sending into.
  const startProjectChatWith = useCallback(
    (projectId: string, text: string) => {
      const chatId = `c-${uid()}`;
      // Without this the lazy-history effect fetches this brand-new chat's
      // (empty) history and overwrites the message we are about to send.
      loadedChats.current.add(chatId);
      pendingFirstSend.current = { chatId, projectId, text };
      setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }));
      setView({ kind: 'chat', chatId, projectId });
    },
    [],
  );

  useEffect(() => {
    const pending = pendingFirstSend.current;
    if (!pending) return;
    if (view.kind !== 'chat' || view.chatId !== pending.chatId) return;
    pendingFirstSend.current = null;
    void handleSend(pending.chatId, pending.projectId, pending.text, []);
  }, [view, handleSend]);

  const handleCreateProject = useCallback(
    async (body: { icon?: string; color?: string; name: string; goal: string; instructions: string; files: ProjectFile[] }) => {
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

  // Rename / pin / archive on a chat meta. Chats live either inside their
  // project or in the free-chats list, and each has its own save endpoint, so
  // the projectId decides which list is rewritten.
  const handlePatchChat = useCallback(
    (projectId: string | null, chatId: string, patch: Partial<ChatMeta>) => {
      if (projectId) {
        const project = projects.find((p) => p.id === projectId);
        if (!project) return;
        const next = (project.chats || []).map((c) => (c.id === chatId ? { ...c, ...patch } : c));
        setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, chats: next } : p)));
        saveProjectChats(projectId, next).then(() => refreshProjects()).catch(() => undefined);
      } else {
        const next = freeChats.map((c) => (c.id === chatId ? { ...c, ...patch } : c));
        setFreeChats(next);
        saveFreeChats(next).then(() => refreshProjects()).catch(() => undefined);
      }
    },
    [projects, freeChats, refreshProjects],
  );

  // Saving the project settings dialog. Unlike the debounced rail edits this
  // lands immediately and then pulls the attached folders, because a folder
  // that is attached but not read is indistinguishable from one that does not
  // work: the project lists it and the model sees nothing.
  const saveProjectAndSync = useCallback(
    async (projectId: string, patch: Partial<Project>) => {
      patch = { ...pendingPatches.current[projectId], ...patch };
      delete pendingPatches.current[projectId];
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...patch, updatedAt: Date.now() } : p)));
      // A pending debounced patch would otherwise land after this one and
      // overwrite it with older values.
      if (patchTimers.current[projectId]) {
        clearTimeout(patchTimers.current[projectId]);
        delete patchTimers.current[projectId];
      }
      try {
        await saveProjectConfig(projectId, patch);
        // Sync whenever the folder list is touched at all, including when it
        // is emptied. Requiring a non-empty list meant detaching the LAST
        // folder skipped the sync and left its files behind — detaching one of
        // several worked, because the sync rebuilds from what remains, which
        // is why the behaviour looked arbitrary.
        if (Array.isArray(patch.sourceFolders)) {
          const r = await syncProjectSources(projectId);
          if (r.skipped.length) {
            setProjectError(sourceRefreshIssues(r.skipped));
          }
        }
      } catch (e) {
        setProjectError(`That did not save — ${e instanceof Error ? e.message : 'the server rejected the change'}.`);
        throw e;
      } finally {
        refreshProjects();
      }
    },
    [refreshProjects],
  );

  // Rail edits are debounced per project so typing doesn't hammer projects.json.
  const handlePatchProject = useCallback(
    (projectId: string, patch: Partial<Project>) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, ...patch, updatedAt: Date.now() } : p)),
      );
      pendingPatches.current[projectId] = { ...pendingPatches.current[projectId], ...patch };
      if (patchTimers.current[projectId]) clearTimeout(patchTimers.current[projectId]);
      patchTimers.current[projectId] = setTimeout(() => {
        const merged = pendingPatches.current[projectId];
        delete pendingPatches.current[projectId];
        delete patchTimers.current[projectId];
        if (!merged) return;
        saveProjectConfig(projectId, merged)
          .then(() => refreshProjects())
          .catch((e: unknown) => {
            // Swallowing this was how a source could appear to save and then
            // vanish: the optimistic entry survived until the next refresh,
            // which is usually the first message sent in a chat. A patch that
            // did not land has to say so, and the state has to go back to
            // whatever the server actually holds.
            setProjectError(
              e instanceof Error && /exceeds size limit|413/i.test(e.message)
                ? 'That did not save — the change is too large to send. Attach a smaller file.'
                : `That did not save — ${e instanceof Error ? e.message : 'the server rejected the change'}.`,
            );
            refreshProjects();
          });
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
      <div className="regular-workspace" style={{display:appMode==='chat'||!showPreviews||!codeShown?'contents':'none'}}>
      <Sidebar
        onEnterCode={() => setAppMode('code')}
        onPreview={(title) => setView({kind:'preview',title})}
        showPreviews={showPreviews}
        projects={projects}
        chats={allChats}
        activeView={view.kind}
        activeProjectId={activeProject?.id ?? null}
        activeChatId={view.kind === 'chat' ? view.chatId : null}
        onNewChat={startFreeChat}
        onNewProjectChat={startProjectChat}
        onOpenProjects={() => setView({ kind: 'projects' })}
        onOpenProject={(id) => setView({ kind: 'project', id })}
        onOpenChat={(chatId, projectId) => setView({ kind: 'chat', chatId, projectId })}
        onDeleteChat={handleDeleteChat}
        onPatchChat={handlePatchChat}
        streamingChats={streamingChats}
        onPatchProject={handlePatchProject}
        onEditProject={setEditingProjectId}
        onDeleteProject={handleDeleteProject}
        onOpenDiary={() => setView({ kind: 'diary' })}
        diaryEnabled={diaryEnabled}
        onOpenSettings={openSettings}
        health={health}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />

      <div className={`app-stack pane${settingsOpen ? ' has-settings' : ''}`}>
      <div className="app-main">

      {view.kind === 'preview' && showPreviews && <FeaturePreview title={view.title}/> }
      {view.kind === 'models' && (
        <Suspense fallback={null}>
          <ModelManager.View key={view.model || 'list'} initialModel={view.model} onBack={() => openSettings('models')} models={models} routes={routes} projects={projects} modelsError={modelsError} />
        </Suspense>
      )}
      {view.kind === 'projects' && (
        <Suspense fallback={null}>
          <Projects.View onEdit={setEditingProjectId}
            onPatch={handlePatchProject}
            projects={projects}
            onOpenProject={(id) => setView({ kind: 'project', id })}
            onCreate={handleCreateProject}
            onDelete={handleDeleteProject}
          />
        </Suspense>
      )}

      {view.kind === 'project' && activeProject && (
        <ProjectView
          modelLabel={modelChoiceLabel(activeProject, modelsLoaded && !modelsError ? models : null)}
          onOpenModels={() => setPopupOpen(true)}
          project={activeProject}
          streamingChats={streamingChats}
          onRefresh={refreshProjects}
          onNewChat={startProjectChat}
          onSendFirst={startProjectChatWith}
          onSave={saveProjectAndSync}
          onOpenChat={(_projectId, chatId) => setView({ kind: 'chat', chatId, projectId: _projectId })}
          onPatch={handlePatchProject}
          onDeleteChat={handleDeleteChat}
        />
      )}

      {view.kind === 'chat' && (
        <ChatView
          project={activeProject ?? null}
          onProjectChanged={refreshProjects}
          chatId={view.chatId}
          title={activeChatMeta?.title ?? (view.projectId ? 'New task' : 'New chat')}
          projectName={activeProject?.name ?? null}
          modelLabel={modelChoiceLabel(activeProject, modelsLoaded && !modelsError ? models : null)}
          installedModels={modelsLoaded && !modelsError ? models : null}
          messages={messages}
          onEditMessage={editAndResend}
          streaming={view.kind === 'chat' ? !!streamingChats[view.chatId] : false}
          inferenceUp={health.inferenceUp}
          onSend={sendToCurrent}
          onRetry={retryLast}
          onStop={() => { if (view.kind === 'chat') abortStream(view.chatId); }}
          onBack={activeProject ? () => setView({ kind: 'project', id: activeProject.id }) : null}
          onOpenModels={() => setPopupOpen(true)}
          onOpenSettings={() => openSettings()}
        />
      )}

      {diaryEnabled && <div className="diary-mount" style={{ display: view.kind === 'diary' ? 'contents' : 'none' }}><Suspense fallback={null}><Diary.View inferenceUp={health.inferenceUp} /></Suspense></div>}

      {popupOpen && (
        <ModelPopup
          projects={projects}
          activeProject={activeProject}
          onClose={() => setPopupOpen(false)}
          onProjectsChanged={() => {
            refreshProjects();
            refreshModels();
          }}
          onOpenModelSettings={(model?: string) => { setPopupOpen(false); openModelManager(model); }}
        />
      )}

      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
        <Settings.View
          key={settingsKey}
          initialSection={settingsSection}
          onSection={setSettingsSection}
          appearanceStatus={appearanceStatus} appearanceError={appearanceError} retryAppearance={retryAppearance}
          onClose={() => setSettingsOpen(false)}
          onStartChat={startFreeChatWith}
          theme={theme}
          onTheme={setTheme}
          preference={preference}
          onPreference={setPreference}
          models={models}
          routes={routes}
          modelsError={modelsError}
          projects={projects}
          health={health}
          stats={stats}
          onOpenModels={() => { setSettingsOpen(false); setAppMode('chat'); setPopupOpen(true); }}
          onOpenModelManager={() => openModelManager()}
          diaryEnabled={diaryEnabled}
          onDiaryEnabledChange={(enabled) => {
            setDiaryEnabled(enabled);
          }}
        />
        </Suspense>
      )}
      <StatsBar stats={stats} modelLabel={modelChoiceLabel(activeProject, modelsLoaded && !modelsError ? models : null)} />
      {view.kind === 'chat' && activeProject && (
        <Inspector
          project={activeProject ?? null}
          models={models}
          onConfigureModels={() => setPopupOpen(true)}
          onEditProject={setEditingProjectId}
        />
      )}
      </div>

      {editingProjectId && (() => {
        const p = projects.find((x) => x.id === editingProjectId);
        return p ? (
          <EditProjectModal
            project={p}
            models={models}
            onClose={() => setEditingProjectId(null)}
            onSave={(patch) => saveProjectAndSync(p.id, patch)}
          />
        ) : null;
      })()}
      {projectError && (
        <div className="save-error" role="alert">
          <span>{projectError}</span>
          <button onClick={() => setProjectError(null)} aria-label="Dismiss"><ShellIcon name="close" size={16}/></button>
        </div>
      )}

      </div>
      {shortcutsOpen && <ShortcutsDialog apple={appleKeys} onClose={() => setShortcutsOpen(false)} />}
      {appMode === 'code' && showPreviews && <Suspense fallback={null}><div className="code-mount" style={{display:codeShown?'contents':'none'}}><Coding.View onExit={() => setAppMode('chat')} onSettings={() => openSettings()} theme={theme} onToggleTheme={() => setTheme(t=>t==='light'?'dark':'light')}/><MountedSignal onMounted={() => setCodeShown(true)}/></div></Suspense>}

    </div>
  );
}

/** Tells its parent, before paint, that the lazy view beside it has mounted. */
function MountedSignal({ onMounted }: { onMounted: () => void }): null {
  useLayoutEffect(() => { onMounted(); }, [onMounted]);
  return null;
}
