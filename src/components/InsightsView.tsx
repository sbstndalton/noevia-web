import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  fetchInsights,
  requestQuestionReflection,
  requestReflection,
} from '../api';
import type { InsightReflection, StandingPayload } from '../api';
import { ChevronLeft } from './Icons';

interface InsightsViewProps {
  onBack: () => void; // back to the diary picker
  onOpenMonth: (monthId: string) => void; // jump to a source entry's month
}

/**
 * Insights — the diary's commentator, made visible.
 *
 * Everything shown here is either the user's own standing sections (Open
 * Questions / Timeline, parsed read-only from INDEX.md) or AI commentary that
 * was generated on explicit request. Commentary is rendered in a visually
 * distinct panel — it is never mixed into the diary transcript, and nothing
 * on this screen writes to the corpus.
 */
export function InsightsView({ onBack, onOpenMonth }: InsightsViewProps): JSX.Element {
  const [standing, setStanding] = useState<StandingPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reflection, setReflection] = useState<InsightReflection | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    fetchInsights()
      .then((s) => {
        if (!stale) setStanding(s);
      })
      .catch(() => {
        if (!stale) setLoadError('Could not reach the diary sidecar.');
      });
    return () => {
      stale = true;
    };
  }, []);

  const reflect = () => {
    if (busy) return;
    setBusy(true);
    requestReflection()
      .then(setReflection)
      .catch((e: unknown) => {
        setReflection({
          kind: 'reflection',
          text: '',
          used_chunks: 0,
          sources: [],
          error: e instanceof Error ? e.message : 'The commentary model could not be reached. Nothing was changed in your diary.',
        });
      })
      .finally(() => setBusy(false));
  };

  const askQuestion = (question: string) => {
    if (busy || !question.trim()) return;
    setBusy(true);
    requestQuestionReflection(question)
      .then(setReflection)
      .catch((e: unknown) => {
        setReflection({
          kind: 'about_question',
          question,
          text: '',
          used_chunks: 0,
          sources: [],
          error: e instanceof Error ? e.message : 'The commentary model could not be reached. Nothing was changed in your diary.',
        });
      })
      .finally(() => setBusy(false));
  };

  const openSources = (sources: { day: string; header: string }[]) => {
    const months = [...new Set(sources.map((s) => s.day.slice(0, 7)))];
    if (months.length === 1) onOpenMonth(months[0]);
  };

  const openQuestions = (standing?.questions || []).filter((q) => !q.resolved);

  return (
    <div className="main">
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="header-title">Insights</span>
          <button className="month-nav-back" onClick={onBack} title="Back to the diary">
            <ChevronLeft />
            <span>Diary</span>
          </button>
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 'var(--radius-pill)',
            background: 'var(--accent-soft)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-ink)' }}>✦ AI commentary — never written into your diary</span>
        </div>
      </div>

      <div className="diary-body">
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, overflowY: 'auto', padding: '18px 18px 24px' }}>
          <div className="insights-hero">
            <h2>What the diary notices</h2>
            <p>
              Ask for an outside perspective whenever you want one. Reflections are
              generated on demand from your open questions and past entries — nothing
              is generated in the background, and nothing here ever becomes a diary entry.
            </p>
            <button className="send-btn insights-reflect-btn" onClick={reflect} disabled={busy} style={{ width: 'auto', padding: '8px 18px', alignSelf: 'flex-start' }}>
              {busy ? 'Reflecting…' : '✦ Reflect'}
            </button>
          </div>

          {reflection && (
            <div className="insight-card" data-kind={reflection.kind}>
              <div className="insight-card-label">✦ AI reflection {reflection.question ? `· ${reflection.question}` : ''}</div>
              {reflection.error ? (
                <p className="insight-error">{reflection.error}</p>
              ) : (
                <>
                  <p className="insight-text">{reflection.text}</p>
                  {reflection.sources.length > 0 && (
                    <div className="insight-sources">
                      <span className="insight-sources-label">Drawn from:</span>
                      {reflection.sources.map((s, i) => (
                        <button key={i} className="insight-source" onClick={() => openSources(reflection.sources)} title="Open these entries in the diary">
                          {s.day}
                        </button>
                      ))}
                    </div>
                  )}
                  {reflection.degraded && (
                    <p className="insight-degraded">Retrieval is unavailable — this reflection used only your standing sections.</p>
                  )}
                </>
              )}
            </div>
          )}

          {loadError && <p style={{ color: 'var(--accent)' }}>{loadError}</p>}

          <div className="insights-section">
            <h3>Open questions</h3>
            {openQuestions.length === 0 && <p className="rail-empty">No open questions yet — they appear here as the diary pipeline notices them.</p>}
            {openQuestions.map((q, i) => (
              <button key={i} className="insight-question" onClick={() => askQuestion(q.text)} disabled={busy} title="Ask for a reflection on this question">
                <span>{q.text}</span>
                <span className="insight-question-hint">✦ reflect</span>
              </button>
            ))}
          </div>

          <div className="insights-section">
            <h3>Timeline of key events</h3>
            {(standing?.timeline || []).length === 0 && <p className="rail-empty">No key events recorded yet.</p>}
            {(standing?.timeline || []).map((t, i) => (
              <div key={i} className="timeline-item">
                <div className="timeline-dot-wrap">
                  <span className="timeline-dot key" />
                </div>
                <p><strong>{t.date}</strong> — {t.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
