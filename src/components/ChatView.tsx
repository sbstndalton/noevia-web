import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Message, ToolCallView } from '../types';
import { ChevronDown, ChevronLeft, SendIcon, SlidersIcon } from './Icons';

interface ChatViewProps {
  title: string;
  projectName: string | null;
  modelLabel: string;
  messages: Message[];
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onBack: (() => void) | null;
  onOpenModels: () => void;
  onOpenSettings: () => void;
}

function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  return (
    <details className="thinking-block">
      <summary className={live ? 'thinking-live' : undefined}>
        {live ? 'Thinking…' : 'Thought process'}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
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
  onSend,
  onStop,
  onBack,
  onOpenModels,
  onOpenSettings,
}: ChatViewProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

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
  const subtitle = lastAssistant ? lastAssistant.content.slice(0, 90) : `Local model · ${modelLabel}`;

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

      <div className="transcript" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <h2>{title}</h2>
            <p>
              {projectName
                ? `Part of ${projectName} — instructions, files, and memory from the project are applied to every reply.`
                : `A local chat on ${modelLabel}. Persona and memories live under the model button.`}
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
                      <p style={m.error ? { color: 'var(--accent)' } : undefined}>{m.content}</p>
                    </div>
                  ) : (
                    streaming && isLast && !m.reasoning && (
                      <div className="bubble">
                        <span className="typing"><i /><i /><i /></span>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p>{m.content}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            className="composer-input"
            rows={1}
            placeholder={`Message ${title}…`}
            value={draft}
            disabled={streaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
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
          {projectName ? ` · project context from ${projectName} applied` : ' · persona & memories under the model button'}
        </div>
      </div>
    </div>
  );
}
