// A reply the server kept partway when it was cut off (#1507). Pure: the flag is read from and written
// to a saved transcript entry, and nothing here reads the DOM or the network.
//
// Contract with noevia-core (the server side, draft b21): a saved assistant history entry may carry
// `interrupted: true`. The server writes the partial reply under that flag every few seconds while it
// streams, so a reload shows it. A finished reply is saved without the flag and replaces the partial.
// Core does not put that partial inside `history`: GET /api/chats/:id/history returns it beside the
// history as `partial` (already flagged), while no reply runs for the chat. withPartialTurn() adds it
// as the chat's last turn, so the load, the save and the merge all see one transcript.

import type { HistoryEntry, Message } from './types';

/** The partial reply core returns beside the history, as the chat's last turn. A partial that repeats the
 *  last saved reply (a stale partial whose clear failed on the server) is not added twice. */
export function withPartialTurn(history: HistoryEntry[], partial: HistoryEntry | null | undefined): HistoryEntry[] {
  if (!partial || partial.role !== 'assistant') return history;
  const turn: HistoryEntry = { ...partial, interrupted: true };
  const last = history[history.length - 1];
  if (last && last.role === 'assistant' && last.content === turn.content && (last.reasoning || '') === (turn.reasoning || '')) return history;
  return [...history, turn];
}

/** Whether a saved entry is an interrupted assistant reply. Any other value reads as finished. */
export function storedInterrupted(entry: Pick<HistoryEntry, 'role' | 'interrupted'>): boolean {
  return entry.role === 'assistant' && entry.interrupted === true;
}

/** The flag written back on a save: only an interrupted assistant turn carries it, so finished turns
 *  are saved exactly as before. */
export function interruptedFlag(message: Pick<Message, 'role' | 'interrupted'>): true | undefined {
  return message.role === 'assistant' && message.interrupted === true ? true : undefined;
}
