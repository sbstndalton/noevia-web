export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function localTimestamp(now = new Date()): string {
  const offset = -now.getTimezoneOffset();
  return `${localDay(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function dateInText(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/);
  const result = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : named ? `${named[3]}-${String(monthNames.indexOf(named[1])+1).padStart(2,'0')}-${named[2].padStart(2,'0')}` : null;
  if (!result) return null;
  const d = new Date(`${result}T12:00:00`);
  return !Number.isNaN(d.valueOf()) && localDay(d) === result ? result : null;
}
export function splitDays(text: string, fallback: string | null = null): Record<string, string> {
  const result: Record<string, string> = {};
  let current = fallback;
  for (const line of text.split('\n')) {
    if (/^#{1,2} /.test(line)) {
      const date = dateInText(line);
      if (date) current = date;
      else if (/^## /.test(line)) current = null;
    }
    if (current) result[current] = (result[current] || '') + line + '\n';
  }
  return result;
}
export function monthLabel(id: string): string {
  return new Date(`${id}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
export function dayLabel(id: string): string {
  return new Date(`${id}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
export function calendarDays(id: string): (string | null)[] {
  const start = new Date(`${id}-01T12:00:00`);
  const count = new Date(start.getFullYear(), start.getMonth()+1, 0).getDate();
  return [...Array(start.getDay()).fill(null), ...Array.from({length: count}, (_, i) => `${id}-${String(i+1).padStart(2,'0')}`)];
}
