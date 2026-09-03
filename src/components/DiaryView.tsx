import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { DiaryCorpus } from '../types';
import { ChevronLeft, ChevronRight } from './Icons';

interface DiaryViewProps {
  corpus: DiaryCorpus | null;
  corpusError: string | null;
  modelLabel: string;
  busy: boolean;
  outcome: string | null;
  onSend: (text: string) => void;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Day headers inside a month file: `## Thursday, September 3, 2026` (real corpus format). */
const DAY_RE = /^## ([A-Za-z]+), ([A-Za-z]+) (\d{1,2}), (\d{4})/;

const MONTH_ABBR: Record<string, string> = {
  January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr',
  May: 'May', June: 'Jun', July: 'Jul', August: 'Aug',
  September: 'Sep', October: 'Oct', November: 'Nov', December: 'Dec',
};

function parseMonthFile(text: string): {
  days: { day: string; count: number }[];
  questions: string[];
  timeline: string[];
} {
  const days: { day: string; count: number }[] = [];
  let current: { day: string; count: number } | null = null;
  const questions: string[] = [];
  const timeline: string[] = [];
  let section: 'diary' | 'open-questions' | 'timeline' = 'diary';

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();

    if (line.startsWith('## ')) {
      const m = DAY_RE.exec(line);
      if (m) {
        current = { day: `${MONTH_ABBR[m[2]] ?? m[2]} ${m[3]}`, count: 0 };
        days.push(current);
        section = 'diary';
      } else if (/^## open questions/i.test(line)) {
        section = 'open-questions';
        current = null;
      } else if (/^## timeline/i.test(line)) {
        section = 'timeline';
        current = null;
      } else {
        current = null;
      }
      continue;
    }

    if (section === 'open-questions') {
      const bullet = line.match(/^[-*] (.+)$/);
      if (bullet) questions.push(bullet[1].trim());
      continue;
    }
    if (section === 'timeline') {
      const bullet = line.match(/^[-*] (.+)$/);
      if (bullet) timeline.push(bullet[1].trim());
      continue;
    }

    if (current && line.startsWith('**Me:**')) current.count += 1;
  }

  return { days, questions, timeline };
}

export function DiaryView({ corpus, corpusError, modelLabel, busy, outcome, onSend }: DiaryViewProps): JSX.Element {
  const [monthOffset, setMonthOffset] = useState(0);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft('');
  };

  const parsed = useMemo(() => (corpus ? parseMonthFile(corpus.todayLog) : null), [corpus]);

  const monthLabel = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }, [monthOffset]);

  return (
    <div className="main">
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="header-title">Diary</span>
          <div className="month-nav">
            <button
              className="month-nav-btn"
              onClick={() => setMonthOffset((v) => Math.min(3, v + 1))}
              disabled={monthOffset >= 3}
              title="Previous month"
            >
              <ChevronLeft />
            </button>
            <span className="month-nav-label">{monthLabel}</span>
            <button
              className="month-nav-btn"
              onClick={() => setMonthOffset((v) => Math.max(0, v - 1))}
              disabled={monthOffset === 0}
              title="Next month"
            >
              <ChevronRight />
            </button>
          </div>
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 'var(--radius-pill)',
            background: 'var(--accent-2-soft)',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--accent-2)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-ink)' }}>Auto → {modelLabel}</span>
        </div>
      </div>

      <div className="diary-body">
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
        <div className="diary-transcript">
          {corpusError && (
            <div className="msg" data-role="assistant">
              <span className="msg-sender">Diary sidecar</span>
              <div className="bubble">
                <p style={{ color: 'var(--accent)' }}>{corpusError}</p>
              </div>
            </div>
          )}
          {!corpusError && corpus && <CorpusTranscript todayLog={corpus.todayLog} />}
          {!corpus && !corpusError && (
            <div className="empty-state">
              <h2>Diary</h2>
              <p>Connecting to the diary sidecar…</p>
            </div>
          )}
        </div>

        <div className="composer">
          <div className="composer-inner">
            <textarea
              className="composer-input"
              rows={1}
              placeholder="Write today's entry…"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button className="send-btn" onClick={submit} disabled={busy || !draft.trim()} title="Send">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--send-icon)"><path d="M4 12l16-8-6 8 6 8-16-8z" /></svg>
            </button>
          </div>
          <div className="composer-hint">
            {busy ? 'Logging through the diary pipeline…' : 'Every exchange is skip-classified and auto-logged to Nextcloud by the diary pipeline'}
          </div>
          {outcome && (
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '4px 4px 0' }}>
              <span className={`diary-outcome${outcome === 'ok' ? ' is-logged' : outcome.startsWith('error') ? ' is-error' : ''}`}>
                {outcome === 'ok' ? '● logged to diary' : outcome.startsWith('error') ? `● ${outcome}` : '● skipped — not diary-worthy'}
              </span>
            </div>
          )}
        </div>
        </div>

        <div className="rail">
          <div className="rail-section">
            <div className="rail-label">This month</div>
            <div className="rail-rows">
              {(!parsed || parsed.days.length === 0) && (
                <p className="rail-empty">No day headers parsed from the live month file yet.</p>
              )}
              {parsed?.days.map((d) => (
                <div key={d.day} className="rail-row">
                  <span className="rail-day">{d.day}</span>
                  <span className="rail-count">
                    {d.count} {d.count === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          <div className="rail-section">
            <div className="rail-label">Open questions</div>
            {parsed && parsed.questions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {parsed.questions.map((q, i) => (
                  <p key={i} className="rail-question">{q}</p>
                ))}
              </div>
            ) : (
              <p className="rail-empty">No Open Questions section in this month's file yet.</p>
            )}
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          <div className="rail-section">
            <div className="rail-label">Timeline of key events</div>
            <div className="timeline">
              {parsed && parsed.timeline.length > 0 ? (
                parsed.timeline.map((t, i) => (
                  <div key={i} className="timeline-item">
                    <div className="timeline-dot-wrap">
                      <span className="timeline-dot key" />
                    </div>
                    <p>{t}</p>
                  </div>
                ))
              ) : (
                <p className="rail-empty">No Timeline entries in this month's file yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Renders a month-file body as the mockup's day/time/Me/Claude transcript structure. */
function CorpusTranscript({ todayLog }: { todayLog: string }): JSX.Element {
  const nodes: JSX.Element[] = [];
  let key = 0;
  let buffer: string[] = [];
  let mode: 'none' | 'me' | 'claude' | 'time' = 'none';

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text) return;
    if (mode === 'me') {
      nodes.push(
        <div key={key++} className="msg" data-role="user">
          <span className="msg-sender">Me</span>
          <p>{text}</p>
        </div>,
      );
    } else if (mode === 'claude') {
      nodes.push(
        <div key={key++} className="msg" data-role="assistant">
          <span className="msg-sender is-assistant">Claude</span>
          <div className="bubble"><p>{text}</p></div>
        </div>,
      );
    } else if (mode === 'time') {
      nodes.push(
        <div key={key++} className="time-topic">{text}</div>,
      );
    }
  };

  for (const raw of todayLog.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      flush();
      mode = 'none';
      nodes.push(
        <div key={key++} className="day-divider">
          <span>{line.slice(3).trim()}</span>
        </div>,
      );
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      mode = 'time';
      buffer = [line.slice(4).trim()];
      continue;
    }
    if (line.startsWith('**Me:**')) {
      flush();
      mode = 'me';
      buffer = [line.slice(7).trim()];
      continue;
    }
    if (line.startsWith('**Claude:**')) {
      flush();
      mode = 'claude';
      buffer = [line.slice(11).trim()];
      continue;
    }
    if (mode !== 'none' && line.startsWith('<!--')) continue; // hidden xid markers
    buffer.push(line);
  }
  flush();

  return <>{nodes}</>;
}
