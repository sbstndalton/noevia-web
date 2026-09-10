import { calendarDays, dayLabel, localDay, monthLabel } from '../diary-data';
type Props = { month: string; today: string; days: Record<string,string>; busy: boolean; navigate: (month: string, day?: string) => void };
export function DiaryCalendar({ month, today, days, busy, navigate }: Props) {
  const moveMonth = (delta: number) => {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth()+delta);
    navigate(localDay(date).slice(0,7));
  };
  return <section className="diary-calendar-section">
    <div className="diary-calendar-heading">
      <button className="popup-tab" disabled={busy} aria-label="Previous month" onClick={() => moveMonth(-1)}>←</button>
      <h1>{monthLabel(month)}</h1>
      <button className="popup-tab" disabled={busy || month >= today.slice(0,7)} aria-label="Next month" onClick={() => moveMonth(1)}>→</button>
    </div>
    <p>Choose a day to read or add an entry.</p>
    <div className="diary-calendar" aria-label={monthLabel(month)}>
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
      {calendarDays(month).map((day,index) => {
        if (!day) return <span key={`blank${index}`} />;
        const hasEntries = !!days[day]?.replace(/^#+.*$/gm,'').trim();
        return <button key={day} className={`calendar-day${day === today ? ' calendar-today' : ''}`}
          disabled={busy || day > today} aria-label={`${dayLabel(day)}, ${hasEntries ? 'has entries' : 'no entries'}`}
          onClick={() => navigate(month,day)}>
          <span>{Number(day.slice(-2))}</span>
          {hasEntries && <span className="calendar-dot" aria-hidden="true" />}
        </button>;
      })}
    </div>
  </section>;
}
