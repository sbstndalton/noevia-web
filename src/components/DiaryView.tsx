import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { DiaryCorpus, DiaryMonth } from '../types';
import { ChevronLeft, ChevronRight } from './Icons';

interface DiaryViewProps {
  corpus: DiaryCorpus | null;
  corpusError: string | null;
  months: DiaryMonth[];
  screen: 'picker' | 'month'; // picker = month-selection landing page
  selectedMonthId: string | null; // null = today
  onOpenMonth: (monthId: string | null) => void; // from the picker grid
  onBackToPicker: () => void; // from inside a month
  onSelectMonth: (monthId: string | null) => void; // arrows inside a month
  modelLabel: string;
  busy: boolean;
  outcome: string | null;
  onSend: (text: string) => void;
}

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

export function DiaryView({
  corpus,
  corpusError,
  months,
  screen,
  selectedMonthId,
  onOpenMonth,
  onBackToPicker,
  onSelectMonth,
  modelLabel,
  busy,
  outcome,
  onSend,
}: DiaryViewProps): JSX.Element {
  const [draft, setDraft] = useState('');

  // First-run zero-state: the user has never had any diary content at all —
  // no corpus months exist and today's file is empty or absent. A returning
  // user whose *current* month happens to be empty still has months in the
  // list, so they get the normal (navigable) view instead. Requires the
  // sidecar to be reachable (no corpusError): a down sidecar must show its
  // error, not a welcome message.
  const isFirstRun = !corpusError && months.length === 0 && (!corpus || corpus.todayLog.trim() === '');

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft('');
  };

  const parsed = useMemo(() => (corpus ? parseMonthFile(corpus.todayLog) : null), [corpus]);

  // Real month navigation over the sidecar's month list. `today` is always
  // available as the rightmost stop; arrows step through actual corpus months.
  const nav = useMemo(() => {
    const todayLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const todayEntry: DiaryMonth = { id: '', label: todayLabel }; // id '' = today
    const entries = [...months, todayEntry].filter(
      (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i,
    );
    const idx = selectedMonthId === null ? entries.length - 1 : entries.findIndex((m) => m.id === selectedMonthId);
    const safeIdx = idx === -1 ? entries.length - 1 : idx;
    return {
      entries,
      idx: safeIdx,
      label: entries[safeIdx]?.label ?? todayLabel,
      hasPrev: safeIdx > 0,
      hasNext: safeIdx < entries.length - 1,
    };
  }, [months, selectedMonthId]);

  if (screen === 'picker') {
    return <MonthPicker months={months} onOpenMonth={onOpenMonth} />;
  }

  return (
    <div className="main">
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="header-title">Diary</span>
          {!isFirstRun && (
            <button className="month-nav-back" onClick={onBackToPicker} title="All months">
              <ChevronLeft />
              <span>All months</span>
            </button>
          )}
          {!isFirstRun && (
          <div className="month-nav">
            <button
              className="month-nav-btn"
              onClick={() => onSelectMonth(nav.entries[nav.idx - 1]?.id === '' ? null : nav.entries[nav.idx - 1]?.id ?? null)}
              disabled={!nav.hasPrev}
              title="Previous month"
            >
              <ChevronLeft />
            </button>
            <span className="month-nav-label">{nav.label}</span>
            <button
              className="month-nav-btn"
              onClick={() => onSelectMonth(nav.entries[nav.idx + 1]?.id === '' ? null : nav.entries[nav.idx + 1]?.id ?? null)}
              disabled={!nav.hasNext}
              title="Next month"
            >
              <ChevronRight />
            </button>
          </div>
          )}
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
          {!corpusError && corpus && (
            corpus.todayLog.trim()
              ? <CorpusTranscript todayLog={corpus.todayLog} />
              : isFirstRun
                ? (
                  <div className="diary-zero-hero">
                    <div className="diary-zero-glyph">✍️</div>
                    <h2>Welcome to your diary</h2>
                    <p>
                      Write your first entry below. The diary pipeline classifies
                      what you log and keeps it verbatim — everything stays on your
                      server, in plain text you can read and back up.
                    </p>
                  </div>
                )
                : <div className="empty-state"><h2>No entries</h2><p>This month has no diary file yet.</p></div>
          )}
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
              placeholder={isFirstRun ? 'Enter your first entry…' : "Write today's entry…"}
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
            {busy ? 'Logging through the diary pipeline…' : 'Every exchange is classified and logged to the configured corpus by the diary pipeline'}
          </div>
          {outcome && (
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '4px 4px 0' }}>
              <span className={`diary-outcome${outcome === 'ok' || outcome === 'logged' ? ' is-logged' : outcome.startsWith('error') ? ' is-error' : ''}`}>
                {outcome === 'ok' || outcome === 'logged' ? '● logged to diary' : outcome === 'stopped' ? '● stopped' : outcome.startsWith('error') ? `● ${outcome}` : '● skipped — not diary-worthy'}
              </span>
            </div>
          )}
        </div>
        </div>

        <div className="rail">
          {isFirstRun ? (
            <p className="rail-empty diary-zero-rail">Entries, open questions, and a timeline will appear here as you write.</p>
          ) : (
          <>
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
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Landing page: pick a month. Writing always logs to today. */
function MonthPicker({
  months,
  onOpenMonth,
}: {
  months: DiaryMonth[];
  onOpenMonth: (monthId: string | null) => void;
}): JSX.Element {
  const todayLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const seen = new Set<string>();
  const entries = months.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));

  return (
    <div className="main">
      <div className="settings-scroll">
        <div className="projects-head">
          <div>
            <h1>Diary</h1>
            <p className="projects-head-sub">Pick a month to read — writing an entry always logs to today.</p>
          </div>
        </div>
        <div className="projects-grid">
          <button className="month-card is-today" onClick={() => onOpenMonth(null)}>
            <span className="month-card-emoji">✍️</span>
            <span className="month-card-name">Today</span>
            <span className="month-card-meta">{todayLabel} · write an entry</span>
          </button>
          {entries.map((m) => (
            <button key={m.id} className="month-card" onClick={() => onOpenMonth(m.id)}>
              <span className="month-card-emoji">📔</span>
              <span className="month-card-name">{m.label}</span>
              <span className="month-card-meta">View entries</span>
            </button>
          ))}
          {entries.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1 / -1', minHeight: 220 }}>
              <h2>No months yet</h2>
              <p>Months appear here as the diary service finds files in your configured corpus.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders a month-file body as a day/time/user/assistant transcript. */
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
          <span className="msg-sender is-assistant">Assistant</span>
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
    if (line.startsWith('**Claude:**') || line.startsWith('**Assistant:**')) {
      flush();
      mode = 'claude';
      buffer = [line.replace(/^\*\*(?:Claude|Assistant):\*\*\s*/, '').trim()];
      continue;
    }
    if (mode !== 'none' && line.startsWith('<!--')) continue; // hidden xid markers
    buffer.push(line);
  }
  flush();

  return <>{nodes}</>;
}
