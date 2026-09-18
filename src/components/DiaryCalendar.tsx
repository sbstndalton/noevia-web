import { useState } from 'react';
import { ShellIcon } from './ShellIcon';
import { calendarDays, dayLabel, localDay, monthLabel } from '../diary-data';
type Props = { month: string; today: string; days: Record<string,string>; busy: boolean; ready?: boolean; failed?: boolean; navigate: (month: string, day?: string) => void };
export function DiaryCalendar({ month, today, days, busy, ready = true, failed = false, navigate }: Props) {
  const [view,setView] = useState<'calendar'|'list'>('calendar');
  const entries = Object.keys(days).filter(date=>date.startsWith(month) && days[date]?.replace(/^#+.*$/gm,'').trim()).sort().reverse();
  const moveMonth = (delta: number) => {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth()+delta);
    navigate(localDay(date).slice(0,7));
  };
  return <section className="diary-calendar-section">
    <div className="diary-view-toggle" role="group" aria-label="Diary view">
      <button className="popup-tab" aria-pressed={view==='calendar'} onClick={()=>setView('calendar')}>Calendar</button>
      <button className="popup-tab" aria-pressed={view==='list'} onClick={()=>setView('list')}>List</button>
    </div>
    <div className="diary-calendar-heading">
      <button className="popup-tab" disabled={busy} aria-label="Previous month" onClick={() => moveMonth(-1)}><ShellIcon name="left" size={18}/></button>
      <h1>{monthLabel(month)}</h1>
      <button className="popup-tab" disabled={busy || month >= today.slice(0,7)} aria-label="Next month" onClick={() => moveMonth(1)}><ShellIcon name="right" size={18}/></button>
    </div>
    <p>{view==='calendar' ? 'Choose a day to read or add an entry.' : 'Entries for this month · newest first.'}</p>
    {!ready && <p role="status">{failed ? 'Entries could not be loaded.' : 'Loading entries…'}</p>}
    {view==='list' ? <div className="diary-entry-list" aria-label="Diary entries">{ready && (entries.length ? entries.map(date=><button className="diary-entry-row" key={date} disabled={busy} onClick={()=>navigate(month,date)}><time dateTime={date}>{date}</time><span>Read entry →</span></button>) : <p>No entries this month. Write below to capture today, or choose a day in Calendar.</p>)}</div> :
    <div className="diary-calendar" aria-label={monthLabel(month)}>
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
      {calendarDays(month).map((day,index) => {
        if (!day) return <span key={`blank${index}`} />;
        const hasEntries = !!days[day]?.replace(/^#+.*$/gm,'').trim();
        return <button key={day} className={`calendar-day${day === today ? ' calendar-today' : ''}`}
          disabled={busy || day > today} aria-label={`${dayLabel(day)}, ${!ready ? 'entries not loaded' : hasEntries ? 'has entries' : 'no entries'}`}
          onClick={() => navigate(month,day)}>
          <span>{Number(day.slice(-2))}</span>
          {hasEntries && <span className="calendar-dot" aria-hidden="true" />}
        </button>;
      })}
    </div>}
  </section>;
}
