import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Message } from './types';

/** Chats whose transcript is saved once the render that holds their latest messages commits (kept
 *  out of state updaters, which StrictMode runs twice). A chat is marked after the update that
 *  finishes its turn was queued, so only a render that started after the mark can hold it: the
 *  passive effect of an earlier commit, still pending when the next render begins, must not take the
 *  mark with its stale messages (noevia#2489: a final delta and 'done' in one task saved the reply
 *  without its text). Such an effect leaves the mark for the render that follows. */
export function useSaveAfterCommit(
  messagesByChat: Record<string, Message[]>,
  persist: (chatId: string, msgs: Message[]) => void,
): { add: (chatId: string) => void; delete: (chatId: string) => void } {
  const marks = useRef(new Map<string, number>());
  const started = useRef(0);
  const renderNo = ++started.current;
  useEffect(() => {
    for (const [chatId, markedAfter] of [...marks.current]) {
      if (renderNo <= markedAfter) continue;
      marks.current.delete(chatId);
      persist(chatId, messagesByChat[chatId] ?? []);
    }
    // renderNo is this render's own number, fixed for the effect it belongs to.
  }, [messagesByChat, persist]);
  const add = useCallback((chatId: string) => { marks.current.set(chatId, started.current); }, []);
  const remove = useCallback((chatId: string) => { marks.current.delete(chatId); }, []);
  return useMemo(() => ({ add, delete: remove }), [add, remove]);
}
