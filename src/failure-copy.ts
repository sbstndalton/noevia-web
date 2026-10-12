// What a person reads when a request fails (#1472, #1547). The raw exception ("TypeError: Failed to
// fetch", a stream error) stays in the console; the screen gets a plain sentence.
import type { MessageKey } from './i18n';
import type { Message } from './types';

type Say = (key: MessageKey) => string;

/** The server's stream-failure copy claims that partial output was kept. Only the text the screen can
 *  show counts as kept, so a failure that mentions it is worded by this app instead (#1547). */
const PARTIAL_CLAIM = /Partial output was preserved/i;

/** A request that never reached the server: fetch rejected before any response. Browsers word it
 *  differently ("Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"). */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

/** The sentence to show for a failed request. `say` is the interface translator. */
export function failureCopy(err: unknown, say: Say): string {
  if (isNetworkFailure(err)) return say('chat.failure.unreachable');
  const message = err instanceof Error ? err.message.trim() : '';
  if (!message) return say('chat.failure.unknown');
  if (PARTIAL_CLAIM.test(message)) return say('chat.failure.stopped');
  return message;
}

/** A reply that failed. Text that had already streamed in is kept as the reply (shown as incomplete),
 *  and the failure is set beside it, so the screen never claims output that is not there (#1547). */
export function failedReply(message: Message, failure: string): Message {
  const partial = message.content.trim() ? message.content : '';
  return { ...message, error: true, failure, content: partial };
}
