import type { HistoryEntry } from './types';

const same = (a: HistoryEntry, b: HistoryEntry) => a.role === b.role && a.content === b.content;

/** Merge the server's copy of a transcript with ours after a concurrent save. The shared start is
 *  kept once; if one copy extends the other it wins; otherwise the other device's later turns come
 *  first, then ours, so nothing either device wrote is lost. */
export function mergeTranscripts(theirs: HistoryEntry[], ours: HistoryEntry[]): HistoryEntry[] {
  let shared = 0;
  while (shared < theirs.length && shared < ours.length && same(theirs[shared], ours[shared])) shared++;
  if (shared === theirs.length) return ours;
  if (shared === ours.length) return theirs;
  return [...theirs, ...ours.slice(shared)];
}
