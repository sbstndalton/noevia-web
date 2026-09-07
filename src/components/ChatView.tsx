import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Message, MessageStats, ToolCallView } from '../types';
import { ChevronDown, ChevronLeft, SendIcon, SlidersIcon } from './Icons';
import { MarkdownPreview } from './DiaryModal';

interface ChatViewProps {
  title: string;
  projectName: string | null;
  modelLabel: string;
  messages: Message[];
  streaming: boolean;
  inferenceUp?: boolean | null;
  onSend: (text: string) => void;
  onRetry: (chatId: string, messageId: string) => void;
  onEditMessage: (chatId: string, messageId: string, text: string) => void;
  chatId: string;
  onStop: () => void;
  onBack: (() => void) | null;
  onOpenModels: () => void;
  onOpenSettings: () => void;
}

function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  // Open while the model is still thinking so the reasoning is visible as it
  // streams, then collapsed once the answer lands — the answer is what you
  // want to read, with the reasoning one click away. `open` is uncontrolled
  // after the first render, so a reader who expands a finished block keeps it
  // expanded.
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <details className="thinking-block" open={live}>
      <summary className={live ? 'thinking-live' : undefined}>
        {live ? 'Thinking…' : `Thought process${words ? ` · ${words} words` : ''}`}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
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
function MessageMeta({ stats, tools }: { stats?: MessageStats; tools?: ToolCallView[] }): JSX.Element | null {
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
  if (tools && tools.length) parts.push(`${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`);
  if (!parts.length) return null;
  return <div className="msg-meta">{parts.join(' · ')}</div>;
}

// Elapsed-time ticker shown while a reply is still streaming, so a long
// local-model generation does not look hung.
function LiveTimer({ startedAt }: { startedAt: number }): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  return <span>{fmtDuration(Date.now() - startedAt)}</span>;
}

function ToolChips({ calls }: { calls: ToolCallView[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {calls.map((tc, i) => (
        <span key={i} className="tool-chip">
          ⚒ {tc.name || 'tool'}
          {tc.args ? <code>{tc.args.slice(0, 80)}</code> : null}
        </span>
      ))}
    </div>
  );
}

export function ChatView({
  title,
  projectName,
  modelLabel,
  messages,
  streaming,
  inferenceUp = null,
  onSend,
  onRetry,
  onEditMessage,
  chatId,
  onStop,
  onBack,
  onOpenModels,
  onOpenSettings,
}: ChatViewProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // When the current stream began, for the live elapsed counter. Reset on each
  // new stream rather than on every message change, or the timer would restart
  // mid-reply as tokens arrive.
  const streamStart = useRef<number>(Date.now());
  useEffect(() => {
    if (streaming) streamStart.current = Date.now();
  }, [streaming]);
  // An in-progress edit must not survive switching chats.
  useEffect(() => {
    setEditingId(null);
    setEditDraft('');
  }, [chatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    onSend(text);
    setDraft('');
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.error);
  const subtitle = lastAssistant ? lastAssistant.content.slice(0, 90) : `Conversation · ${modelLabel}`;

  return (
    <div className="main">
      <div className="chat-header">
        <div className="header-titles">
          <span className="header-crumbs">
            {projectName && onBack ? (
              <>
                <button className="crumb-back" onClick={onBack} title={`Back to ${projectName}`}>
                  <ChevronLeft />
                  <span>{projectName}</span>
                </button>
                <span className="crumb-sep">/</span>
              </>
            ) : null}
            <span className="header-title">{title}</span>
          </span>
          <span className="header-subtitle">{subtitle}</span>
        </div>
        <div className="header-controls">
          <button className="model-pill" onClick={onOpenModels} title="Switch model · download · manage">
            <span className="model-pill-dot" />
            <span className="model-pill-label">{modelLabel}</span>
            <ChevronDown />
          </button>
          <button className="icon-btn" onClick={onOpenSettings} title="Settings">
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

      <div className="transcript" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <h2>{title}</h2>
            <p>
              {projectName
                ? `Part of ${projectName} — instructions, files, and memory from the project are applied to every reply.`
                : `A space to think, ask questions, and work things through.`}
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const thinkingLive = streaming && isLast && m.role === 'assistant' && !m.content;
          return (
            <div key={m.id} className="msg" data-role={m.role}>
              <span className={`msg-sender${m.role === 'assistant' ? ' is-assistant' : ''}`}>
                {m.senderLabel ?? (m.role === 'user' ? 'You' : `Assistant · ${modelLabel}`)}
              </span>
              {m.role === 'assistant' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {m.reasoning ? <ThinkingBlock text={m.reasoning} live={!!thinkingLive && !m.content} /> : null}
                  {m.toolCalls && m.toolCalls.length > 0 ? <ToolChips calls={m.toolCalls} /> : null}
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
                          disabled={streaming}
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
                      {m.reasoning && !m.content ? ' · thinking…' : ' · generating…'}
                    </div>
                  ) : (
                    !m.error && <MessageMeta stats={m.stats} tools={m.toolCalls} />
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
                        if (e.key === 'Escape') { setEditingId(null); return; }
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
                      <button className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
                      <small>Everything after this message is replaced.</small>
                    </div>
                  </div>
                ) : (
                  <div className="msg-user-row">
                    <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
                    <button
                      className="msg-edit-btn"
                      onClick={() => { setEditingId(m.id); setEditDraft(m.content); }}
                      disabled={streaming}
                      title="Edit this message and re-run the conversation from here"
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
        <div className="composer-inner">
          <textarea
            className="composer-input"
            aria-label="Message"
            rows={2}
            placeholder={`Message ${title}…`}
            value={draft}
            disabled={streaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {streaming ? (
            <button className="send-btn" onClick={onStop} title="Stop generating">
              <span aria-hidden="true">&#9632;</span>
            </button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={!draft.trim()} title="Send">
              <SendIcon />
            </button>
          )}
        </div>
        <div className="composer-hint">
          Replies with {modelLabel}
          {projectName ? ` · project context from ${projectName} applied` : ' · Enter to send, Shift + Enter for a new line'}
        </div>
      </div>
    </div>
  );
}
