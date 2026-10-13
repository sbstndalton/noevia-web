import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ShellIcon } from './ShellIcon';
import { calendarArrowStep, calendarDays, dayLabel, firstWeekday, localDay, monthLabel, shiftDay } from '../diary-data';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { appLocale } from '../user-preferences';
type Props = { month: string; today: string; days: Record<string,string>; busy: boolean; ready?: boolean; failed?: boolean; navigate: (month: string, day?: string) => void;
  /** #1518: the day that last had focus (the one opened, when coming back from it). Owned by DiaryView so it survives the grid unmounting. */
  focusDay?: string | null; onFocusDay?: (day: string) => void; onRetry?: () => void };
const weekdayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
export function DiaryCalendar({ month, today, days, busy, ready = true, failed = false, navigate, focusDay = null, onFocusDay, onRetry }: Props) {
  const t = useT();
  // #619: month and day names in the interface's Intl locale, and the week starts where that locale's does
  // (Monday for fr/de/es/it/nl/nb/sv, Sunday for en-US). The weekday header rotates with it.
  const locale = appLocale();
  const first = firstWeekday(locale);
  const weekdays = [...weekdayKeys.slice(first), ...weekdayKeys.slice(0, first)];
  const [view,setView] = useState<'calendar'|'list'>('calendar');
  const entries = Object.keys(days).filter(date=>date.startsWith(month) && days[date]?.replace(/^#+.*$/gm,'').trim()).sort().reverse();
  const inMonth = (id: string) => id.startsWith(`${month}-`);
  // #1518: the grid has one tab stop (roving tabindex): the day last focused in this month, else today, else the 1st.
  const tabStop = focusDay && inMonth(focusDay) ? focusDay : inMonth(today) ? today : `${month}-01`;
  // #1518: arrow keys move between days like a date grid (Left/Right one day, Up/Down one week). Days past
  // today and days outside the shown month are not reachable from here; the arrow then does nothing.
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = calendarArrowStep(event.key);
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day;
    if (step === null || !from) return;
    const to = shiftDay(from, step);
    if (!inMonth(to) || to > today) return;
    event.preventDefault();
    onFocusDay?.(to);
    event.currentTarget.querySelector<HTMLElement>(`[data-day="${to}"]`)?.focus();
  };
  const moveMonth = (delta: number) => {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth()+delta);
    navigate(localDay(date).slice(0,7));
  };
  return <section className="diary-calendar-section">
    <div className="diary-view-toggle" role="group" aria-label={t('diary.calendar.viewLabel')}>
      <button className="popup-tab" aria-pressed={view==='calendar'} onClick={()=>setView('calendar')}>{t('diary.calendar.calendar')}</button>
      <button className="popup-tab" aria-pressed={view==='list'} onClick={()=>setView('list')}>{t('diary.calendar.list')}</button>
    </div>
    <div className="diary-calendar-heading">
      <button className="popup-tab" disabled={busy} aria-label={t('diary.calendar.previousMonth')} onClick={() => moveMonth(-1)}><ShellIcon name="left" size={18}/></button>
      <h1>{monthLabel(month, locale)}</h1>
      <button className="popup-tab" disabled={busy || month >= today.slice(0,7)} aria-label={t('diary.calendar.nextMonth')} onClick={() => moveMonth(1)}><ShellIcon name="right" size={18}/></button>
    </div>
    <p>{view==='calendar' ? t('diary.calendar.chooseDay') : t('diary.calendar.entriesThisMonth')}</p>
    {/* #1566: this line is always rendered at one line high, so the grid does not move when loading clears. */}
    <p className="diary-calendar-status" role="status">{!ready && (failed ? t('diary.calendar.loadFailed') : t('diary.calendar.loading'))}
      {!ready && failed && onRetry && <> <button className="popup-tab" disabled={busy} onClick={onRetry}>{t('diary.calendar.retryLoad')}</button></>}</p>
    {view==='list' ? <div className="diary-entry-list" aria-label={t('diary.calendar.entriesLabel')}>{ready && (entries.length ? entries.map(date=><button className="diary-entry-row" key={date} disabled={busy} onClick={()=>navigate(month,date)}><time dateTime={date}>{date}</time><span>{t('diary.calendar.readEntry')}</span></button>) : <p>{t('diary.calendar.noEntriesThisMonth')}</p>)}</div> :
    <div className="diary-calendar" aria-label={monthLabel(month, locale)} onKeyDown={moveFocus}>
      {weekdays.map(day => <span className="calendar-weekday" key={day}>{t(`diary.calendar.weekday.${day}` as MessageKey)}</span>)}
      {calendarDays(month, first).map((day,index) => {
        if (!day) return <span key={`blank${index}`} />;
        const hasEntries = !!days[day]?.replace(/^#+.*$/gm,'').trim();
        return <button key={day} className={`calendar-day${day === today ? ' calendar-today' : ''}`} data-day={day} tabIndex={day === tabStop ? 0 : -1}
          disabled={busy || day > today} aria-label={`${dayLabel(day, locale)}, ${!ready ? t('diary.calendar.entriesNotLoaded') : hasEntries ? t('diary.calendar.hasEntries') : t('diary.calendar.noEntries')}`}
          onFocus={() => onFocusDay?.(day)} onClick={() => navigate(month,day)}>
          <span>{Number(day.slice(-2))}</span>
          {hasEntries && <span className="calendar-dot" aria-hidden="true" />}
        </button>;
      })}
    </div>}
  </section>;
}
