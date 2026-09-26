import { ChatContext } from './ChatContext';
import { useChatScroll } from '../useChatScroll';
import { ReasoningControl } from './ReasoningControl';
import { ProjectIcon } from './ProjectIdentity';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Message, MessageStats, Project, InstalledModel, RoutingDecision } from '../types';
import { ChevronLeft, SendIcon, SlidersIcon } from './Icons';
import { ComposerModel } from './ComposerModel';
import { MarkdownPreview } from './DiaryModal';
import { ModelPopup } from './ModelPopup';
import { ToolCalls } from './ToolCalls';
import { ComposerTextarea } from './ComposerTextarea';
import { modelChoiceLabel } from '../model-guidance';
import { ComposerActions } from './ComposerActions';
import { apiFetch } from '../api';
import { isDisplayableRoutingDecision } from '../current-routing';
import { useAccountPreferences, appLocale } from '../user-preferences';
import { sendHintText, useT } from '../i18n';
import { isApple } from './shortcuts/shortcuts';
import { ComposerModeBar, useCoworkAccess } from './ComposerModeBar';
import { ToolCatalogue } from './ToolCatalogue';
import { CoworkTaskCard } from './CoworkTaskCard';
import { decideDispatch, type ChatMode } from '../chat-mode';
import { insertMention, turnBoxesFor, type PermittedBox } from '../tool-catalogue';

/** What one send carries besides its text: per-turn boxes, a fallback notice, or a Cowork task. */
export interface SendTurn { turnToolboxes?: string[]; notice?: string | null; cowork?: { repository: string } }

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
  onEditMessage: (chatId: string, messageId: string, text: string) => void;
  chatId: string;
  onStop: () => void;
  onBack: (() => void) | null;
  onOpenModels: () => void;
  onOpenSettings: () => void;
  /** Home only (#239): the latest chats to pick up from, with their project names. */
  recent?: { id: string; title: string; projectId: string | null; projectName: string | null; updatedAt: number }[];
  onOpenRecent?: (chatId: string, projectId: string | null) => void;
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
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <details className="thinking-block" open={live}>
      <summary className={live ? 'thinking-live' : undefined}>
        {/* A time when this client saw the thinking happen; otherwise (an older chat, another
            device) the length, which is what is known. One thinks for a time, not for words. */}
        {live ? 'Thinking…' : ms ? `Thought for ${thinkingDuration(ms)}` : words ? `Thought · ${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}` : 'Thought process'}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}

export function RoutingDetails({ decision }: { decision: RoutingDecision }) {
  if (!isDisplayableRoutingDecision(decision)) return null;
  const source = decision.model === 'convaiinnovations/laya' ? 'Laya'
    : decision.backend === 'llama-logit' ? 'Local logit'
    : decision.backend === 'decision-service' ? 'Decision service' : 'Legacy';
  const fallbackLabel = new Map([
    ['disabled', 'experiment disabled'], ['no-backend', 'service unavailable'], ['missing-roles', 'roles unavailable'],
    ['deadline', 'time limit'], ['no-backend-answered', 'service did not answer'],
    ['low-confidence', 'decision rejected'], ['rejected', 'invalid decision'],
  ]);
  const reason = fallbackLabel.get(typeof decision.fallbackReason === 'string' ? decision.fallbackReason : '') || 'decision unavailable';
  const offered = decision.offered.slice(0, 3).filter(option => option && ['fast', 'smart', 'code'].includes(option.id) && typeof option.label === 'string')
    .map(option => ({ ...option, label: option.label.slice(0, 200) }));
  const scores = decision.scores && typeof decision.scores === 'object' ? decision.scores : {};
  const selectedRole = typeof decision.selectedRole === 'string' && ['fast', 'smart', 'code'].includes(decision.selectedRole) ? decision.selectedRole : null;
  return <details className="thinking-block routing-details">
    <summary>{source} routing · {decision.effectiveRole}{decision.status === 'fallback' ? ' · fallback' : ''}</summary>
    <div className="routing-details-body">
      <p>{decision.status === 'accepted' ? 'Decision accepted' : `Fallback: ${reason}`}{Number.isFinite(decision.latencyMs) ? ` · ${Math.round(decision.latencyMs!)} ms` : ''}</p>
      {selectedRole && selectedRole !== decision.effectiveRole && <p>Selected: {selectedRole} · Used: {decision.effectiveRole}</p>}
      {offered.length > 0 && <ul>{offered.map(option => <li key={option.id}>
        <span><strong>{option.id}</strong> · {option.label}</span>
        <span>{Object.hasOwn(scores, option.id) && Number.isFinite(scores[option.id]) ? String(scores[option.id]) : '—'}</span>
      </li>)}</ul>}
      <small>Scores are uncalibrated preferences, not a probability of a correct route. This service does not provide a prose thought process.</small>
    </div>
  </details>;
}

function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

// Compact per-reply footer: what it cost and how long it took. Mirrors the
// agent-runner status lines the operator asked for — elapsed, tokens, rate —
// but only renders what the provider actually reported, so a provider that
// sends no usage chunk simply shows nothing rather than zeros.
function MessageMeta({ stats }: { stats?: MessageStats }): JSX.Element | null {
  const parts: string[] = [];
  if (stats?.elapsedMs) parts.push(fmtDuration(stats.elapsedMs));
  if (stats?.totalTokens) {
    const io =
      stats.promptTokens != null && stats.completionTokens != null
        ? ` (${stats.promptTokens} in / ${stats.completionTokens} out)`
        : '';
    parts.push(`${stats.totalTokens} tokens${io}`);
  }
  if (stats?.tokensPerSecond) parts.push(`${stats.tokensPerSecond.toFixed(1)} tok/s`);
  if (!parts.length) return null;
  return <div className="msg-meta">{parts.join(' · ')}</div>;
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
  onEditMessage,
  chatId,
  onStop,
  onBack,
  onOpenModels,
  onOpenSettings,
  recent,
  onOpenRecent,
}: ChatViewProps): JSX.Element {
  const [freeModels, setFreeModels] = useState(false);
  const { sendKey } = useAccountPreferences();
  const t = useT();
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
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Cancelling an edit (or the Escape shortcut) returns focus to the message's own Edit
  // button rather than letting it fall to <body> (#355); keyed per message since more than
  // one bubble can exist.
  const editTriggers = useRef<Map<string, HTMLButtonElement>>(new Map());
  const cancelEdit = (id: string) => { setEditingId(null); editTriggers.current.get(id)?.focus(); };
  const { scrollRef, onScroll, follow } = useChatScroll(chatId, messages, true, streaming);
  // When the current stream began, for the live elapsed counter. Reset on each
  // new stream rather than on every message change, or the timer would restart
  // mid-reply as tokens arrive.
  const streamStart = useRef<number>(Date.now());
  useEffect(() => {
    if (streaming) streamStart.current = Date.now();
  }, [streaming]);
  // An in-progress edit must not survive switching chats.
  useEffect(() => {
    setActionStatus('');
    setEditingId(null);
    setEditDraft('');
  }, [chatId]);


  const openModels = () => { if (!project && freeContext) setFreeModels(true); else onOpenModels(); };
  if (!project && freeContext) modelLabel = freeContext.routing === 'auto' || freeContext.model ? modelChoiceLabel(freeContext, installedModels ?? null) : modelLabel;
  const coworkAccess = useCoworkAccess(project?.id ?? null);
  const [repository, setRepository] = useState<string | null>(null);
  useEffect(() => {
    setRepository(current => current && coworkAccess.repositories.includes(current) ? current : coworkAccess.repositories[0] ?? null);
  }, [coworkAccess.repositories]);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [turnBoxes, setTurnBoxes] = useState<string[]>([]);
  const [permitted, setPermitted] = useState<PermittedBox[]>([]);
  // Per-turn choices belong to the next message in this chat only.
  useEffect(() => { setTurnBoxes([]); setCatalogueOpen(false); setPermitted([]); }, [chatId, mode, project?.id]);
  // A lone "/" opens the catalogue; typing continues to filter there instead of the message.
  const onDraft = (value: string) => {
    if (value === '/' && draft === '') { setCatalogueOpen(true); return; }
    setDraft(value);
  };
  const submit = () => {
    const text = draft.trim();
    if (!text || streaming || actionBusy) return;
    follow();
    const decision = decideDispatch({ mode, harnessEnabled: coworkAccess.harnessEnabled, canUseCode: coworkAccess.canUseCode, projectId: project?.id ?? null, repository });
    if (decision.harness === 'cowork' && repository) onSend(text, { cowork: { repository } });
    else onSend(text, { turnToolboxes: turnBoxesFor(text, permitted, turnBoxes), notice: decision.notice });
    setDraft('');
    setTurnBoxes([]);
  };

  return (
    <div className={`main chat-workspace${messages.length === 0 ? ' is-empty' : ''}`}>
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
          <button className="icon-btn" onClick={onOpenSettings} title={t('settings.title')} aria-label={t('settings.title')}>
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
            <h2>{projectName ? <>{projectLead[0]}{project && <ProjectIcon project={project} size={26}/>}{projectName}{projectLead[1]}</> : t('chat.empty.title')}</h2>
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
                ? <span className="msg-sender sr-only">You</span>
                : <span className="msg-sender is-assistant"><span className="sr-only">Assistant · </span>{(m.senderLabel ?? modelLabel).replace(/^Assistant · /, '')}</span>}
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
                  {streaming && isLast && !m.error ? (
                    <div className="msg-meta" aria-live="off">
                      <LiveTimer startedAt={streamStart.current} />
                      {m.reasoning && !m.content ? ' · thinking…' : ` · ${m.processingStatus || 'generating…'}`}
                    </div>
                  ) : (
                    !m.error && <MessageMeta stats={m.stats} />
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
      </div>

      <div className="composer">
        <ChatContext key={chatId} chatId={chatId} projectId={project?.id || null} messages={messages} streaming={streaming} onBusy={setActionBusy} />
        <ComposerModeBar mode={mode} messageCount={messages.length} projectId={project?.id ?? null} disabled={streaming || actionBusy}
          access={coworkAccess} repository={repository} onRepository={setRepository} onModeChange={onModeChange}>
          <ToolCatalogue open={catalogueOpen} onOpenChange={setCatalogueOpen} projectId={project?.id ?? null} mode={mode}
            toggled={turnBoxes} onToggle={id => setTurnBoxes(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])}
            onMention={name => setDraft(d => insertMention(d, name))} onBoxes={setPermitted} disabled={streaming || actionBusy} />
        </ComposerModeBar>
        <div className="composer-inner chat-composer-inner pane">
          <ComposerTextarea
            aria-label={t('composer.message')}
            rows={2}
            placeholder={t('composer.placeholder')}
            value={draft}
            disabled={streaming || actionBusy}
            onValue={onDraft}
            onSubmit={submit}
          />
          <ComposerActions chatOnly={!project} key={chatId} project={project || freeContext} disabled={streaming || actionBusy} onChanged={refreshContext} onModels={openModels} onBusy={setActionBusy} onStatus={setActionStatus} />
          <ComposerModel label={modelLabel} onClick={openModels} />
          <ReasoningControl project={project || freeContext} disabled={streaming || actionBusy} onChanged={refreshContext} />
          {streaming ? (
            <button className="send-btn glass glass-lens is-primary is-press" onClick={onStop} title={t('composer.stop')} aria-label={t('composer.stop')}>
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
    </div>
  );
}
