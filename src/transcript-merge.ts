import type { HistoryEntry, TurnBranch } from './types';

const same = (a: HistoryEntry, b: HistoryEntry) => a.role === b.role && a.content === b.content;

/** #1616: the chat that followed a version of a turn, compared by role and text. */
function sameTail(a: readonly HistoryEntry[], b: readonly HistoryEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => same(e, b[i]));
}
function tailPrefix(shorter: readonly HistoryEntry[], longer: readonly HistoryEntry[]): boolean {
  return shorter.length <= longer.length && shorter.every((e, i) => same(e, longer[i]));
}
/** Two stored versions of a turn are one version when the text is equal and one chat is the start of the other
 *  (a tab that only went on chatting). `exact` asks for the same chat. Edit & re-run with unchanged text makes
 *  two versions with the same text and different chats; those are different versions. */
export function sameBranch(a: TurnBranch, b: TurnBranch, exact = false): boolean {
  if (a.content !== b.content) return false;
  const x = a.tail ?? [];
  const y = b.tail ?? [];
  return exact ? sameTail(x, y) : tailPrefix(x, y) || tailPrefix(y, x);
}

/** #1517: two copies of one turn each hold the answers or versions that tab made (Regenerate, Edit & re-run).
 *  The union keeps `first`'s order, so its `answer`/`branch` pointer still points at the same one, then adds
 *  what only `second` has. Answers are told apart by their text. Versions (`versions`, #1616) by the text of the
 *  turn and the chat after it: the same text with a chat that continues the other is one version (the longer
 *  chat is kept, in the place of the shorter), the same text with a different chat is another version. */
export function unionVariants<T extends { content: string }>(first: readonly T[] | undefined, second: readonly T[] | undefined, versions = false): T[] | undefined {
  if (first === undefined && second === undefined) return undefined;
  const out = [...(first ?? [])];
  if (!versions) {
    const seen = new Set(out.map((v) => v.content));
    for (const v of second ?? []) if (!seen.has(v.content)) { seen.add(v.content); out.push(v); }
    return out;
  }
  const taken = new Set<number>();
  const asBranch = (v: T) => v as unknown as TurnBranch;
  for (const v of second ?? []) {
    const find = (exact: boolean) => out.findIndex((o, i) => !taken.has(i) && sameBranch(asBranch(o), asBranch(v), exact));
    let i = find(true);
    if (i < 0) i = find(false);
    if (i < 0) { out.push(v); taken.add(out.length - 1); continue; }
    taken.add(i);
    if ((asBranch(v).tail ?? []).length > (asBranch(out[i]).tail ?? []).length) out[i] = v;
  }
  return out;
}

/** A user turn with the answers and versions of both copies. The entry itself when the other adds nothing. */
function withVariantsOf(entry: HistoryEntry, other: HistoryEntry): HistoryEntry {
  if (entry.role !== 'user' || (entry.answers === undefined && entry.branches === undefined && other.answers === undefined && other.branches === undefined)) return entry;
  const answers = unionVariants(entry.answers, other.answers);
  const branches = unionVariants(entry.branches, other.branches, true);
  const grew = (answers?.length ?? 0) !== (entry.answers?.length ?? 0) || (branches?.length ?? 0) !== (entry.branches?.length ?? 0) || (branches ?? []).some((b, n) => b !== entry.branches?.[n]);
  if (!grew) return entry;
  return { ...entry, ...(answers !== undefined ? { answers, answer: entry.answer ?? other.answer } : {}), ...(branches !== undefined ? { branches, branch: entry.branch ?? other.branch } : {}) };
}

/** `winner`'s shared start with the answers and versions `other` holds for the same turns. */
function shareVariants(winner: HistoryEntry[], other: HistoryEntry[], shared: number): HistoryEntry[] {
  const out = winner.map((entry, i) => (i < shared ? withVariantsOf(entry, other[i]) : entry));
  return out.every((entry, i) => entry === winner[i]) ? winner : out;
}

/** #1784: a reply core kept for a client that went away (chat-interrupted-turn.cjs). */
function serverKept(e: HistoryEntry): boolean {
  return e.role === 'assistant' && e.interrupted === true;
}

/** #1784 review: a reply this tab settled itself: the person stopped it, or it finished cleanly. A failed reply
 *  (`error`, App.tsx failedReply) or the bare record of changes a failed or cut-off reply saved (no text, a
 *  `stopped` pause: applied-writes.ts appliedRecord) is not. */
function settledHere(e: HistoryEntry): boolean {
  if (e.role !== 'assistant' || serverKept(e)) return false;
  if (e.stopped === true) return true;
  if ((e as { error?: unknown }).error) return false;
  return !(e.paused?.reason === 'stopped' && !e.content.trim());
}

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
  if (shared === theirs.length) return shareVariants(ours, theirs, shared);
  if (shared === ours.length) return shareVariants(theirs, ours, shared);
  const tail = theirs.slice(shared);
  const mine = ours.slice(shared);
  const start = shareVariants(theirs.slice(0, shared), ours, shared);
  if (tail[tail.length - 1].role === 'assistant' && mine[0].role === 'assistant') {
    if (tail.length === 1) {
      // #1784: the server keeps a reply whose client went away as `interrupted` (core #679). When this tab
      // settled the same reply itself, by the person's Stop or by finishing cleanly, its own copy is the answer:
      // the server's copy can hold text the engine produced after Stop that was never shown, and would replace
      // the quiet Stopped note with the interrupted one. A copy cut short by a dropped connection (an error, or
      // only the record of saved changes) is not settled: the longer copy still wins.
      const keep = serverKept(tail[0]) && settledHere(mine[0]) ? mine[0]
        : tail[0].content.length > mine[0].content.length ? tail[0] : mine[0];
      return [...start, keep, ...mine.slice(1)];
    }
    return [...start, ...tail, ...mine.slice(1)];
  }
  return [...start, ...tail, ...mine];
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
