import { ChatContext } from './ChatContext';
import { useChatScroll } from '../useChatScroll';
import { ReasoningControl, thinkingLevelLabel, useReasoningSettings } from './ReasoningControl';
import { ProjectIcon } from './ProjectIdentity';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { Message, MessageStats, Project, InstalledModel, RoutingDecision } from '../types';
import { ChevronLeft, SendIcon, SlidersIcon } from './Icons';
import { Icon } from './icons/Icon';
import { ComposerModel } from './ComposerModel';
import { MarkdownPreview } from './DiaryModal';
import { ModelPopup } from './ModelPopup';
import { ToolCalls } from './ToolCalls';
import { SourceChips } from './SourceChips';
import { ComposerTextarea } from './ComposerTextarea';
import { modelChoiceLabel } from '../model-guidance';
import { ComposerActions, useAttachmentDrop } from './ComposerActions';
import { apiFetch } from '../api';
import { isDisplayableRoutingDecision } from '../current-routing';
import { useAccountPreferences, appLocale } from '../user-preferences';
import { sendHintText, useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { isApple } from './shortcuts/shortcuts';
import { ComposerModeBar, ModeCaption, ModeConfirm, ModeToggle, useCoworkAccess, useModeSwitch } from './ComposerModeBar';
import { ToolCatalogue } from './ToolCatalogue';
import { CoworkTaskCard } from './CoworkTaskCard';
import { decideDispatch, type ChatMode } from '../chat-mode';
import { insertMention, turnBoxesFor, type PermittedBox } from '../tool-catalogue';
import { readDraft, writeDraft, clearDraft } from '../chat-drafts';
import { onCancelEdit, focusAfterRender, type EditFocusState } from '../edit-focus';
import { isCoarsePointerDevice } from '../composer-focus';
import { useSpaceTier } from '../space-tier';
import { SkillPinSelect, useSkillPinOptions } from './SkillPinPicker';
import type { SkillPin } from '../api-contract';
import { formatDuration, formatNumber } from '../number-format';

/** What one send carries besides its text: per-turn boxes, a fallback notice, or a Cowork task. */
/** `skill` (#272) pins one exact reviewed Skill version for this message only. */
export interface SendTurn { turnToolboxes?: string[]; notice?: string | null; cowork?: { repository: string }; skill?: SkillPin }

interface ChatViewProps {
  project: Project | null;
  onProjectChanged: () => void | Promise<void>;
  title: string;
  projectName: string | null;
  modelLabel: string;
  installedModels?: InstalledModel[] | null;
  messages: Message[];
  streaming: boolean;
  inferenceUp?: boolean | null;
  onSend: (text: string, turn?: SendTurn) => void;
  /** The session's harness (#236) and how to change it; `newSession` forks instead of switching. */
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode, newSession: boolean) => void;
  onRetry: (chatId: string, messageId: string) => void;
  onRegenerate: (chatId: string, messageId: string) => void;
  onEditMessage: (chatId: string, messageId: string, text: string) => void;
  chatId: string;
  onStop: () => void;
  onBack: (() => void) | null;
  onOpenModels: () => void;
  onOpenSettings: () => void;
  /** #510: the header's sliders open this chat's own settings — its project's, or, for a chat
   *  outside a project, its model and tools — instead of a second way into Settings. */
  onEditProject?: (projectId: string) => void;
  /** #552: a source chip under a reply opens that file in the project's Sources tab. */
  onOpenSource?: (projectId: string, file: string) => void;
  /** Home only (#239): the latest chats to pick up from, with their project names. */
  recent?: { id: string; title: string; projectId: string | null; projectName: string | null; updatedAt: number }[];
  onOpenRecent?: (chatId: string, projectId: string | null) => void;
  /** #527: in phone-sized space the live inference block (model, speed, routing) is not in the
   *  page; App hands it here and it shows in the model sheet. Null when the strip would be hidden. */
  sheetStatus?: ReactNode;
}

/** "12s", "1m 05s": how long the thinking took, the way people say it. */
export function thinkingDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function ThinkingBlock({ text, live, ms }: { text: string; live: boolean; ms?: number }) {
  // Open while the model is still thinking so the reasoning is visible as it
  // streams, then collapsed once the answer lands — the answer is what you
  // want to read, with the reasoning one click away. `open` is uncontrolled
  // after the first render, so a reader who expands a finished block keeps it
  // expanded.
  const t = useT();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  // English keeps its compact "1m 05s"; every other locale names its own units (#608).
  const took = (span: number) => t.locale.startsWith('en') ? thinkingDuration(span) : formatDuration(Math.max(1, Math.round(span / 1000)), t.locale);
  return (
    <details className="thinking-block" open={live}>
      <summary className={live ? 'thinking-live' : undefined}>
        {/* A time when this client saw the thinking happen; otherwise (an older chat, another
            device) the length, which is what is known. One thinks for a time, not for words. */}
        {live ? t('chat.think.live') : ms ? t('chat.think.thoughtFor', { duration: took(ms) }) : words ? t.plural('chat.think.words', words, { count: formatNumber(words, t.locale, 0) }) : t('chat.think.process')}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}

const ROUTE_REASONS = ['disabled', 'no-backend', 'missing-roles', 'deadline', 'no-backend-answered', 'low-confidence', 'rejected'] as const;

export function RoutingDetails({ decision }: { decision: RoutingDecision }) {
  const t = useT();
  if (!isDisplayableRoutingDecision(decision)) return null;
  const source = decision.model === 'convaiinnovations/laya' ? 'Laya'
    : decision.backend === 'llama-logit' ? t('chat.route.srcLocalLogit')
    : decision.backend === 'decision-service' ? t('chat.route.srcDecision') : t('chat.route.srcLegacy');
  const fallbackId = ROUTE_REASONS.find(id => id === decision.fallbackReason) || 'unavailable';
  const reason = t(`chat.route.why.${fallbackId}` as MessageKey);
  const offered = decision.offered.slice(0, 3).filter(option => option && ['fast', 'smart', 'code'].includes(option.id) && typeof option.label === 'string')
    .map(option => ({ ...option, label: option.label.slice(0, 200) }));
  const scores = decision.scores && typeof decision.scores === 'object' ? decision.scores : {};
  const selectedRole = typeof decision.selectedRole === 'string' && ['fast', 'smart', 'code'].includes(decision.selectedRole) ? decision.selectedRole : null;
  return <details className="thinking-block routing-details">
    <summary>{t(decision.status === 'fallback' ? 'chat.route.summaryFallback' : 'chat.route.summary', { source, role: decision.effectiveRole })}</summary>
    <div className="routing-details-body">
      <p>{decision.status === 'accepted' ? t('chat.route.accepted') : t('chat.route.fallback', { reason })}{Number.isFinite(decision.latencyMs) ? ` · ${formatNumber(Math.round(decision.latencyMs!), t.locale, 0)} ms` : ''}</p>
      {selectedRole && selectedRole !== decision.effectiveRole && <p>{t('chat.route.selectedUsed', { selected: selectedRole, used: decision.effectiveRole })}</p>}
      {offered.length > 0 && <ul>{offered.map(option => <li key={option.id}>
        <span><strong>{option.id}</strong> · {option.label}</span>
        <span>{Object.hasOwn(scores, option.id) && Number.isFinite(scores[option.id]) ? String(scores[option.id]) : '—'}</span>
      </li>)}</ul>}
      <small>{t('chat.route.scoresNote')}</small>
    </div>
  </details>;
}

function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${formatNumber(s, appLocale(), 1)} s`;
  return formatDuration(Math.round(s), appLocale());
}

// Compact per-reply footer: what it cost and how long it took. Mirrors the
// agent-runner status lines the operator asked for — elapsed, tokens, rate —
// but only renders what the provider actually reported, so a provider that
// sends no usage chunk simply shows nothing rather than zeros.
function MessageMeta({ stats }: { stats?: MessageStats }): JSX.Element | null {
  const t = useT();
  const parts: string[] = [];
  if (stats?.elapsedMs) parts.push(fmtDuration(stats.elapsedMs));
  if (stats?.totalTokens) {
    const io =
      stats.promptTokens != null && stats.completionTokens != null
        ? ` ${t('chat.meta.split', { input: formatNumber(stats.promptTokens, appLocale(), 0), output: formatNumber(stats.completionTokens, appLocale(), 0) })}`
        : '';
    parts.push(`${t('chat.meta.tokens', { tokens: formatNumber(stats.totalTokens, appLocale(), 0) })}${io}`);
  }
  if (stats?.tokensPerSecond) parts.push(`${formatNumber(stats.tokensPerSecond, appLocale(), 1)} ${t('stats.tokPerSecUnit')}`);
  if (!parts.length) return null;
  return <div className="msg-meta">{parts.join(' · ')}</div>;
}

// #356: Copy (every finished reply) and Regenerate (the last one only) — hover/focus actions
// matching the existing "Edit and re-run" and code-block Copy affordances rather than a new
// visual language. Copy takes the reply's own Markdown source (`content`), never the rendered
// HTML and never the thinking block, which lives in a separate field entirely.
export function MessageActions({ content, canRegenerate, onRegenerate, regenerateDisabled }: {
  content: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
  regenerateDisabled: boolean;
}): JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="msg-actions">
      <button
        type="button"
        className="msg-action-btn"
        onClick={() => {
          void navigator.clipboard?.writeText(content).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
            () => undefined,
          );
        }}
        aria-label={t('msg.copy')}
      >
        {copied ? t('msg.copied') : t('msg.copy')}
      </button>
      {canRegenerate && (
        <button
          type="button"
          className="msg-action-btn"
          onClick={onRegenerate}
          disabled={regenerateDisabled}
          aria-label={t('msg.regenerate')}
        >
          {t('msg.regenerate')}
        </button>
      )}
    </div>
  );
}

// Elapsed-time ticker shown while a reply is still streaming, so a long
// local-model generation does not look hung.
export function LiveTimer({ startedAt }: { startedAt: number }): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  return <span>{fmtDuration(Date.now() - startedAt)}</span>;
}


export function ChatView({
  title,
  project,
  onProjectChanged,
  projectName,
  modelLabel,
  installedModels,
  messages,
  streaming,
  inferenceUp = null,
  onSend,
  mode = 'chat',
  onModeChange = () => {},
  onRetry,
  onRegenerate,
  onEditMessage,
  chatId,
  onStop,
  onBack,
  onOpenModels,
  onOpenSettings,
  onEditProject,
  onOpenSource,
  recent,
  onOpenRecent,
  sheetStatus = null,
}: ChatViewProps): JSX.Element {
  const [freeModels, setFreeModels] = useState(false);
  const { sendKey } = useAccountPreferences();
  const t = useT();
  const phone = useSpaceTier() === 2;
  // The project name (with its icon) sits wherever the language puts {project}.
  const projectLead = t('chat.empty.project').split('{project}');
  const keyHint = sendHintText(t, sendKey, typeof navigator !== 'undefined' && isApple(navigator.platform || navigator.userAgent));
  const [freeContext, setFreeContext] = useState<Project | null>(null);
  useEffect(() => {
    setFreeContext(null);
    if (project) return;
    let current = true;
    apiFetch(`/api/chats/${encodeURIComponent(chatId)}/context`, { method: 'POST' }).then(async response => {
      if (!response.ok) throw new Error('Could not load chat tools');
      const value = await response.json(); if (current) setFreeContext(value.project);
    }).catch(err => { if (current) setActionStatus(String(err)); });
    return () => { current = false; };
  }, [chatId, project?.id]);
  const refreshContext = async () => {
    if (project) { await onProjectChanged(); return; }
    const response = await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/context`);
    if (!response.ok) throw new Error('Could not refresh chat attachments');
    setFreeContext((await response.json()).project);
  };
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  // #393: seeded from this chat's own saved draft (if any) rather than always
  // starting blank, so a page reload restores it the same way switching back
  // to the chat does — see the `[chatId]` effect below and chat-drafts.ts.
  const [draft, setDraft] = useState(() => readDraft(chatId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Cancelling an edit (or the Escape shortcut) returns focus to the message's own Edit
  // button rather than letting it fall to <body> (#355); keyed per message since more than
  // one bubble can exist.
  const editTriggers = useRef<Map<string, HTMLButtonElement>>(new Map());
  const editFocus = useRef<EditFocusState>({ pendingFocusId: null });
  const cancelEdit = (id: string) => { editFocus.current = onCancelEdit(id); setEditingId(null); };
  // The trigger button unmounts (and drops out of editTriggers) the instant editingId is set, and
  // only remounts on the render where it goes back to null — after this effect's own render, so
  // by the time it runs the map entry cancelEdit needs is back (#355).
  useLayoutEffect(() => {
    const { focusId, next } = focusAfterRender(editingId, editFocus.current);
    editFocus.current = next;
    if (focusId) editTriggers.current.get(focusId)?.focus();
  }, [editingId]);
  const { scrollRef, onScroll, follow, atBottom } = useChatScroll(chatId, messages, true, streaming);
  // #435: the composer textarea is `disabled` for the duration of a send, which most browsers
  // resolve by blurring it to <body> — nothing then puts focus back. Two different guarantees,
  // on the same falling edge of `streaming`:
  //  - Stop is a deliberate action on the composer, so focus always returns to it, even though
  //    the Stop/Send button is the same DOM node across the transition (same element type at the
  //    same position — React reuses it, so a mouse click leaves focus sitting on that button, not
  //    on <body>) — `stopRequestedRef` marks that this particular end-of-stream was asked for.
  //  - A send that runs to completion only reclaims focus if it is still sitting on <body> — i.e.
  //    the composer held it going in and nothing else has claimed it since. A user who clicked
  //    into something else during the reply keeps their own focus exactly where they put it.
  // Neither guarantee applies on a coarse pointer (touch): programmatically focusing a text field
  // there pops the on-screen keyboard over the reply the person is trying to read, which is a
  // worse outcome than leaving focus on <body>. `isCoarsePointerDevice` is the one thing worth
  // pulling out into its own module — it needs no ref, no DOM beyond `window`, so it has its own
  // test independent of this effect.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerBox = useRef<HTMLDivElement | null>(null);
  // #527: on a phone the composer floats over the transcript, which keeps room under its last
  // message for the composer's height (--composer-h), staying pinned to the bottom as it grows.
  const workspaceRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = workspaceRef.current, box = composerBox.current;
    if (!root || !box) return;
    if (!phone || typeof ResizeObserver === 'undefined') { root.style.removeProperty('--composer-h'); return; }
    const sync = () => {
      const scroller = scrollRef.current;
      const pinned = !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
      root.style.setProperty('--composer-h', `${Math.ceil(box.getBoundingClientRect().height)}px`);
      if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(box);
    return () => { observer.disconnect(); root.style.removeProperty('--composer-h'); };
  }, [phone]);
  const wasStreamingRef = useRef(streaming);
  const stopRequestedRef = useRef(false);
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = streaming;
    if (!wasStreaming || streaming || typeof document === 'undefined' || isCoarsePointerDevice()) return;
    const stopped = stopRequestedRef.current;
    stopRequestedRef.current = false;
    if (stopped || document.activeElement === document.body) composerRef.current?.focus();
  }, [streaming]);
  // When the current stream began, for the live elapsed counter. Reset on each
  // new stream rather than on every message change, or the timer would restart
  // mid-reply as tokens arrive.
  const streamStart = useRef<number>(Date.now());
  useEffect(() => {
    if (streaming) streamStart.current = Date.now();
  }, [streaming]);
  // An in-progress edit must not survive switching chats. Nor must an unsent
  // composer draft (#393): ChatView is not remounted on chat switch (no
  // `key={chatId}`, deliberately — that would also drop scroll position and
  // in-flight streaming state), so `draft` has to be swapped for the newly
  // opened chat's own saved draft here rather than relying on fresh state.
  useEffect(() => {
    setActionStatus('');
    setEditingId(null);
    setEditDraft('');
    setDraft(readDraft(chatId));
  }, [chatId]);


  // #527: phone-sized space gets the compact floating composer, and the model button opens one
  // bottom sheet with the model, Thinking and the live status (see the render below).
  const [phoneSheet, setPhoneSheet] = useState(false);
  const [contextSlot, setContextSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { if (!phone) setPhoneSheet(false); }, [phone]);
  const openModels = () => {
    if (phone && (project || freeContext)) { setPhoneSheet(true); return; }
    if (!project && freeContext) setFreeModels(true); else onOpenModels();
  };
  // #510: the header's sliders open this chat's own settings (Settings is in the account menu).
  const headerSettings = project && onEditProject ? { label: t('sidebar.projectSettings'), open: () => onEditProject(project.id) }
    : { label: t('modelPopup.title'), open: openModels };
  // Always defer to the chat's own context object once it exists, exactly like a project (App.tsx)
  // does — gating this on routing==='auto' || model let a manual choice with no model yet picked
  // silently keep showing the inherited Auto default, disagreeing with the picker reading the same
  // object directly (#352).
  if (!project && freeContext) modelLabel = modelChoiceLabel(freeContext, installedModels ?? null);
  const coworkAccess = useCoworkAccess(project?.id ?? null);
  const [repository, setRepository] = useState<string | null>(null);
  useEffect(() => {
    setRepository(current => current && coworkAccess.repositories.includes(current) ? current : coworkAccess.repositories[0] ?? null);
  }, [coworkAccess.repositories]);
  const modeSwitch = useModeSwitch({ mode, messageCount: messages.length, projectId: project?.id ?? null, access: coworkAccess, repository, onModeChange });
  const chatConfig = project || freeContext;
  // The phone model button names a thinking level only when the sheet can offer one; with the
  // effort settings unavailable the sheet has no Thinking section, so the button drops the suffix.
  const thinkingAvailable = !!useReasoningSettings(chatConfig, phone);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [turnBoxes, setTurnBoxes] = useState<string[]>([]);
  const [permitted, setPermitted] = useState<PermittedBox[]>([]);
  // Per-turn choices belong to the next message in this chat only.
  // #272: one exact reviewed Skill version for the next message, from the portable manifest API.
  // Re-read when the project changes and after each reply, so a disabled or edited skill drops out.
  const [skillPin, setSkillPin] = useState('');
  useEffect(() => { setTurnBoxes([]); setCatalogueOpen(false); setPermitted([]); setSkillPin(''); }, [chatId, mode, project?.id]);
  const skillOptions = useSkillPinOptions(project?.id ?? null, `${project?.updatedAt ?? ''}:${streaming}`, mode !== 'cowork');
  useEffect(() => { if (skillPin && !skillOptions.some(option => option.value === skillPin)) setSkillPin(''); }, [skillOptions, skillPin]);
  // A lone "/" opens the catalogue; typing continues to filter there instead of the message.
  const onDraft = (value: string) => {
    if (value === '/' && draft === '') { setCatalogueOpen(true); return; }
    setDraft(value);
    // Written under the chatId captured by *this* call, not read from a later
    // effect — keeps a fast chat switch from ever saving one chat's keystroke
    // under another chat's key (#393).
    writeDraft(chatId, value);
  };
  const submit = () => {
    const text = draft.trim();
    if (!text || streaming || actionBusy) return;
    follow();
    const decision = decideDispatch({ mode, harnessEnabled: coworkAccess.harnessEnabled, canUseCode: coworkAccess.canUseCode, projectId: project?.id ?? null, repository });
    if (decision.harness === 'cowork' && repository) onSend(text, { cowork: { repository } });
    else onSend(text, { turnToolboxes: turnBoxesFor(text, permitted, turnBoxes), notice: decision.notice, ...(skillPin ? { skill: skillPin as SkillPin } : {}) });
    setDraft('');
    clearDraft(chatId);
    setTurnBoxes([]);
    setSkillPin('');
  };
  // #437: the whole chat pane is the drop target, not just the composer bar, so a file dropped
  // anywhere over the transcript still attaches — through the exact same pipeline (validation,
  // size limits, error copy) `ComposerActions`'s own picker uses below.
  const { isDragOver, dropProps } = useAttachmentDrop({
    project: project || freeContext, disabled: streaming || actionBusy, chatOnly: !project,
    onChanged: refreshContext, onBusy: setActionBusy, onStatus: setActionStatus,
  });

  const catalogue = <ToolCatalogue open={catalogueOpen} onOpenChange={setCatalogueOpen} projectId={project?.id ?? null} mode={mode}
    toggled={turnBoxes} onToggle={id => setTurnBoxes(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])}
    onMention={name => { const next = insertMention(draft, name); setDraft(next); writeDraft(chatId, next); }} onBoxes={setPermitted} disabled={streaming || actionBusy}
    focusFallback={() => composerBox.current?.querySelector<HTMLElement>('.composer-add')?.focus()} />;
  const skillPicker = <SkillPinSelect options={skillOptions} value={skillPin} onChange={setSkillPin} disabled={streaming || actionBusy} />;

  return (
    <main ref={workspaceRef} className={`main chat-workspace${messages.length === 0 ? ' is-empty' : ''}${isDragOver ? ' is-drag-over' : ''}`} {...dropProps}>
      {isDragOver && (
        <div className="chat-drop-overlay" aria-hidden="true"><span>{t('composer.dropHint')}</span></div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{isDragOver ? t('composer.dropHint') : ''}</span>
      {phone && phoneSheet && chatConfig && <ModelPopup projects={[chatConfig]} activeProject={project ?? { ...chatConfig, name: title }}
        onClose={() => setPhoneSheet(false)} onProjectsChanged={() => void refreshContext()}
        status={<section className="mp-col mp-status" aria-labelledby="mp-status-title">
          <h3 className="mp-col-title" id="mp-status-title">{t('stats.ariaLabel')}</h3>
          {sheetStatus}
          <div ref={setContextSlot} className="mp-context-slot"/>
        </section>}
        thinking={<ReasoningControl variant="list" project={chatConfig} disabled={streaming || actionBusy} onChanged={refreshContext} />} />}
      {freeModels && freeContext && <ModelPopup projects={[freeContext]} activeProject={{...freeContext, name: title}} onClose={()=>setFreeModels(false)} onProjectsChanged={()=>void refreshContext()} />}
      <div className="chat-header">
        <div className="header-titles">
          <span className="header-crumbs">
            {projectName && onBack ? (
              <>
                <button className="crumb-back" onClick={onBack} title={`Back to ${projectName}`}>
                  <ChevronLeft />
                  {project && <ProjectIcon project={project} size={15}/>}
                  <span>{projectName}</span>
                </button>
                <span className="crumb-sep">/</span>
              </>
            ) : null}
            <span className="header-title">{title}</span>
          </span>
        </div>
        <div className="header-controls">
          <button className="icon-btn" onClick={headerSettings.open} title={headerSettings.label} aria-label={headerSettings.label}>
            <SlidersIcon size={15} />
          </button>
        </div>
      </div>

      {inferenceUp === false && (
        <div className="conn-banner" role="status">
          Inference is unreachable right now — messages will fail until it's back.
          Check the model backend in <button className="conn-banner-link" onClick={onOpenSettings}>Settings</button>.
        </div>
      )}

      <div className="transcript" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="empty-state">
            {/* #429: this is the page's only heading — Home (no project) and a project's own
                fresh chat (view.kind==='chat', mutually exclusive with ProjectView's own
                <h1 className="project-title">) both rendered no <h1> at all, only this <h2>,
                which itself only exists while the transcript is empty. Visual size/weight is
                unchanged; only the semantic level moves up to close the gap ahead of
                "Recent chats" (<h2 id="home-recents-title">) below it. */}
            <h1>{projectName ? <>{projectLead[0]}{project && <ProjectIcon project={project} size={26}/>}{projectName}{projectLead[1]}</> : t('chat.empty.title')}</h1>
            <p>
              {projectName ? t('chat.empty.projectIntro') : t('chat.empty.intro')}
            </p>
            {/* Why a first reply cannot start yet, said once and plainly (#239). */}
            {installedModels && installedModels.length === 0 && <p className="home-diagnostic" role="status">{t('chat.noModel')} <button className="link-button" onClick={() => window.dispatchEvent(new CustomEvent('noevia:open-model-settings', { detail: {} }))}>{t('chat.openModels')}</button></p>}
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const thinkingLive = streaming && isLast && m.role === 'assistant' && !m.content;
          return (
            <div key={m.id} className="msg" data-role={m.role}>
              {/* The bubble side already says who spoke; only the answering model is worth showing. */}
              {m.role === 'user'
                ? <span className="msg-sender sr-only">{t('chat.sender.you')}</span>
                : <span className="msg-sender is-assistant"><span className="sr-only">{t('chat.sender.assistant')} · </span>{(m.senderLabel ?? modelLabel).replace(/^Assistant · /, '')}</span>}
              {m.role === 'assistant' ? (
                <div className="assistant-card">
                  {m.reasoningMode && m.reasoningMode !== 'off' && <small className="reasoning-result">Effort: {m.reasoningEffort} · {m.reasoningMode === 'real' ? 'provider parameter' : 'best-effort hint'}</small>}
                  {m.warning && <p className="msg-warning" role="status">{m.warning}</p>}
                  {(m.toolScope || m.skillScope) && <small className="tool-scope" title="What noevia gave the model for this reply">{m.toolScope && <>Using: {m.toolScope}</>}{m.toolScope && m.skillScope && ' · '}{m.skillScope && <>Skill: {m.skillScope}</>}</small>}
                  {m.routingDecision && <RoutingDetails decision={m.routingDecision} />}
                  {m.reasoning ? <ThinkingBlock text={m.reasoning} ms={m.reasoningMs} live={!!thinkingLive && !m.content} /> : null}
                  {m.toolCalls && m.toolCalls.length > 0 ? <ToolCalls calls={m.toolCalls} /> : null}
                  {m.coworkTask ? <CoworkTaskCard task={m.coworkTask} disabled={streaming || actionBusy}
                    onRetry={() => { const prompt = messages[i - 1]?.role === 'user' ? messages[i - 1].content : ''; if (prompt) onSend(prompt, { cowork: { repository: m.coworkTask!.repository } }); }} /> : null}
                  {m.content ? (
                    <div className="bubble">
                      {/* Model replies are Markdown. A bare <p> showed the raw
                          source (**bold**, list dashes) and collapsed every
                          newline, so multi-section answers arrived as one wall
                          of text. Errors stay plain — they are our own strings,
                          not model output. */}
                      {m.error ? (
                        <p style={{ color: 'var(--accent-text)' }}>{m.content}</p>
                      ) : (
                        <MarkdownPreview text={m.content} />
                      )}
                      {m.error && isLast && (
                        <button
                          className="msg-retry"
                          onClick={() => onRetry(chatId, m.id)}
                          disabled={streaming || actionBusy}
                          title="Re-send your last message"
                        >
                          ↻ Retry
                        </button>
                      )}
                    </div>
                  ) : (
                    streaming && isLast && !m.reasoning && (
                      <div className="bubble">
                        <span className="typing"><i /><i /><i /></span>
                      </div>
                    )
                  )}
                  {project && m.content && !m.error && m.sources && m.sources.length > 0 && (
                    <SourceChips sources={m.sources} files={project.files} onOpen={onOpenSource ? (file) => onOpenSource(project.id, file) : undefined} />
                  )}
                  {streaming && isLast && !m.error ? (
                    <div className="msg-meta" aria-live="off">
                      <LiveTimer startedAt={streamStart.current} />
                      {m.reasoning && !m.content ? ' · thinking…' : ` · ${m.processingStatus || 'generating…'}`}
                    </div>
                  ) : (
                    !m.error && <MessageMeta stats={m.stats} />
                  )}
                  {/* Copy on every finished reply; Regenerate only on the last one, and never
                      while it (or anything else in this chat) is still streaming (#356). */}
                  {m.content && !m.error && !(streaming && isLast) && (
                    <MessageActions
                      content={m.content}
                      canRegenerate={isLast && !m.coworkTask}
                      onRegenerate={() => onRegenerate(chatId, m.id)}
                      regenerateDisabled={streaming || actionBusy}
                    />
                  )}
                </div>
              ) : (
                editingId === m.id ? (
                  <div className="msg-edit">
                    <textarea
                      value={editDraft}
                      autoFocus
                      rows={Math.min(12, editDraft.split('\n').length + 1)}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { cancelEdit(m.id); return; }
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          const text = editDraft.trim();
                          if (!text) return;
                          setEditingId(null);
                          onEditMessage(chatId, m.id, text);
                        }
                      }}
                      aria-label="Edit your message and re-run from here"
                    />
                    <div className="msg-edit-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          const text = editDraft.trim();
                          if (!text) return;
                          setEditingId(null);
                          onEditMessage(chatId, m.id, text);
                        }}
                        disabled={streaming || !editDraft.trim()}
                      >
                        Save &amp; re-run
                      </button>
                      <button className="btn btn-secondary" onClick={() => cancelEdit(m.id)}>Cancel</button>
                      <small>Everything after this message is replaced.</small>
                    </div>
                  </div>
                ) : (
                  <div className="msg-user-row">
                    <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
                    <button
                      ref={(el) => { if (el) editTriggers.current.set(m.id, el); else editTriggers.current.delete(m.id); }}
                      className="msg-edit-btn"
                      onClick={() => { setEditingId(m.id); setEditDraft(m.content); }}
                      disabled={streaming || actionBusy || mode === 'cowork'}
                      title={mode === 'cowork' ? 'Cowork tasks are not re-run by editing; send a new task instead' : 'Edit this message and re-run the conversation from here'}
                      aria-label="Edit and re-run from this message"
                    >
                      ✎ Edit
                    </button>
                  </div>
                )
              )}
            </div>
          );
        })}
        {!atBottom && messages.length > 0 && (
          <button type="button" className="jump-to-latest" onClick={follow} aria-label={t('chat.jumpToLatest')}>
            <Icon name="arrow-down" size={13} strokeWidth={2.25} />
            {t('chat.jumpToLatest')}
          </button>
        )}
      </div>

      <div className="composer" ref={composerBox}>
        <ChatContext key={chatId} chatId={chatId} projectId={project?.id || null} messages={messages} streaming={streaming} onBusy={setActionBusy}
          portalTo={phone ? (phoneSheet ? contextSlot : null) : undefined} />
        {phone ? (
          // #527: no separate mode row on a phone. The toggle sits in the composer; this slim line
          // only appears when the caption says something (the Cowork repository, or that a Cowork
          // turn will go as chat), and anchors the tool catalogue that the + menu opens.
          <div className="composer-mode-bar is-slim" data-caption={modeSwitch.caption}>
            <div className="composer-mode-row">
              {/* The plain chat line is hidden by the tier-1 rule; the live region itself stays put. */}
              <ModeCaption state={modeSwitch} disabled={streaming || actionBusy} onRepository={setRepository} />
              {catalogue}{skillPicker}
            </div>
            <ModeConfirm state={modeSwitch} />
          </div>
        ) : (
          <ComposerModeBar mode={mode} messageCount={messages.length} projectId={project?.id ?? null} disabled={streaming || actionBusy}
            access={coworkAccess} repository={repository} onRepository={setRepository} onModeChange={onModeChange}>
            {catalogue}{skillPicker}
          </ComposerModeBar>
        )}
        <div className={`composer-inner chat-composer-inner pane${phone ? ' is-compact' : ''}`}>
          <ComposerTextarea
            ref={composerRef}
            aria-label={t('composer.message')}
            rows={phone ? 1 : 2}
            placeholder={t('composer.placeholder')}
            value={draft}
            disabled={streaming || actionBusy}
            onValue={onDraft}
            onSubmit={submit}
          />
          <ComposerActions chatOnly={!project} key={chatId} project={project || freeContext} disabled={streaming || actionBusy} onChanged={refreshContext} onModels={openModels} onBusy={setActionBusy} onStatus={setActionStatus}
            browseTools={{ onOpen: () => setCatalogueOpen(true), count: turnBoxes.length }} />
          {phone && <ModeToggle state={modeSwitch} disabled={streaming || actionBusy} compact />}
          <ComposerModel label={modelLabel} onClick={openModels}
            compact={phone ? { thinking: chatConfig && thinkingAvailable ? thinkingLevelLabel(t, chatConfig.reasoningEffort) : null, live: streaming } : undefined} />
          {!phone && <ReasoningControl project={project || freeContext} disabled={streaming || actionBusy} onChanged={refreshContext} />}
          {streaming ? (
            <button className="send-btn glass glass-lens is-primary is-press" onClick={() => { stopRequestedRef.current = true; onStop(); }} title={t('composer.stop')} aria-label={t('composer.stop')}>
              <span aria-hidden="true">&#9632;</span>
            </button>
          ) : (
            <button className="send-btn glass glass-lens is-primary is-press" onClick={submit} disabled={!draft.trim() || actionBusy} title={t('composer.send')} aria-label={t('composer.send')}>
              <SendIcon />
            </button>
          )}
        </div>
        {actionStatus && <div className="composer-action-status" role="status">{actionStatus}</div>}
        <div className={`composer-hint${projectName ? '' : ' is-keyboard'}`}>
          {projectName ? t('composer.projectContext', { name: projectName }) : keyHint}
        </div>
        {messages.length === 0 && !project && recent && <section className="home-recents" aria-labelledby="home-recents-title">
          <h2 id="home-recents-title">{t('sidebar.recentChats')}</h2>
          {recent.length ? <ul>{recent.map((c) => <li key={c.id}><button onClick={() => onOpenRecent?.(c.id, c.projectId)}>
            <span className="home-recent-title">{c.title || t('common.newChat')}</span>
            <span className="home-recent-meta">{c.projectName ? `${c.projectName} · ` : ''}{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString(appLocale(), { month: 'short', day: 'numeric' }) : ''}</span>
          </button></li>)}</ul> : <p className="home-recent-empty">{t('composer.noRecent')}</p>}
        </section>}
      </div>
    </main>
  );
}
