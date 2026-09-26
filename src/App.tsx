import { titleAfterSend } from './chat-title';
import { ShellIcon } from './components/ShellIcon';
import { sourceRefresher } from './source-refresh';
import { resolveSkippedToast, type SkippedToastState } from './source-status';
import { useAppearance } from './useAppearance';
import { useWorkspaceChanged } from './components/data/workspace-changed';
import { useGlobalShortcuts, OPEN_SEARCH } from './components/shortcuts/useGlobalShortcuts';
import { ShortcutsDialog } from './components/shortcuts/ShortcutsDialog';
import { notifyIfAway } from './components/notifications/notify';
import { notifyModelsChanged, useModelsChanged } from './models-changed';
import { modelChoiceLabel } from './model-guidance';
import { applyReplyTelemetry, beginReplyTelemetry, finishReplyTelemetry, lastReplyTelemetry } from './reply-telemetry';
import { shouldShowStatsBar } from './statsbar-visibility';
import { planRegenerate } from './regenerate';
import { TOOL_RESULT_LIMIT } from './components/ToolCalls';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  createProject,
  deleteChat,
  deleteFreeChat,
  deleteProject,
  fetchAutoRoles,
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
  startCowork,
} from './api';
import { sessionMode, type ChatMode } from './chat-mode';
import type {
  ChatMeta,
  HealthState,
  HistoryEntry,
  InstalledModel,
  LiveStats,
  Message,
  Project,
  ProjectFile,
  ReplyTelemetry,
  ToolCallView,
} from './types';
import { ChatView } from './components/ChatView';
import { ModelPopup } from './components/ModelPopup';
import { ProjectView } from './components/ProjectView';
import { ActiveCodeTasks } from './components/code/ActiveCodeTasks';
import { Coding, Customise, Diary, ModelManager, Projects, Settings, ViewLoading, prefetchViewsWhenIdle } from './lazy-views';
import type { SettingsSection } from './components/SettingsShell';
import { FeaturePreview } from './components/PreviewPanel';
import { ArchivedChatsView } from './components/data/ArchivedChats';
import { recentChats } from './sidebar-order';
import { useFeatureFlags } from './components/features/useFeatureFlags';
import { Sidebar } from './components/Sidebar';
import { EditProjectModal } from './components/EditProjectModal';
import { Inspector } from './components/Inspector';
import { StatsBar } from './components/StatsBar';
import { settleToolCalls } from './tool-call-state';
import { mergeTranscripts } from './transcript-merge';
import { adoptMergedTranscript, enqueueKeyed, latestGate, resolveLoadedHistory, shouldSaveChat, upsertChatMeta } from './chat-save';
import { readLastPlace, writeLastPlace, clearLastPlace } from './last-view';
import { currentRoutingDecision } from './current-routing';
import { nextNavState, persistedView, resolveSettingsClose, restoreNavState, withoutChat, withoutProject, type NavState } from './settings-nav';
import { useT } from './i18n';

type View =
  | { kind: 'diary' }
  | { kind: 'preview'; title: string }
  | { kind: 'projects' }
  | { kind: 'plugins' }
  | { kind: 'archived' }
  | { kind: 'models'; model?: string }
  | { kind: 'project'; id: string; codeRequest?: string }
  | { kind: 'chat'; chatId: string; projectId?: string | null };

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App(): JSX.Element {
  const {theme,preference,setTheme,setPreference,appearanceStatus,appearanceError,retryAppearance} = useAppearance();
  const tr = useT();
  const [settingsSection,setSettingsSection] = useState<string>(() => readLastPlace()?.settings ?? 'general');
  // Each open is a fresh Settings: reopening while the last one is still animating out replaces it.
  const [settingsKey, setSettingsKey] = useState(0);
  const openSettings = (section: SettingsSection = 'general') => {
    // Connecting services moved to Plugins (user review, 2026-09-19); old links land there.
    if (section === 'connectors') { pendingFromSettingsRef.current = 'connectors'; setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'plugins' }); return; }
    setSettingsSection(section); setSettingsKey((k) => k + 1); setSettingsOpen(true); };
  // `model` opens that model's tuning view directly; without it, the model list. Models &
  // routing is always treated as a Settings page (it has its own "back to Settings" control),
  // so it never becomes the view Settings' close returns to, regardless of how it was opened.
  const openModelManager = (model?: string) => { pendingFromSettingsRef.current = 'models'; setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'models', model }); };
  useEffect(() => { const open = () => { setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'plugins' }); }; window.addEventListener('noevia:open-customise', open); return () => window.removeEventListener('noevia:open-customise', open); }, []);
  useEffect(() => { const open = (e: Event) => { const model = (e as CustomEvent<{ model?: string }>).detail?.model; pendingFromSettingsRef.current = 'models'; setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'models', model }); }; window.addEventListener('noevia:open-model-settings', open); return () => window.removeEventListener('noevia:open-model-settings', open); }, []);
  // #366: Plugins → Added's empty state links here so "built-in" isn't just a claim — an admin can
  // see those servers listed, tagged built-in vs added, in the same place Service status already shows them.
  useEffect(() => { const open = () => openSettings('status'); window.addEventListener('noevia:open-service-status', open); return () => window.removeEventListener('noevia:open-service-status', open); }, []);
  const [settingsOpen, setSettingsOpen] = useState(() => { const fresh = !!sessionStorage.getItem('cowork-new-account'); sessionStorage.removeItem('cowork-new-account'); return fresh || !!readLastPlace()?.settings; });
  const [appMode, setAppMode] = useState<'chat'|'code'>('chat');
  // The Code page is chosen in the shared sidebar, so it lives here rather than in the workspace.
  const [codePage, setCodePage] = useState('New task');
  // Chat ⇄ Code plays a short entrance on the page, as Claude does, instead of cutting in one frame.
  const appMain = useRef<HTMLDivElement>(null);
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return; }
    const el = appMain.current;
    if (!el) return;
    el.classList.remove('mode-enter'); void el.offsetWidth; el.classList.add('mode-enter');
    const done = () => el.classList.remove('mode-enter');
    el.addEventListener('animationend', done, { once: true });
    return () => el.removeEventListener('animationend', done);
  }, [appMode]);
  // The Code workspace is a lazy chunk. Its explicit loading view replaces Chat as soon as
  // Code is chosen; codeShown swaps that loading view for the mounted workspace.
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
  // Latest view for async callbacks (a delete resolving after the person moved elsewhere).
  const viewRef = useRef(view);
  viewRef.current = view;
  // #304: Settings-launched detours (Models & routing, Customise, Archived, Diary) must never
  // become the view Settings' close/back returns to — otherwise closing Settings from one of
  // them just re-shows the detour, and its own "back to Settings" affordance re-opens Settings,
  // looping forever. `pendingFromSettingsRef` is set immediately before a detour's setView so
  // the effect below can tell it apart from a real navigation.
  const navRef = useRef<NavState<View>>(restoreNavState(view, { kind: 'chat', chatId: `c-${uid()}`, projectId: null }));
  const pendingFromSettingsRef = useRef<string | null>(null);
  // Skip the mount's own run: navRef already holds the restoreNavState-computed value above
  // (which, unlike this effect, knows a restored detour view is never a valid return target).
  // Treating that first render as an ordinary direct navigation would blindly overwrite it with
  // the detour itself, undoing the reload fix.
  const navMounted = useRef(false);
  useEffect(() => {
    if (view.kind === 'preview') return;
    if (!navMounted.current) { navMounted.current = true; return; }
    navRef.current = nextNavState(navRef.current, view, { fromSettingsSection: pendingFromSettingsRef.current });
    pendingFromSettingsRef.current = null;
  }, [view]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeChats, setFreeChats] = useState<ChatMeta[]>([]);
  const projectsRef = useRef(projects);
  const freeChatsRef = useRef(freeChats);
  projectsRef.current = projects;
  freeChatsRef.current = freeChats;
  const chatMetaSaves = useRef(new Map<string, Promise<void>>());
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const pendingFirstSend = useRef<{ chatId: string; projectId: string | null; text: string } | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({ inferenceUp: null, diaryUp: null });
  const [stats, setStats] = useState<LiveStats | null>(null);
  // Reply telemetry is per chat. Engine polling is deliberately kept in
  // `stats`: parallel chats and other tenants must not overwrite the current
  // chat's first-token time, token counts or provider-reported speed.
  const [replyTelemetryByChat, setReplyTelemetryByChat] = useState<Record<string, ReplyTelemetry>>({});
  // Per chat, not global. A generation now continues while you look at
  // something else, so "is something streaming" is only ever a question about
  // a particular chat — and one chat working must not lock the composer of
  // another.
  const [streamingChats, setStreamingChats] = useState<Record<string, true>>({});
  // #236: a mode chosen for a chat that has no saved record yet (a new, unsent session).
  const [pendingModes, setPendingModes] = useState<Record<string, ChatMode>>({});
  const pendingModesRef = useRef(pendingModes);
  pendingModesRef.current = pendingModes;
  const messagesRef = useRef(messagesByChat);
  messagesRef.current = messagesByChat;
  const [diaryEnabled, setDiaryEnabled] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  // A restored chat must fetch its saved transcript; only a newly created empty
  // chat may skip that read until its first send.
  const loadedChats = useRef<Set<string>>(new Set(view.kind === 'chat' && !restored.current ? [view.chatId] : []));
  const patchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingPatches = useRef<Record<string, Partial<Project>>>({});
  const lastSourceSync = useRef<Record<string, number>>({});
  const pendingSourceSync = useRef(new Set<string>());
  // Per-project fingerprint of the skipped-source set last surfaced in the
  // toast, so the watcher (60s poll, focus, online, visibility) only reopens
  // it when something actually changed, not on every rerun.
  const lastSkippedSignature = useRef<Record<string, SkippedToastState>>({});
  // AbortController for the in-flight generation (chat or diary). Aborting
  // stops the client-side stream; the server's disconnect handling (Phase 1)
  // then terminates the upstream request.
  const streamAbort = useRef<Record<string, AbortController>>({});
  const sendingChats = useRef<Set<string>>(new Set());
  const historyLoads = useRef<Record<string, Promise<Message[] | null>>>({});
  const statsGate = useRef(latestGate());
  const historyRevisions = useRef<Record<string, string | null>>({});
  const historySaves = useRef<Record<string, Promise<void>>>({});
  // A merged transcript that arrived while a reply was streaming into that chat. Applying it then
  // would replace the live user message and reply placeholder; it is folded into the save made
  // when the stream ends instead.
  const deferredMerges = useRef<Record<string, HistoryEntry[]>>({});
  // Chats whose transcript should be saved once the current render commits (kept out of state
  // updaters, which StrictMode runs twice).
  const persistAfterCommit = useRef<Set<string>>(new Set());
  // Chats deleted in this session. A save queued (or retried) after the delete must not write the
  // transcript back under the dead id.
  const deletedChats = useRef<Set<string>>(new Set());
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

  // Whether Auto routing (Fast/Smart) is actually configured server-side: a free chat's composer
  // label must say Auto only when the server would really route it that way (#305) — otherwise
  // (no roles picked yet) the server falls back to whatever model is loaded, and the label should
  // say so too rather than promise a routing decision that will not happen.
  const [autoRolesConfigured, setAutoRolesConfigured] = useState(false);
  const refreshAutoRoles = useCallback(() => {
    fetchAutoRoles().then((r) => setAutoRolesConfigured(r.configured)).catch(() => setAutoRolesConfigured(false));
  }, []);

  // Settings can download, register, rename, delete, load or unload a model.
  // The chat's own list is fetched once at start-up, so without this the header
  // and model picker kept showing the pre-change set until a reload.
  useModelsChanged(refreshModels);
  useModelsChanged(refreshAutoRoles);

  const workspaceRequest = useRef(0);
  useEffect(() => () => { workspaceRequest.current += 1; }, []);
  const refreshProjects = useCallback(() => {
    const request = ++workspaceRequest.current;
    return fetchWorkspace()
      .then((w) => {
        if (request !== workspaceRequest.current) return;
        const nextProjects = (w.projects || []).map((p) => ({ ...p, ...pendingPatches.current[p.id] }));
        const nextFreeChats = Array.isArray(w.freeChats) ? w.freeChats : [];
        projectsRef.current = nextProjects;
        freeChatsRef.current = nextFreeChats;
        setProjects(nextProjects);
        setFreeChats(nextFreeChats);
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
    refreshAutoRoles();
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
  }, [refreshAutoRoles, refreshModels, refreshProjects]);

  useEffect(() => prefetchViewsWhenIdle(), []);

  // Remember where you are, so a reload returns here. `preview` is skipped: an
  // unbuilt surface is not somewhere to come back to. A Settings-launched detour (Models &
  // routing, Customise, Archived, Diary) is never written as the place itself (#304): reloading
  // mid-detour must not turn it into a permanent return target that Settings' close resolves
  // back into forever — the return target underneath it is written instead.
  useEffect(() => {
    if (view.kind === 'preview') return;
    // The return target is never 'preview' by construction (this same guard runs before every
    // view change reaches navRef); the cast only tells TypeScript what the runtime already
    // guarantees.
    const toPersist = persistedView(navRef.current, view) as Exclude<View, { kind: 'preview' }>;
    writeLastPlace({ user: accountId, view: toPersist, settings: settingsOpen ? settingsSection : null });
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

  // Engine-wide totals and hardware are a background snapshot. Request-local
  // values arrive over the chat SSE stream and never wait on this poll.
  useEffect(() => {
    let alive = true, pending = false;
    const tick = () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      const seq = statsGate.current.next();
      void fetchStats()
        .then((s) => { if (alive && statsGate.current.isLatest(seq)) setStats(s); })
        .catch(() => { if (alive && statsGate.current.isLatest(seq)) setStats((prev) => (prev ? { ...prev, up: false, mtp: [] } : prev)); })
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
    // A send made before this resolves waits on it (see handleSend), and whatever is already on
    // screen is merged with the loaded copy rather than replaced by it.
    const load = fetchChatHistoryRevision(id)
      .then(({ history, revision }) => {
        historyRevisions.current[id] = revision;
        const loaded: Message[] = history.map((h) => ({
            id: uid(),
            role: h.role,
            content: h.content,
            senderLabel: h.model,
            routingDecision: h.routingDecision,
            reasoning: h.reasoning,
            reasoningMs: h.reasoningMs,
            toolCalls: settleToolCalls(h.toolCalls),
            stats: h.stats,
            coworkTask: h.coworkTask,
          }));
        setMessagesByChat((prev) => ({ ...prev, [id]: resolveLoadedHistory(prev[id] ?? [], loaded) }));
        return loaded;
      })
      .catch(() => {
        // Not loaded: reopening the chat retries instead of leaving it empty with no revision.
        loadedChats.current.delete(id);
        return null;
      })
      .finally(() => { if (historyLoads.current[id] === load) delete historyLoads.current[id]; });
    historyLoads.current[id] = load;
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
        setProjectError(prevError => {
          const prev = lastSkippedSignature.current[sourceProjectId] || { signature: '', message: '' };
          const { signature, message, show } = resolveSkippedToast(prev, result.skipped || [], prevError);
          lastSkippedSignature.current[sourceProjectId] = { signature, message };
          return show === undefined ? prevError : show;
        });
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
  const routingDecision = currentRoutingDecision(messages, view.kind === 'chat' && appMode === 'chat');

  const persist = useCallback((chatId: string, msgs: Message[]) => {
    // Reasoning, tool activity and cost are persisted too, so reopening a
    // chat shows the same thinking block and stats it had while streaming
    // instead of a bare answer. The server strips these before replaying
    // history to a model, so they cost nothing in prompt tokens.
    const entries: HistoryEntry[] = msgs.filter((m) => !m.error).map((m) => ({
      role: m.role,
      content: m.content,
      model: m.senderLabel,
      routingDecision: m.routingDecision,
      reasoning: m.reasoning || undefined,
      reasoningMs: m.reasoningMs,
      toolCalls: m.toolCalls && m.toolCalls.length ? m.toolCalls : undefined,
      stats: m.stats,
      coworkTask: m.coworkTask,
    }));
    // Saves for one chat run in order. If another device saved first, merge its copy with ours
    // (nothing either side wrote is dropped), show the merged transcript, and save that.
    const show = (merged: HistoryEntry[]) => {
      if (sendingChats.current.has(chatId)) { deferredMerges.current[chatId] = merged; return; }
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: adoptMergedTranscript(prev[chatId] ?? [], merged, uid, (h, id) => ({ id, role: h.role, content: h.content, senderLabel: h.model, routingDecision: h.routingDecision, reasoning: h.reasoning, reasoningMs: h.reasoningMs, toolCalls: settleToolCalls(h.toolCalls), stats: h.stats, coworkTask: h.coworkTask })),
      }));
    };
    if (!shouldSaveChat(chatId, deletedChats.current)) return;
    const run = async () => {
      if (!shouldSaveChat(chatId, deletedChats.current)) return;
      let next = entries;
      // A merge held back while a reply streamed is folded in now, so the save that follows the
      // stream does not overwrite the other device's turns with our shorter copy.
      const deferred = deferredMerges.current[chatId];
      if (deferred && !sendingChats.current.has(chatId)) {
        delete deferredMerges.current[chatId];
        const merged = mergeTranscripts(deferred, next);
        if (merged !== next) { next = merged; show(merged); }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!shouldSaveChat(chatId, deletedChats.current)) return;
        const result = await saveChatHistory(chatId, next, historyRevisions.current[chatId]);
        if (result.ok) { historyRevisions.current[chatId] = result.revision; return; }
        const merged = mergeTranscripts(result.conflict.history, next);
        historyRevisions.current[chatId] = result.conflict.revision;
        if (merged !== next) {
          next = merged;
          show(merged);
        }
      }
    };
    historySaves.current[chatId] = (historySaves.current[chatId] || Promise.resolve()).then(run).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!persistAfterCommit.current.size) return;
    const due = [...persistAfterCommit.current];
    persistAfterCommit.current.clear();
    for (const chatId of due) persist(chatId, messagesByChat[chatId] ?? []);
  }, [messagesByChat, persist]);

  // Upsert one chat's meta in its list's save queue (shared by the Chat and Cowork send paths).
  const queueMetaUpsert = useCallback((projectId: string | null, chatId: string, make: (existing: ChatMeta | undefined) => ChatMeta) => {
    void enqueueKeyed(chatMetaSaves.current, projectId === null ? 'free' : `project:${projectId}`, async () => {
      if (projectId) {
        const project = projectsRef.current.find((p) => p.id === projectId);
        if (!project) return;
        const next = upsertChatMeta(project.chats || [], chatId, make);
        await saveProjectChats(projectId, next);
        projectsRef.current = projectsRef.current.map((p) => (p.id === projectId ? { ...p, chats: next } : p));
      } else {
        const next = upsertChatMeta(freeChatsRef.current, chatId, make);
        await saveFreeChats(next);
        freeChatsRef.current = next;
      }
      // A workspace GET that began before this save may carry the old list.
      workspaceRequest.current += 1;
      // Await (not fire-and-forget) so the refs are back in sync with the
      // server before the next queued task for this key reads them. Every
      // render reassigns projectsRef/freeChatsRef from state at the top of
      // this component, so a render landing between two queued tasks would
      // otherwise reset the ref to the stale pre-save list and the next
      // task's whole-list PUT would drop this task's chat. If this call is
      // itself superseded by a later refreshProjects (request !==
      // workspaceRequest.current), it resolves without touching the refs,
      // but that's fine: the ref writes just above (projectsRef.current /
      // freeChatsRef.current) already reflect this task's saved list, and
      // the later, superseding refresh will bring in server truth anyway.
      await refreshProjects();
    }).catch(() => undefined);
  }, [refreshProjects]);

  const handleSend = useCallback(
    async (chatId: string, projectId: string | null, text: string, base?: Message[], turn: { turnToolboxes?: string[]; notice?: string | null } = {}) => {
      // `streamingChats` is render state, so two sends in one tick both see it false. The ref
      // is updated synchronously and is the real guard against a duplicate generation.
      if (streamingChats[chatId] || sendingChats.current.has(chatId)) return;
      sendingChats.current.add(chatId);
      const userMsg: Message = { id: uid(), role: 'user', content: text };
      // History still loading: wait for it so the model sees the earlier turns and the load does
      // not land on top of this turn.
      const pendingLoad = base ? undefined : historyLoads.current[chatId];
      const loaded = pendingLoad ? await pendingLoad : null;
      const existing = base ?? (loaded ? resolveLoadedHistory(messagesRef.current[chatId] ?? [], loaded) : messagesRef.current[chatId] ?? []);
      const history: HistoryEntry[] = existing.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
      setMessagesByChat(prev => ({ ...prev, [chatId]: [...existing, userMsg] }));
      const replyId = uid();
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: [
          ...(prev[chatId] ?? []),
          { id: replyId, role: 'assistant', content: '', reasoning: '', toolCalls: [], ...(turn.notice ? { warning: turn.notice } : {}) },
        ],
      }));
      setStreamingChats((prev) => ({ ...prev, [chatId]: true }));
      setReplyTelemetryByChat((prev) => ({ ...prev, [chatId]: beginReplyTelemetry() }));
      const controller = new AbortController();
      streamAbort.current[chatId] = controller;

      // Upsert the chat's meta on every send, not only the first. Registering
      // once meant updatedAt froze at creation, so a list sorted by recency
      // never actually moved, and there was nothing to preview a chat with.
      // Each write sends the whole list, so it is built from the latest list when its turn in the
      // per-list queue comes (not the list captured when this send began), and writes for one
      // list run in order. Two new chats sent at once therefore both survive.
      const priorMessages = messagesRef.current[chatId] ?? [];
      const sentAt = Date.now();
      const make = (existing: ChatMeta | undefined): ChatMeta => existing
        ? { ...existing, title: titleAfterSend(existing.title, priorMessages, base, text), preview: text.slice(0, 200), updatedAt: sentAt }
        : { id: chatId, title: text.slice(0, 80), preview: text.slice(0, 200), updatedAt: sentAt,
            // The chosen mode is the session's even when this turn fell back to Chat (#236).
            ...(pendingModesRef.current[chatId] === 'cowork' ? { mode: 'cowork' as const } : {}) };
      queueMetaUpsert(projectId, chatId, make);

      const startedAt = Date.now();
      let failed = false;
      let streamCompleted = false;
      try {
        let acc = '';
        let reasoning = '';
        // Thinking time: from the first thought to the first word of the answer. Measured here
        // because it is what the person waited through; the engine's own timings cover tokens.
        let thinkStart = 0, thought = false;
        const endThinking = () => {
          if (!thinkStart || thought) return;
          thought = true;
          const ms = Math.round(performance.now() - thinkStart);
          setMessagesByChat((prev) => ({ ...prev, [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, reasoningMs: ms } : m)) }));
        };
        const tools: ToolCallView[] = [];
        for await (const ev of streamChat(
          {
            spaceId: projectId || 'free',
            message: text,
            history,
            projectId,
            chatId,
            mode: 'chat',
            ...(turn.turnToolboxes && turn.turnToolboxes.length ? { turnToolboxes: turn.turnToolboxes } : {}),
          },
          controller.signal,
        )) {
          if (ev.type === 'meta' && ev.reasoning) {
            window.dispatchEvent(new Event('cowork-reasoning-updated'));
            setMessagesByChat(prev => ({...prev,[chatId]:(prev[chatId] ?? []).map(m => m.id === replyId ? {...m,reasoningMode:ev.reasoning,reasoningEffort:ev.reasoningEffort} : m)}));
          }
          if (ev.type === 'meta' && ev.model) {
            setReplyTelemetryByChat((prev) => ({
              ...prev,
              [chatId]: applyReplyTelemetry(prev[chatId], { model: ev.model }),
            }));
          }
          if (ev.type === 'telemetry') {
            setReplyTelemetryByChat((prev) => ({
              ...prev,
              [chatId]: applyReplyTelemetry(prev[chatId], {
                phase: ev.phase,
                model: ev.model,
                timeToFirstToken: ev.timeToFirstToken,
              }),
            }));
          }
          if (ev.type === 'meta' && ev.route) {
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, senderLabel: `Assistant · Auto (${ev.route})`, routingDecision: ev.routingDecision } : m)),
            }));
          } else if (ev.type === 'skills_scope') {
            setMessagesByChat(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(m => m.id === replyId ? { ...m, skillScope: ev.text || undefined } : m) }));
          } else if (ev.type === 'tools_scope') {
            setMessagesByChat(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(m => m.id === replyId ? { ...m, toolScope: ev.text || undefined } : m) }));
          } else if (ev.type === 'status' && ev.text) {
            setMessagesByChat(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(m => m.id === replyId ? { ...m, processingStatus: ev.text } : m) }));
          } else if (ev.type === 'warning' && ev.text) {
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, warning: ev.text } : m)),
            }));
          } else if (ev.type === 'reasoning' && ev.text) {
            if (!thinkStart) thinkStart = performance.now();
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
            if (ev.text.trim()) endThinking();
            acc += ev.text;
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, content: acc } : m)),
            }));
          } else if (ev.type === 'tool') {
            // Deciding to use a tool is where the thinking before it ends.
            endThinking();
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
            notifyIfAway('Approval needed', 'A tool is waiting for you in noevia.', `approval-${chatId}`, 'approvalNeeded');
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) =>
                m.id === replyId ? { ...m, toolCalls: tools.filter(Boolean).map((t) => ({ ...t })) } : m,
              ),
            }));
          } else if (ev.type === 'usage') {
            const stats = {
              promptTokens: ev.promptTokens ?? undefined,
              completionTokens: ev.completionTokens ?? undefined,
              totalTokens: ev.totalTokens ?? undefined,
              tokensPerSecond: ev.tokensPerSecond ?? undefined,
              elapsedMs: Date.now() - startedAt,
            };
            setMessagesByChat((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, stats } : m)),
            }));
            setReplyTelemetryByChat((prev) => ({
              ...prev,
              [chatId]: applyReplyTelemetry(prev[chatId], {
                phase: 'streaming', model: ev.model,
                promptTokens: ev.promptTokens,
                completionTokens: ev.completionTokens,
                totalTokens: ev.totalTokens,
                tokensPerSecond: ev.tokensPerSecond,
                timeToFirstToken: ev.timeToFirstToken,
                drafted: ev.drafted,
                accepted: ev.accepted,
              }),
            }));
            // Totals are engine-scoped, so reconcile them separately without
            // letting that response replace this chat's request-local facts.
            const statsSeq = statsGate.current.next();
            void fetchStats().then((s) => { if (statsGate.current.isLatest(statsSeq)) setStats(s); }).catch(() => undefined);
          } else if (ev.type === 'done') {
            streamCompleted = true;
            setReplyTelemetryByChat((prev) => ({
              ...prev,
              [chatId]: finishReplyTelemetry(prev[chatId], 'complete'),
            }));
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
        setReplyTelemetryByChat((prev) => ({
          ...prev,
          [chatId]: finishReplyTelemetry(
            prev[chatId],
            controller.signal.aborted ? 'stopped' : failed || !streamCompleted ? 'error' : 'complete',
          ),
        }));
        // Titles and replies stay out of the notification: lock screens are not private.
        if (!controller.signal.aborted) notifyIfAway(failed ? 'Reply failed' : 'Reply ready', failed ? 'noevia could not finish answering.' : 'noevia finished answering.', `reply-${chatId}`, 'replyFinished');
        sendingChats.current.delete(chatId);
        // The engine loads models on demand, so a reply can change what is loaded (#205).
        notifyModelsChanged();
        if (streamAbort.current[chatId] === controller) delete streamAbort.current[chatId];
        setStreamingChats((prev) => {
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
        // A chat deleted mid-reply stays deleted: no settle write, no save.
        if (!deletedChats.current.has(chatId)) {
          persistAfterCommit.current.add(chatId);
          setMessagesByChat((prev) => ({
            ...prev,
            [chatId]: (prev[chatId] ?? []).map((m) => (m.id === replyId && m.toolCalls ? { ...m, toolCalls: settleToolCalls(m.toolCalls) } : m)),
          }));
        }
      }
    },
    [refreshProjects, streamingChats, queueMetaUpsert],
  );

  // A Cowork turn (#236): start a task on the code harness through /api/chat (the server guards
  // admin, the harness flag and the project) and show it as an inline task card. A refusal is an
  // error reply with Retry; it is never quietly re-run as a Chat turn.
  const handleCoworkSend = useCallback(
    async (chatId: string, projectId: string, text: string, repository: string) => {
      if (streamingChats[chatId] || sendingChats.current.has(chatId)) return;
      sendingChats.current.add(chatId);
      const pendingLoad = historyLoads.current[chatId];
      const loaded = pendingLoad ? await pendingLoad : null;
      const existing = loaded ? resolveLoadedHistory(messagesRef.current[chatId] ?? [], loaded) : messagesRef.current[chatId] ?? [];
      const replyId = uid();
      setMessagesByChat(prev => ({ ...prev, [chatId]: [...existing, { id: uid(), role: 'user', content: text },
        { id: replyId, role: 'assistant', content: '', senderLabel: 'Cowork', processingStatus: 'starting a task…' }] }));
      setStreamingChats(prev => ({ ...prev, [chatId]: true }));
      const sentAt = Date.now();
      queueMetaUpsert(projectId, chatId, (meta) => meta
        ? { ...meta, preview: text.slice(0, 200), updatedAt: sentAt, mode: 'cowork' }
        : { id: chatId, title: text.slice(0, 80), preview: text.slice(0, 200), updatedAt: sentAt, mode: 'cowork' });
      let patch: Partial<Message>;
      try {
        const task = await startCowork({ projectId, chatId, repository, message: text });
        patch = { content: `Started a Cowork task in **${task.repository || repository}**${task.branch ? ` on branch \`${task.branch}\`` : ''}.`,
          coworkTask: { projectId, taskId: task.taskId, repository: task.repository || repository }, processingStatus: undefined };
      } catch (err) {
        patch = { content: `Cowork task did not start — ${err instanceof Error ? err.message : 'unknown error'}`, error: true, coworkRepository: repository, processingStatus: undefined };
      }
      sendingChats.current.delete(chatId);
      setStreamingChats(prev => { const next = { ...prev }; delete next[chatId]; return next; });
      if (!deletedChats.current.has(chatId)) {
        persistAfterCommit.current.add(chatId);
        setMessagesByChat(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(m => (m.id === replyId ? { ...m, ...patch } : m)) }));
      }
    },
    [streamingChats, queueMetaUpsert],
  );

  const activeMode: ChatMode = view.kind === 'chat' ? sessionMode(activeChatMeta?.mode, pendingModes[view.chatId]) : 'chat';

  const sendToCurrent = useCallback(
    (text: string, turn: { turnToolboxes?: string[]; notice?: string | null; cowork?: { repository: string } } = {}) => {
      if (view.kind !== 'chat') return;
      const chatId = view.chatId;
      const projectId = view.projectId ?? activeChatMeta?.projectId ?? null;
      if (turn.cowork && projectId) void handleCoworkSend(chatId, projectId, text, turn.cowork.repository);
      else void handleSend(chatId, projectId, text, undefined, turn);
    },
    [activeChatMeta, handleSend, handleCoworkSend, view],
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
    const failed = msgs[index];
    if (failed.coworkRepository && projectId) {
      // Retry on the harness that failed, never on the other one.
      messagesRef.current = { ...messagesRef.current, [chatId]: msgs.slice(0, index - 1) };
      setMessagesByChat(prev => ({ ...prev, [chatId]: msgs.slice(0, index - 1) }));
      void handleCoworkSend(chatId, projectId, msgs[index - 1].content, failed.coworkRepository);
      return;
    }
    void handleSend(chatId, projectId, msgs[index - 1].content, msgs.slice(0, index - 1));
  }, [activeChatMeta, handleSend, handleCoworkSend, streamingChats, view]);

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

  // #356: Regenerate replaces the last completed assistant reply by re-running the same user
  // turn — the same truncate-and-resend `handleSend` path Retry and Edit-and-re-run already use,
  // not a new endpoint. planRegenerate (regenerate.ts) does the guarding and truncation and
  // returns only the original user text plus the transcript before it, so nothing of the old
  // reply itself (routing decision, telemetry, thinking) can leak into the resend.
  const regenerateLast = useCallback((chatId: string, messageId: string) => {
    if (streamingChats[chatId]) return;
    const msgs = messagesRef.current[chatId] ?? [];
    const plan = planRegenerate(msgs, messageId);
    if (!plan) return;
    const projectId = view.kind === 'chat' ? view.projectId ?? activeChatMeta?.projectId ?? null : null;
    void handleSend(chatId, projectId, plan.userText, plan.base);
  }, [activeChatMeta, handleSend, streamingChats, view]);

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
      // No routing sent: the server applies the default from Models → Routing.
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
          // Settings' close must never resolve back into a deleted project (or a chat inside
          // it) — that view is gone even if it was not the one on screen (e.g. reached this
          // project via a chat, then opened Models & routing before deleting it elsewhere).
          navRef.current = withoutProject(navRef.current, id, { kind: 'projects' });
        })
        .catch(() => undefined);
    },
    [refreshProjects],
  );

  // Handles both project chats and free chats (projectId null).
  const handleDeleteChat = useCallback(
    (projectId: string | null, chatId: string) => {
      const req = projectId ? deleteChat(projectId, chatId) : deleteFreeChat(chatId);
      // Resolves to whether the delete happened, for callers that report it (Archived chats, #232).
      return req
        .then(() => {
          // Stop the live reply first so its stream cannot write the chat back, then forget every
          // per-chat record; later saves for this id are refused (see shouldSaveChat).
          deletedChats.current.add(chatId);
          abortStream(chatId);
          loadedChats.current.delete(chatId);
          sendingChats.current.delete(chatId);
          persistAfterCommit.current.delete(chatId);
          delete deferredMerges.current[chatId];
          delete historyRevisions.current[chatId];
          delete historyLoads.current[chatId];
          delete historySaves.current[chatId];
          setStreamingChats((prev) => {
            if (!(chatId in prev)) return prev;
            const next = { ...prev };
            delete next[chatId];
            return next;
          });
          setMessagesByChat((prev) => {
            const next = { ...prev };
            delete next[chatId];
            return next;
          });
          // Only the open chat moves the view: a project chat returns to its project, a free chat
          // to a fresh new chat, so the next message does not go to the deleted id.
          if (viewRef.current.kind === 'chat' && viewRef.current.chatId === chatId) {
            if (projectId) setView({ kind: 'project', id: projectId });
            else startFreeChat();
          }
          // As above (deleting a project): Settings' close must never resolve back into a
          // deleted chat, on screen or not.
          navRef.current = withoutChat(navRef.current, chatId, projectId ? { kind: 'project', id: projectId } : { kind: 'chat', chatId: `c-${uid()}`, projectId: null });
          refreshProjects();
          return true;
        })
        .catch(() => false);
    },
    [refreshProjects, abortStream, startFreeChat],
  );

  // A metadata POST contains the whole list. Save one action at a time per list,
  // reading the latest list only when that action reaches the head of the queue.
  // Keep the UI at its confirmed state until the save succeeds; a failed save
  // then needs no rollback or workspace fetch (which can fail at the same time).
  const handlePatchChat = useCallback(
    (projectId: string | null, chatId: string, patch: Partial<ChatMeta>) => {
      const key = projectId === null ? 'free' : `project:${projectId}`;
      // The chat-list endpoints store at most 120 title characters.
      const savedPatch = typeof patch.title === 'string' ? { ...patch, title: patch.title.slice(0, 120) } : patch;
      const save = async () => {
        const list = projectId === null
          ? freeChatsRef.current
          : projectsRef.current.find((p) => p.id === projectId)?.chats;
        if (!list?.some((c) => c.id === chatId)) return;
        const next = list.map((c) => (c.id === chatId ? { ...c, ...savedPatch } : c));
        try {
          if (projectId === null) await saveFreeChats(next);
          else await saveProjectChats(projectId, next);
          // A workspace GET that began before this save may carry the old meta.
          workspaceRequest.current += 1;
          // A workspace refresh or chat send may have changed other fields while
          // this request was in flight. Apply only this action to the latest list.
          if (projectId === null) {
            freeChatsRef.current = freeChatsRef.current.map((c) => (c.id === chatId ? { ...c, ...savedPatch } : c));
            setFreeChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, ...savedPatch } : c)));
          } else {
            projectsRef.current = projectsRef.current.map((p) => p.id === projectId
              ? { ...p, chats: (p.chats || []).map((c) => (c.id === chatId ? { ...c, ...savedPatch } : c)) }
              : p);
            setProjects((prev) => prev.map((p) => p.id === projectId
              ? { ...p, chats: (p.chats || []).map((c) => (c.id === chatId ? { ...c, ...savedPatch } : c)) }
              : p));
          }
        } catch (e) {
          setProjectError(`Chat change did not save — ${e instanceof Error ? e.message : 'the server rejected it'}. Try again.`);
        }
      };
      const pending = (chatMetaSaves.current.get(key) || Promise.resolve()).then(save);
      chatMetaSaves.current.set(key, pending);
      void pending.finally(() => { if (chatMetaSaves.current.get(key) === pending) chatMetaSaves.current.delete(key); });
    },
    [],
  );

  // #236: before the first message the mode changes in place; after it, the other harness would
  // run on context it never saw, so ChatView asks first and this opens a new session instead.
  const changeMode = useCallback((mode: ChatMode, newSession: boolean) => {
    if (view.kind !== 'chat') return;
    const projectId = view.projectId ?? activeChatMeta?.projectId ?? null;
    if (newSession) {
      const chatId = `c-${uid()}`;
      loadedChats.current.add(chatId);
      setPendingModes(prev => ({ ...prev, [chatId]: mode }));
      setMessagesByChat(prev => ({ ...prev, [chatId]: [] }));
      setView({ kind: 'chat', chatId, projectId });
      return;
    }
    setPendingModes(prev => ({ ...prev, [view.chatId]: mode }));
    if (activeChatMeta) handlePatchChat(activeChatMeta.projectId ?? null, view.chatId, { mode });
  }, [activeChatMeta, handlePatchChat, view]);

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
          setProjectError(prevError => {
            const prev = lastSkippedSignature.current[projectId] || { signature: '', message: '' };
            const { signature, message, show } = resolveSkippedToast(prev, r.skipped || [], prevError);
            lastSkippedSignature.current[projectId] = { signature, message };
            return show === undefined ? prevError : show;
          });
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
      <div className="regular-workspace" style={{display:'contents'}}>
      <Sidebar
        mode={appMode==='code'&&showPreviews?'code':'chat'}
        codePage={codePage}
        onCodePage={setCodePage}
        onEnterCode={() => setAppMode('code')}
        onEnterChat={() => setAppMode('chat')}
        onOpenPlugins={() => { setAppMode('chat'); setView({ kind: 'plugins' }); }}
        onOpenArchived={() => { setAppMode('chat'); setView({ kind: 'archived' }); }}
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
        // Diary is its own space: from Code it switches back to the chat shell and opens it (user review, 2026-09-19).
        onOpenDiary={() => { setAppMode('chat'); setView({ kind: 'diary' }); }}
        diaryEnabled={diaryEnabled}
        onOpenSettings={openSettings}
        health={health}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />

      <div className={`app-stack pane${settingsOpen ? ' has-settings' : ''}`}>
      <div className="app-main" ref={appMain}>
      {/* In flow at the top of the pane: it pushes the view down rather than covering its header. */}
      {featureFlags.codeHarness === true && <ActiveCodeTasks onOpenProject={(id) => { setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'project', id, codeRequest: uid() }); }}/>}
      {appMode === 'code' && showPreviews && <Suspense fallback={<ViewLoading name="coding" active={!settingsOpen} />}><div className="code-mount" style={{display:codeShown?'contents':'none'}}><Coding.View page={codePage} onStartChat={startFreeChatWith} projects={projects} onProjectsChanged={refreshProjects} onOpenProjectCode={(id) => { setAppMode('chat'); setView({ kind: 'project', id, codeRequest: uid() }); }}/><MountedSignal onMounted={() => setCodeShown(true)}/></div></Suspense>}
      <div className="chat-views" style={{display:appMode==='code'&&showPreviews?'none':'contents'}}>
      {view.kind === 'plugins' && <Suspense fallback={<ViewLoading name="customise" active={appMode === 'chat' && !settingsOpen} />}><Customise.View onStartChat={startFreeChatWith} projects={projects} onProjectsChanged={refreshProjects}/></Suspense>}
      {view.kind === 'archived' && <ArchivedChatsView onDelete={handleDeleteChat} onOpenData={() => openSettings('data')}/>}

      {view.kind === 'preview' && showPreviews && <FeaturePreview title={view.title}/> }
      {view.kind === 'models' && (
        <Suspense fallback={<ViewLoading name="Models" active={appMode === 'chat' && !settingsOpen} />}>
          <ModelManager.View key={view.model || 'list'} initialModel={view.model} onBack={() => openSettings('models')} models={models} routes={routes} projects={projects} modelsError={modelsError} />
        </Suspense>
      )}
      {view.kind === 'projects' && (
        <Suspense fallback={<ViewLoading name="projects" active={appMode === 'chat' && !settingsOpen} />}>
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
          key={activeProject.id}
          modelLabel={modelChoiceLabel(activeProject, modelsLoaded && !modelsError ? models : null, autoRolesConfigured)}
          codeRequest={view.codeRequest}
          onOpenModels={() => setPopupOpen(true)}
          onEdit={() => setEditingProjectId(activeProject.id)}
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
          title={activeChatMeta?.title ?? (view.projectId ? tr('sidebar.newTask') : tr('common.newChat'))}
          projectName={activeProject?.name ?? null}
          modelLabel={modelChoiceLabel(activeProject, modelsLoaded && !modelsError ? models : null, autoRolesConfigured)}
          installedModels={modelsLoaded && !modelsError ? models : null}
          messages={messages}
          onEditMessage={editAndResend}
          streaming={view.kind === 'chat' ? !!streamingChats[view.chatId] : false}
          inferenceUp={health.inferenceUp}
          onSend={sendToCurrent}
          mode={activeMode}
          onModeChange={changeMode}
          onRetry={retryLast}
          onRegenerate={regenerateLast}
          onStop={() => { if (view.kind === 'chat') abortStream(view.chatId); }}
          onBack={activeProject ? () => setView({ kind: 'project', id: activeProject.id }) : null}
          onOpenModels={() => setPopupOpen(true)}
          onOpenSettings={() => openSettings()}
          recent={view.projectId ? undefined : recentChats(allChats).filter((c) => c.id !== view.chatId).slice(0, 5).map((c) => ({ id: c.id, title: c.title, projectId: c.projectId ?? null, projectName: c.projectId ? projects.find((p) => p.id === c.projectId)?.name ?? null : null, updatedAt: c.updatedAt }))}
          onOpenRecent={(chatId, projectId) => setView({ kind: 'chat', chatId, projectId })}
        />
      )}

      {diaryEnabled && <div className="diary-mount" style={{ display: view.kind === 'diary' ? 'contents' : 'none' }}><Suspense fallback={<ViewLoading name="diary" active={view.kind === 'diary' && appMode === 'chat' && !settingsOpen} />}><Diary.View inferenceUp={health.inferenceUp} active={view.kind === 'diary'} /></Suspense></div>}

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

      </div>
      {settingsOpen && (
        <Suspense fallback={<ViewLoading name="settings" active={true} settings />}>
        <Settings.View
          key={settingsKey}
          initialSection={settingsSection}
          onSection={setSettingsSection}
          appearanceStatus={appearanceStatus} appearanceError={appearanceError} retryAppearance={retryAppearance}
          onClose={() => {
            // #304: land back where the user actually was, not on a Settings-launched detour
            // (Models & routing, Customise, Archived, Diary) — forgetting it now means a second
            // close never re-shows it, even if a detour's own "back" re-opened Settings.
            const { view: target, next } = resolveSettingsClose(navRef.current);
            navRef.current = next;
            setView(target);
            setSettingsOpen(false);
          }}
          onClosing={() => { if (view.kind !== 'preview') writeLastPlace({ user: accountId, view, settings: null }); }}
          onStartChat={startFreeChatWith}
          onOpenArchived={() => { pendingFromSettingsRef.current = 'data'; setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'archived' }); }}
          onOpenDiary={diaryEnabled ? () => { pendingFromSettingsRef.current = 'diary'; setSettingsOpen(false); setAppMode('chat'); setView({ kind: 'diary' }); } : undefined}
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
      {/* #365: chats only — it used to render on every view (Customise, Settings, Archived,
          Models & routing, Diary) and overlapped Diary's calendar header there. A blank chat
          shows no row of unavailable metrics; they return with the first reply (#239). */}
      {/* A live stream in this session wins; otherwise reply rehydrates from the chat's own last
          completed message so a reload or navigation does not fake an engine outage (#357). */}
      {shouldShowStatsBar(view.kind, messages.length, view.kind === 'chat' && !!replyTelemetryByChat[view.chatId]) && <StatsBar
        stats={stats}
        reply={view.kind === 'chat' ? replyTelemetryByChat[view.chatId] || lastReplyTelemetry(messages) : null}
        routingDecision={routingDecision}
        modelLabel={modelChoiceLabel(activeProject, modelsLoaded && !modelsError ? models : null, autoRolesConfigured)}
      />}
      {view.kind === 'chat' && activeProject && appMode === 'chat' && (
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
      {projectError && (() => {
        const lines = projectError.split('\n').filter(Boolean);
        return (
          <div className="save-error" role="alert">
            {lines.length > 1 ? (
              <ul className="save-error-list">
                {lines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            ) : (
              <span>{projectError}</span>
            )}
            <button onClick={() => setProjectError(null)} aria-label="Dismiss"><ShellIcon name="close" size={16}/></button>
          </div>
        );
      })()}

      </div>
      {shortcutsOpen && <ShortcutsDialog apple={appleKeys} onClose={() => setShortcutsOpen(false)} onOpenSettings={() => { setShortcutsOpen(false); openSettings('keyboard'); }} />}

    </div>
  );
}

/** Tells its parent, before paint, that the lazy view beside it has mounted. */
function MountedSignal({ onMounted }: { onMounted: () => void }): null {
  useLayoutEffect(() => { onMounted(); }, [onMounted]);
  return null;
}
