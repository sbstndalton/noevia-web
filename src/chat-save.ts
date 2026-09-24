import type { ChatMeta, HistoryEntry, Message } from './types';

/** Move one chat's meta to the top of a chat list. `make` receives the entry already in the list,
 *  if any. Every other chat in `list` is kept, so callers must pass the latest list, not a copy
 *  captured when the send began. */
export function upsertChatMeta(list: ChatMeta[], chatId: string, make: (existing: ChatMeta | undefined) => ChatMeta): ChatMeta[] {
  return [make(list.find((c) => c.id === chatId)), ...list.filter((c) => c.id !== chatId)];
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
  return merged.map((entry) => {
    let at = -1;
    for (let i = from; i < current.length; i++) {
      if (!used.has(i) && !current[i].error && current[i].role === entry.role && current[i].content === entry.content) { at = i; break; }
    }
    if (at < 0) return fromEntry(entry, mint());
    used.add(at);
    from = at + 1;
    return current[at];
  });
}
