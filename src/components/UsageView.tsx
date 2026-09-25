import { appLocale } from '../user-preferences';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchProfile, fetchUsage } from '../api';
import type { UsageSummary, UsageTotals } from '../types';

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

// Five buckets, thresholds derived from the busiest day in the window rather
// than fixed token counts: a local single-user deployment and a shared one
// differ by orders of magnitude, and a fixed scale would render one of them
// as a flat, uniform block.
function level(tokens: number, busiest: number): number {
  if (!tokens) return 0;
  if (busiest <= 0) return 1;
  const share = tokens / busiest;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

function Stat({ label, value, hint, name }: { label: string; value: string; hint?: string; name?: boolean }): JSX.Element {
  return <div className="usage-stat">
    <span className="usage-stat-label">{label}</span>
    {/* A model id is a name, not a figure: at headline size it wraps to three
        lines and dwarfs the numbers beside it. */}
    <strong className={`usage-stat-value${name ? ' is-name' : ''}`}>{value}</strong>
    {hint && <span className="usage-stat-hint">{hint}</span>}
  </div>;
}

/** 14 → "2 pm". The hour a person recognises, not a 24-hour bucket index. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown} ${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function UsageView(): JSX.Element {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [aggregate,setAggregate]=useState(false);
  // Admin gates the all-accounts scope. This used to ride on the pricing
  // endpoint's `admin` flag, which meant deleting cost estimates would have
  // silently removed the toggle too; ask the profile directly instead.
  const [isAdmin,setIsAdmin]=useState(false);
  const [window_, setWindow] = useState<'7' | '30' | 'all'>('30');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setData(null);
    void fetchProfile().then(p=>{if(live)setIsAdmin(p.user.role==='admin');}).catch(()=>undefined);
    fetchUsage(aggregate)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError('Usage could not be loaded.'); });
    return () => { live = false; };
  }, [attempt,aggregate]);

  if (error) return <><div className="settings-title"><h1>Usage</h1></div><p className="route-note" role="alert">{error}</p><button className="btn btn-secondary" onClick={() => setAttempt(n => n + 1)}>Retry usage</button>{aggregate&&<button className="btn btn-secondary" onClick={()=>setAggregate(false)}>Return to your usage</button>}</>;
  if (!data) return <><div className="settings-title"><h1>Usage</h1></div><p className="route-note">Loading…</p></>;

  const totals: UsageTotals = window_ === '7' ? data.last7 : window_ === '30' ? data.last30 : data.allTime;
  const label = window_ === 'all' ? 'retained history' : `last ${window_} days`;
  const busiest = Math.max(0, ...data.days.map((d) => d.input + d.output));
  const everUsed = data.allTime.replies > 0;
  const toolCalls = data.tools.reduce((sum, t) => sum + t.calls, 0);

  // Column-major weeks so the grid reads left-to-right in time, like a
  // contribution graph: each column is a week, each row a weekday.
  const grid = data.days;
  const activeDay = grid.find((day) => day.day === selectedDay) ?? grid[grid.length - 1];
  const firstWeekday = grid.length ? new Date(`${grid[0].day}T12:00:00`).getDay() : 0;
  const cells = [...Array.from({ length: firstWeekday }, () => null), ...grid];
  const weeks = Math.max(1, Math.ceil(cells.length / 7));
  const monthMarks: { col: number; label: string }[] = [];
  grid.forEach((d, i) => {
    const date = new Date(`${d.day}T12:00:00`);
    if (date.getDate() === 1) monthMarks.push({ col: Math.floor((i + firstWeekday) / 7), label: MONTHS[date.getMonth()] });
  });

  return <>
    <div className="settings-title">
      <h1>Usage</h1>
      <p>Provider-reported usage for ordinary chats and optional Diary tool preparation. Companion-only Diary generation and providers that omit usage are not counted.</p>
    </div>

    {isAdmin&&<div className="usage-window" role="group" aria-label="Usage scope"><button aria-pressed={!aggregate} onClick={()=>setAggregate(false)}>Your account</button><button aria-pressed={aggregate} onClick={()=>setAggregate(true)}>All accounts</button></div>}
    {data.aggregate&&<p className="route-note">Aggregated across {data.aggregate.accounts} current accounts. Snapshot {new Date(data.aggregate.checkedAt).toLocaleTimeString(appLocale())} · cached up to 30 seconds.{data.aggregate.unreadableAccounts>0?` Incomplete: ${data.aggregate.unreadableAccounts} accounts could not be read.`:''}</p>}
    {!everUsed && (
      <p className="route-note">
        No usage recorded yet. Counting started when this feature shipped, so replies generated
        before then are not included — they still show their own token counts in the chat.
      </p>
    )}

    <section className="usage-section">
      <div className="usage-section-head">
        <div><h2>Tokens · {label}</h2><p>What the models read and wrote for you.</p></div>
        <div className="usage-window" role="group" aria-label="Time window">
          {(['7', '30', 'all'] as const).map((w) => (
            <button key={w} className={window_ === w ? 'is-active' : ''} aria-pressed={window_ === w} onClick={() => setWindow(w)}>
              {w === 'all' ? 'Retained history' : `${w} days`}
            </button>
          ))}
        </div>
      </div>
      <div className="usage-stat-grid">
        <Stat label="Total" value={compact(totals.input + totals.output)} hint="Input and output." />
        <Stat label="Input" value={compact(totals.input)} hint="Prompt and context." />
        <Stat label="Output" value={compact(totals.output)} hint="Generated by the model." />
        <Stat label="Model responses" value={totals.replies.toLocaleString(appLocale())} hint={`Provider responses, ${label}.`} />
      </div>
    </section>

    <section className="usage-section">
      <div className="usage-section-head">
        <div><h2>Activity</h2><p>The last {data.retentionDays} days, in {data.timeZone} time. A response counts when its provider reports usage; cancelled or unreported responses may be absent.</p></div>
      </div>
      {grid.length === 0 && <p className="route-note">No daily activity recorded yet.</p>}
      <div className="usage-heatmap-scroll">
        <div className="usage-heatmap-inner">
          {/* The month strip must share the grid's exact column pitch (cell +
              gap). It previously used wider columns *and* the same gap, so the
              labels drifted right by the difference on every week and ran past
              the end of the grid by the end of the year. */}
          <div className="usage-months" style={{ gridTemplateColumns: `repeat(${weeks}, 10px)` }}>
            {monthMarks.map((m, i) => <span key={`${m.label}-${i}`} style={{ gridColumnStart: m.col + 1 }}>{m.label}</span>)}
          </div>
          <div className="usage-grid-row">
            {/* Rows are weekdays, Sunday first. Without labels there is no way
                to tell which row a square belongs to. */}
            <div className="usage-weekdays" aria-hidden="true">
              {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((label, i) => <span key={i}>{label}</span>)}
            </div>
            <div className="usage-heatmap" role="group" aria-label={`Daily activity for the last ${data.retentionDays} days. ${data.activeDays} active days. Select a day for details.`}>
              {cells.map((d, i) => d === null
                ? <span key={`pad-${i}`} className="usage-cell is-pad" />
                : <button
                    key={d.day}
                    type="button"
                    className={`usage-cell level-${level(d.input + d.output, busiest)}`}
                    aria-label={`${d.day}: ${d.replies} ${d.replies === 1 ? 'response' : 'responses'}, ${d.input} input tokens, ${d.output} output tokens`}
                    aria-pressed={activeDay?.day === d.day}
                    tabIndex={activeDay?.day === d.day ? 0 : -1}
                    onClick={() => setSelectedDay(d.day)}
                    onKeyDown={(event) => {
                      const offset = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7 }[event.key as 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft'];
                      const target = event.key === 'Home' ? 0 : event.key === 'End' ? grid.length - 1 : offset === undefined ? -1 : Math.max(0, Math.min(grid.length - 1, grid.findIndex((day) => day.day === d.day) + offset));
                      if (target < 0) return;
                      event.preventDefault();
                      setSelectedDay(grid[target].day);
                      const targetButton = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[target];
                      targetButton?.focus();
                    }}
                  />)}
            </div>
          </div>
        </div>
      </div>
      <div className="usage-legend">
        <span>{data.activeDays} active days</span>
        <span className="usage-scale">Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`usage-cell level-${l}`} />)} More</span>
      </div>
      {activeDay && <div className="usage-day-detail" aria-live="polite">
        <label htmlFor="usage-day-picker">Inspect a day</label>
        <input id="usage-day-picker" type="date" min={grid[0].day} max={grid[grid.length - 1].day} value={activeDay.day} onChange={(event) => setSelectedDay(event.target.value)} />
        <p><strong>{activeDay.day}</strong> · {activeDay.replies.toLocaleString()} {activeDay.replies === 1 ? 'response' : 'responses'} · {activeDay.input.toLocaleString()} input tokens · {activeDay.output.toLocaleString()} output tokens</p>
      </div>}
    </section>

    <section className="usage-section">
      <div className="usage-stat-grid">
        <Stat label="Peak hour" value={data.peakHour ? hourLabel(data.peakHour.hour) : '—'} hint={data.peakHour ? `${data.peakHour.replies.toLocaleString(appLocale())} ${data.peakHour.replies === 1 ? 'reply' : 'replies'}, ${data.timeZone}.` : 'Recorded from the first reply after this shipped.'} />
        <Stat label="Favourite model" value={data.models[0]?.name || '—'} hint={data.models[0] ? `${compact(data.models[0].input + data.models[0].output)} tokens, retained history.` : undefined} name />
        <Stat label="Tool calls" value={compact(toolCalls)} hint={toolCalls ? `${data.tools.length} ${data.tools.length === 1 ? 'tool' : 'tools'} used.` : 'Counted from the first tool run after this shipped.'} />
        <Stat label="Current streak" value={`${data.currentStreak} ${data.currentStreak === 1 ? 'day' : 'days'}`} hint="Send a message today to keep it." />
        <Stat label="Longest streak" value={`${data.longestStreak} ${data.longestStreak === 1 ? 'day' : 'days'}`} />
        <Stat label="Active days" value={String(data.activeDays)} hint="Days you sent at least one message." />
        <Stat label="Responses · retained history" value={data.allTime.replies.toLocaleString(appLocale())} />
      </div>
    </section>

    {data.tools.length > 0 && (
      <section className="usage-section">
        <div className="usage-section-head"><div><h2>Tools</h2><p>Calls the model made, retained history, busiest first. Failed calls are counted too.</p></div></div>
        <div className="card-list">
          {data.tools.map((t) => (
            <div className="model-row" key={t.name}>
              <div className="model-name-group"><span className="model-name">{t.name}</span></div>
              <span className="model-role">{t.calls.toLocaleString(appLocale())} {t.calls === 1 ? 'call' : 'calls'}</span>
            </div>
          ))}
        </div>
      </section>
    )}

    {data.models.length > 0 && (
      <section className="usage-section">
        <div className="usage-section-head"><div><h2>By model</h2><p>Retained history, busiest first.</p></div></div>
        <div className="card-list">
          {data.models.map((m) => (
            <div className="model-row" key={m.name}>
              <div className="model-name-group">
                <span className="model-name">{m.name}</span>
                <span className="model-quant">{m.replies.toLocaleString(appLocale())} {m.replies === 1 ? 'reply' : 'replies'} · {compact(m.input)} in / {compact(m.output)} out</span>
              </div>
              <span className="model-role">{compact(m.input + m.output)}</span>
            </div>
          ))}
        </div>
      </section>
    )}
  </>;
}
