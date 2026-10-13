// Search over the Diary days this session has already loaded (#1453, owner decision (b)). Pure: no
// network, no storage, no server index. A day's text leaves the Diary view only as a result the
// person can see on screen, so diary text is never sent anywhere new.

export type LoadedDays = Record<string, string>;

export interface LoadedDayHit {
  /** 'YYYY-MM-DD'. */
  day: string;
  /** A short piece of the day around the first match, with line breaks flattened. */
  snippet: string;
}

const SNIPPET_RADIUS = 60;
const DEFAULT_LIMIT = 50;

/** Folds the days in `days` into `loaded`. A day with text replaces its earlier copy; a day that is
 *  now empty is dropped, so a deleted entry stops matching. Days not in `days` (other months loaded
 *  earlier) are kept. Returns `loaded` itself when nothing changed, so React does not re-render. */
export function mergeLoadedDays(loaded: LoadedDays, days: LoadedDays): LoadedDays {
  let next: LoadedDays | null = null;
  for (const [day, text] of Object.entries(days)) {
    const has = typeof text === 'string' && text.trim().length > 0;
    if (has && loaded[day] === text) continue;
    if (!has && !(day in loaded)) continue;
    next ??= { ...loaded };
    if (has) next[day] = text;
    else delete next[day];
  }
  return next ?? loaded;
}

/** Days whose text contains `query` (case-insensitive), newest first. An empty or blank query finds
 *  nothing. Only the days in `loaded` are searched; that is the whole scope of this search. */
export function searchLoadedDays(loaded: LoadedDays, query: string, limit = DEFAULT_LIMIT): LoadedDayHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: LoadedDayHit[] = [];
  for (const day of Object.keys(loaded).sort().reverse()) {
    const text = loaded[day] ?? '';
    const at = text.toLocaleLowerCase().indexOf(needle);
    if (at < 0) continue;
    hits.push({ day, snippet: snippetAround(text, at, needle.length) });
    if (hits.length >= limit) break;
  }
  return hits;
}

function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + length + SNIPPET_RADIUS);
  const flat = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${flat}${end < text.length ? '…' : ''}`;
}
