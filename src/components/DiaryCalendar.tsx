import { useState } from 'react';
import { ShellIcon } from './ShellIcon';
import { calendarDays, dayLabel, localDay, monthLabel } from '../diary-data';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
type Props = { month: string; today: string; days: Record<string,string>; busy: boolean; ready?: boolean; failed?: boolean; navigate: (month: string, day?: string) => void };
const weekdayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
export function DiaryCalendar({ month, today, days, busy, ready = true, failed = false, navigate }: Props) {
  const t = useT();
  const [view,setView] = useState<'calendar'|'list'>('calendar');
  const entries = Object.keys(days).filter(date=>date.startsWith(month) && days[date]?.replace(/^#+.*$/gm,'').trim()).sort().reverse();
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
      <h1>{monthLabel(month)}</h1>
      <button className="popup-tab" disabled={busy || month >= today.slice(0,7)} aria-label={t('diary.calendar.nextMonth')} onClick={() => moveMonth(1)}><ShellIcon name="right" size={18}/></button>
    </div>
    <p>{view==='calendar' ? t('diary.calendar.chooseDay') : t('diary.calendar.entriesThisMonth')}</p>
    {!ready && <p role="status">{failed ? t('diary.calendar.loadFailed') : t('diary.calendar.loading')}</p>}
    {view==='list' ? <div className="diary-entry-list" aria-label={t('diary.calendar.entriesLabel')}>{ready && (entries.length ? entries.map(date=><button className="diary-entry-row" key={date} disabled={busy} onClick={()=>navigate(month,date)}><time dateTime={date}>{date}</time><span>{t('diary.calendar.readEntry')}</span></button>) : <p>{t('diary.calendar.noEntriesThisMonth')}</p>)}</div> :
    <div className="diary-calendar" aria-label={monthLabel(month)}>
      {weekdayKeys.map(day => <span className="calendar-weekday" key={day}>{t(`diary.calendar.weekday.${day}` as MessageKey)}</span>)}
      {calendarDays(month).map((day,index) => {
        if (!day) return <span key={`blank${index}`} />;
        const hasEntries = !!days[day]?.replace(/^#+.*$/gm,'').trim();
        return <button key={day} className={`calendar-day${day === today ? ' calendar-today' : ''}`}
          disabled={busy || day > today} aria-label={`${dayLabel(day)}, ${!ready ? t('diary.calendar.entriesNotLoaded') : hasEntries ? t('diary.calendar.hasEntries') : t('diary.calendar.noEntries')}`}
          onClick={() => navigate(month,day)}>
          <span>{Number(day.slice(-2))}</span>
          {hasEntries && <span className="calendar-dot" aria-hidden="true" />}
        </button>;
      })}
    </div>}
  </section>;
}
