// A reply the server kept partway when it was cut off (#1507). Pure: the flag is read from and written
// to a saved transcript entry, and nothing here reads the DOM or the network.
//
// Contract with noevia-core (the server side, draft b21): a saved assistant history entry may carry
// `interrupted: true`. The server writes the partial reply under that flag every few seconds while it
// streams, so a reload shows it. A finished reply is saved without the flag and replaces the partial.

import type { HistoryEntry, Message } from './types';

/** Whether a saved entry is an interrupted assistant reply. Any other value reads as finished. */
export function storedInterrupted(entry: Pick<HistoryEntry, 'role' | 'interrupted'>): boolean {
  return entry.role === 'assistant' && entry.interrupted === true;
}

/** The flag written back on a save: only an interrupted assistant turn carries it, so finished turns
 *  are saved exactly as before. */
export function interruptedFlag(message: Pick<Message, 'role' | 'interrupted'>): true | undefined {
  return message.role === 'assistant' && message.interrupted === true ? true : undefined;
}
