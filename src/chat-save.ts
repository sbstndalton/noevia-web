import type { ChatMeta, HistoryEntry, Message, TurnBranch } from './types';
import { sameBranch, unionVariants } from './transcript-merge';
import { capVariants } from './variant-cap';

/** Move one chat's meta to the top of a chat list. `make` receives the entry already in the list,
 *  if any. Every other chat in `list` is kept, so callers must pass the latest list, not a copy
 *  captured when the send began. */
export function upsertChatMeta(list: ChatMeta[], chatId: string, make: (existing: ChatMeta | undefined) => ChatMeta): ChatMeta[] {
  return [make(list.find((c) => c.id === chatId)), ...list.filter((c) => c.id !== chatId)];
}

/** Whether a transcript save for `chatId` may go ahead. A chat deleted in this session is never
 *  saved again, so a save queued before the delete (or retried after a conflict) cannot recreate it. */
export function shouldSaveChat(chatId: string, deleted: ReadonlySet<string>): boolean {
  return !!chatId && !deleted.has(chatId);
}

/** Run `task` after every earlier task queued under the same key, so whole-list writes for one
 *  chat list reach the server in the order they were made. A failed task does not block later ones. */
export function enqueueKeyed(queue: Map<string, Promise<void>>, key: string, task: () => Promise<void>): Promise<void> {
  const pending = (queue.get(key) || Promise.resolve()).then(task, task);
  const settled = pending.catch(() => undefined);
  queue.set(key, settled);
  void settled.then(() => { if (queue.get(key) === settled) queue.delete(key); });
  return pending;
}

/** Show a merged transcript without reminting ids. Each merged entry reuses, in order, the id and
 *  local-only fields of a matching current message; only turns new to this client get `mint()`ed. */
export function adoptMergedTranscript(
  current: Message[],
  merged: HistoryEntry[],
  mint: () => string,
  fromEntry: (entry: HistoryEntry, id: string) => Message,
): Message[] {
  const used = new Set<number>();
  let from = 0;
  return merged.map((entry, k) => {
    let at = -1;
    for (let i = from; i < current.length; i++) {
      if (!used.has(i) && !current[i].error && current[i].role === entry.role && current[i].content === entry.content) { at = i; break; }
    }
    if (at < 0) return fromEntry(entry, mint());
    used.add(at);
    from = at + 1;
    return withMergedVariants(current[at], entry, merged[k + 1]);
  });
}

/** #1517: the local copy of a user turn keeps its own fields, but the answers and versions the merged copy holds
 *  (a Regenerate or an Edit & re-run in another tab) are added to it, so neither side's alternatives are lost.
 *  `next` is the entry after the turn: the answer it shows decides which stored answer the pointer names. */
function withMergedVariants(local: Message, entry: HistoryEntry, next: HistoryEntry | undefined): Message {
  if (local.role !== 'user' || (entry.answers === undefined && entry.branches === undefined)) return local;
  const answers = unionVariants(entry.answers, local.answers);
  const branches = unionVariants(entry.branches, local.branches, true);
  const alike = (a: readonly { content: string }[] | undefined, b: readonly { content: string }[] | undefined) =>
    (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((v, n) => v.content === b?.[n]?.content);
  // A version also differs by its chat (#1616): the same text with a longer or another chat is not alike.
  const alikeVersions = (a: readonly TurnBranch[] | undefined, b: readonly TurnBranch[] | undefined) =>
    alike(a, b) && (a ?? []).every((v, n) => (v.tail?.length ?? 0) === (b?.[n]?.tail?.length ?? 0));
  if (alike(answers, local.answers) && alikeVersions(branches, local.branches)) return local;
  const shown = next?.role === 'assistant' && answers ? answers.findIndex((a) => a.content === next.content) : -1;
  // The version on screen is told apart by its text and its chat, not by the first one with the same text (#1616).
  const mine = local.branches?.[local.branch ?? 0];
  const version = !branches ? -1
    : mine ? [true, false].reduce((found, exact) => (found >= 0 ? found : branches.findIndex((b) => sameBranch(b, mine, exact))), -1)
    : branches.findIndex((b) => b.content === local.content);
  // The union can pass the limit of 10 (#1517); the oldest others drop, the one shown stays.
  const keptAnswers = answers ? capVariants(answers, shown >= 0 ? shown : entry.answer ?? local.answer) : undefined;
  const keptBranches = branches ? capVariants(branches, version >= 0 ? version : entry.branch ?? local.branch) : undefined;
  return {
    ...local,
    ...(keptAnswers ? { answers: keptAnswers.list, answer: keptAnswers.chosen } : {}),
    ...(keptBranches ? { branches: keptBranches.list, branch: keptBranches.chosen } : {}),
  };
}

/** Combine a chat's lazily loaded server history with whatever is already on screen for it. With
 *  nothing local the loaded copy is shown as is. If the person already sent (or is streaming) in
 *  this chat before the load resolved, the loaded turns are merged in front of the local ones and
 *  local messages keep their ids, so the live reply placeholder still receives stream updates. */
export function resolveLoadedHistory(current: Message[], loaded: Message[]): Message[] {
  if (!current.length) return loaded;
  const toEntry = (m: Message): HistoryEntry => ({ role: m.role, content: m.content });
  const ours = current.filter((m) => !m.error).map(toEntry);
  const theirs = loaded.map(toEntry);
  let shared = 0;
  while (shared < theirs.length && shared < ours.length && theirs[shared].role === ours[shared].role && theirs[shared].content === ours[shared].content) shared++;
  if (shared === theirs.length) return current;
  const merged = shared === ours.length ? theirs : [...theirs, ...ours.slice(shared)];
  const byIndex = new Map<HistoryEntry, Message>(theirs.map((e, i) => [e, loaded[i]]));
  return adoptMergedTranscript(current, merged, () => 'm-' + Math.random().toString(36).slice(2), (entry, id) => byIndex.get(entry) ?? { id, role: entry.role, content: entry.content });
}

/** Hands out sequence numbers for overlapping requests of one kind; `isLatest` is true only for
 *  the most recently started one, so an older response cannot overwrite a newer one. */
export function latestGate(): { next: () => number; isLatest: (seq: number) => boolean } {
  let seq = 0;
  return { next: () => ++seq, isLatest: (n) => n === seq };
}
