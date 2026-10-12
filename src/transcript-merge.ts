import type { HistoryEntry } from './types';

const same = (a: HistoryEntry, b: HistoryEntry) => a.role === b.role && a.content === b.content;

/** Merge the server's copy of a transcript with ours after a concurrent save. The shared start is
 *  kept once; if one copy extends the other it wins; otherwise the other device's later turns come
 *  first, then ours, so no user turn either device wrote is lost.
 *
 *  Roles must keep alternating, because the transcript is replayed to the model and strict chat
 *  templates reject two assistant turns in a row. When both devices answered the same user turn
 *  (the other device's turns end in an answer and ours start with one), only one answer is kept:
 *  if the other device wrote nothing but that answer, the longer of the two (ours on a tie, as the
 *  newer); if it went on to further turns, its answer stays and ours, which answered an earlier
 *  question than the one now above it, is dropped. */
export function mergeTranscripts(theirs: HistoryEntry[], ours: HistoryEntry[]): HistoryEntry[] {
  let shared = 0;
  while (shared < theirs.length && shared < ours.length && same(theirs[shared], ours[shared])) shared++;
  if (shared === theirs.length) return ours;
  if (shared === ours.length) return theirs;
  const tail = theirs.slice(shared);
  const mine = ours.slice(shared);
  if (tail[tail.length - 1].role === 'assistant' && mine[0].role === 'assistant') {
    if (tail.length === 1) {
      const keep = tail[0].content.length > mine[0].content.length ? tail[0] : mine[0];
      return [...theirs.slice(0, shared), keep, ...mine.slice(1)];
    }
    return [...theirs, ...mine.slice(1)];
  }
  return [...theirs, ...mine];
}

/** A merge that was held back while a reply streamed (#1515). `ours` is the transcript that merge was
 *  built from; `merged` already contains those turns. */
export interface DeferredMerge { merged: HistoryEntry[]; ours: HistoryEntry[] }

/** Fold a held-back merge into the transcript as it is now. The turns added since `ours` sit after it, so
 *  they are appended to `merged` as they are. Merging `merged` with `current` again would write the turns
 *  of `ours` a second time, because `merged` already holds them. Falls back to a plain merge when the
 *  transcript no longer starts with `ours` (an edit or a regenerate changed an earlier turn). */
export function foldDeferredMerge(deferred: DeferredMerge, current: HistoryEntry[]): HistoryEntry[] {
  const { merged, ours } = deferred;
  if (ours.length <= current.length && ours.every((entry, i) => same(entry, current[i]))) return [...merged, ...current.slice(ours.length)];
  return mergeTranscripts(merged, current);
}

/** #1516: true when the saved copy is the transcript on screen plus newer turns (another tab added them).
 *  A copy that diverges, or that is no longer than what is shown, is not adopted. */
export function savedCopyExtends(shown: HistoryEntry[], saved: HistoryEntry[]): boolean {
  return saved.length > shown.length && shown.every((entry, i) => same(entry, saved[i]));
}
