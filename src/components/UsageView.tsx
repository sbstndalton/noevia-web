import { appLocale } from '../user-preferences';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchProfile, fetchUsage } from '../api';
import type { UsageSummary, UsageTotals } from '../types';
import { useT } from '../i18n';

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

/** 14 → "2 pm" (or "14 Uhr"). The hour a person recognises, not a 24-hour bucket index;
 *  English keeps its 12-hour clock, other languages their own. `locale` is `appLocale()` — the
 *  same formatter every other date/number on this page already uses (#405) — so `undefined`
 *  ("system": let the browser's own Intl default decide, including its hour cycle) is expected. */
function hourLabel(hour: number, locale: string | undefined): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: locale?.startsWith('en') ? true : undefined }).format(new Date(2000, 0, 1, hour));
  } catch {
    const shown = hour % 12 === 0 ? 12 : hour % 12;
    return `${shown} ${hour < 12 ? 'am' : 'pm'}`;
  }
}

/** Short month and weekday names, formatted with `appLocale()` (#405). */
const shortName = (locale: string | undefined, date: Date, part: 'month' | 'weekday') => {
  try { return new Intl.DateTimeFormat(locale, { [part]: 'short' }).format(date); } catch { return new Intl.DateTimeFormat('en-GB', { [part]: 'short' }).format(date); }
};

export function UsageView(): JSX.Element {
  const t = useT();
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState(false);
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
    setError(false);
    setData(null);
    void fetchProfile().then(p=>{if(live)setIsAdmin(p.user.role==='admin');}).catch(()=>undefined);
    fetchUsage(aggregate)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [attempt,aggregate]);

  if (error) return <><div className="settings-title"><h1>{t('settings.section.usage')}</h1></div><p className="route-note" role="alert">{t('usage.loadError')}</p><button className="btn btn-secondary" onClick={() => setAttempt(n => n + 1)}>{t('usage.retry')}</button>{aggregate&&<button className="btn btn-secondary" onClick={()=>setAggregate(false)}>{t('usage.returnToYours')}</button>}</>;
  if (!data) return <><div className="settings-title"><h1>{t('settings.section.usage')}</h1></div><p className="route-note">{t('settings.loading')}</p></>;

  const totals: UsageTotals = window_ === '7' ? data.last7 : window_ === '30' ? data.last30 : data.allTime;
  const label = window_ === 'all' ? t('usage.retainedHistoryLower') : t('usage.lastDays', { count: window_ });
  const busiest = Math.max(0, ...data.days.map((d) => d.input + d.output));
  const everUsed = data.allTime.replies > 0;
  const toolCalls = data.tools.reduce((sum, tool) => sum + tool.calls, 0);

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
    if (date.getDate() === 1) monthMarks.push({ col: Math.floor((i + firstWeekday) / 7), label: shortName(appLocale(), date, 'month') });
  });

  return <>
    <div className="settings-title">
      <h1>{t('settings.section.usage')}</h1>
      <p>{t('usage.intro')}</p>
    </div>

    {isAdmin&&<div className="usage-window" role="group" aria-label={t('usage.scope')}><button aria-pressed={!aggregate} onClick={()=>setAggregate(false)}>{t('usage.yourAccount')}</button><button aria-pressed={aggregate} onClick={()=>setAggregate(true)}>{t('usage.allAccounts')}</button></div>}
    {data.aggregate&&<p className="route-note">{t.plural('usage.aggregated', data.aggregate.accounts, { time: new Date(data.aggregate.checkedAt).toLocaleTimeString(appLocale()) })}{data.aggregate.unreadableAccounts>0?` ${t.plural('usage.incomplete', data.aggregate.unreadableAccounts)}`:''}</p>}
    {!everUsed && (
      <p className="route-note">{t('usage.nothingYet')}</p>
    )}

    <section className="usage-section">
      <div className="usage-section-head">
        <div><h2>{t('usage.tokens', { window: label })}</h2><p>{t('usage.tokensIntro')}</p></div>
        <div className="usage-window" role="group" aria-label={t('usage.timeWindow')}>
          {(['7', '30', 'all'] as const).map((w) => (
            <button key={w} className={window_ === w ? 'is-active' : ''} aria-pressed={window_ === w} onClick={() => setWindow(w)}>
              {w === 'all' ? t('usage.retainedHistory') : t('usage.days', { count: w })}
            </button>
          ))}
        </div>
      </div>
      <div className="usage-stat-grid">
        <Stat label={t('usage.total')} value={compact(totals.input + totals.output)} hint={t('usage.totalHint')} />
        <Stat label={t('usage.input')} value={compact(totals.input)} hint={t('usage.inputHint')} />
        <Stat label={t('usage.output')} value={compact(totals.output)} hint={t('usage.outputHint')} />
        <Stat label={t('usage.modelResponses')} value={totals.replies.toLocaleString(appLocale())} hint={t('usage.modelResponsesHint', { window: label })} />
      </div>
    </section>

    <section className="usage-section">
      <div className="usage-section-head">
        <div><h2>{t('usage.activity')}</h2><p>{t('usage.activityIntro', { count: data.retentionDays, zone: data.timeZone })}</p></div>
      </div>
      {grid.length === 0 && <p className="route-note">{t('usage.noActivity')}</p>}
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
              {/* 2024-01-01 was a Monday; rows are Sunday first, labelled on Mon, Wed and Fri. */}
              {[null, 1, null, 3, null, 5, null].map((d, i) => <span key={i}>{d === null ? '' : shortName(appLocale(), new Date(2024, 0, d), 'weekday')}</span>)}
            </div>
            <div className="usage-heatmap" role="group" aria-label={t('usage.heatmapLabel', { count: data.retentionDays, active: t.plural('usage.activeDays', data.activeDays) })}>
              {cells.map((d, i) => d === null
                ? <span key={`pad-${i}`} className="usage-cell is-pad" />
                : <button
                    key={d.day}
                    type="button"
                    className={`usage-cell level-${level(d.input + d.output, busiest)}`}
                    aria-label={t('usage.cellLabel', { day: d.day, responses: t.plural('usage.responses', d.replies), input: d.input, output: d.output })}
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
        <span>{t.plural('usage.activeDays', data.activeDays)}</span>
        <span className="usage-scale">{t('usage.less')} {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`usage-cell level-${l}`} />)} {t('usage.more')}</span>
      </div>
      {activeDay && <div className="usage-day-detail" aria-live="polite">
        <label htmlFor="usage-day-picker">{t('usage.inspectDay')}</label>
        <input id="usage-day-picker" type="date" min={grid[0].day} max={grid[grid.length - 1].day} value={activeDay.day} onChange={(event) => setSelectedDay(event.target.value)} />
        <p><strong>{activeDay.day}</strong> · {t.plural('usage.responses', activeDay.replies, { count: activeDay.replies.toLocaleString(appLocale()) })} · {t('usage.inputTokens', { count: activeDay.input.toLocaleString(appLocale()) })} · {t('usage.outputTokens', { count: activeDay.output.toLocaleString(appLocale()) })}</p>
      </div>}
    </section>

    <section className="usage-section">
      <div className="usage-stat-grid">
        <Stat label={t('usage.peakHour')} value={data.peakHour ? hourLabel(data.peakHour.hour, appLocale()) : '—'} hint={data.peakHour ? t('usage.peakHourHint', { replies: t.plural('usage.replies', data.peakHour.replies, { count: data.peakHour.replies.toLocaleString(appLocale()) }), zone: data.timeZone }) : t('usage.peakHourEmpty')} />
        <Stat label={t('usage.favouriteModel')} value={data.models[0]?.name || '—'} hint={data.models[0] ? t('usage.favouriteModelHint', { tokens: compact(data.models[0].input + data.models[0].output) }) : undefined} name />
        <Stat label={t('usage.toolCalls')} value={compact(toolCalls)} hint={toolCalls ? t.plural('usage.toolsUsed', data.tools.length) : t('usage.toolCallsEmpty')} />
        <Stat label={t('usage.currentStreak')} value={t.plural('usage.dayCount', data.currentStreak)} hint={t('usage.currentStreakHint')} />
        <Stat label={t('usage.longestStreak')} value={t.plural('usage.dayCount', data.longestStreak)} />
        <Stat label={t('usage.activeDaysLabel')} value={String(data.activeDays)} hint={t('usage.activeDaysHint')} />
        <Stat label={t('usage.responsesRetained')} value={data.allTime.replies.toLocaleString(appLocale())} />
      </div>
    </section>

    {data.tools.length > 0 && (
      <section className="usage-section">
        <div className="usage-section-head"><div><h2>{t('usage.tools')}</h2><p>{t('usage.toolsIntro')}</p></div></div>
        <div className="card-list">
          {data.tools.map((tool) => (
            <div className="model-row" key={tool.name}>
              <div className="model-name-group"><span className="model-name">{tool.name}</span></div>
              <span className="model-role">{t.plural('usage.calls', tool.calls, { count: tool.calls.toLocaleString(appLocale()) })}</span>
            </div>
          ))}
        </div>
      </section>
    )}

    {data.models.length > 0 && (
      <section className="usage-section">
        <div className="usage-section-head"><div><h2>{t('usage.byModel')}</h2><p>{t('usage.byModelIntro')}</p></div></div>
        <div className="card-list">
          {data.models.map((m) => (
            <div className="model-row" key={m.name}>
              <div className="model-name-group">
                <span className="model-name">{m.name}</span>
                <span className="model-quant">{t.plural('usage.replies', m.replies, { count: m.replies.toLocaleString(appLocale()) })} · {t('usage.inOut', { input: compact(m.input), output: compact(m.output) })}</span>
              </div>
              <span className="model-role">{compact(m.input + m.output)}</span>
            </div>
          ))}
        </div>
      </section>
    )}
  </>;
}
