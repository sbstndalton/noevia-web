// What a person reads when a request fails (#1472, #1547). The raw exception ("TypeError: Failed to
// fetch", a stream error) stays in the console; the screen gets a plain sentence.
import type { MessageKey } from './i18n';
import type { Message } from './types';

type Say = (key: MessageKey) => string;

/** The server's stream-failure copy claims that partial output was kept. The claim is true only when the
 *  reply's partial text is on screen (#1547), so it is kept then. Without shown text the server is not
 *  trusted to have meant it, and this app words the failure instead. The server itself now leaves the
 *  claim out when it sent no text (core #1547), so the two sides agree. */
const PARTIAL_CLAIM = /Partial output was preserved/i;

/** A request that never reached the server: fetch rejected before any response. Browsers word it
 *  differently ("Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"). */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

/** The sentence to show for a failed request. `say` is the interface translator. `partialShown` is true
 *  when the reply already shows partial text, the only case in which "output was preserved" is true. */
export function failureCopy(err: unknown, say: Say, partialShown = false): string {
  if (isNetworkFailure(err)) return say('chat.failure.unreachable');
  const message = err instanceof Error ? err.message.trim() : '';
  if (!message) return say('chat.failure.unknown');
  if (PARTIAL_CLAIM.test(message) && !partialShown) return say('chat.failure.stopped');
  return message;
}

/** A reply that failed. Text that had already streamed in is kept as the reply (shown as incomplete),
 *  and the failure is set beside it, so the screen never claims output that is not there (#1547). */
export function failedReply(message: Message, failure: string): Message {
  const partial = message.content.trim() ? message.content : '';
  return { ...message, error: true, failure, content: partial };
}

/** #1593: the patch for a Task/Cowork start that failed. The sentence is the failure and nothing had
 *  streamed, so `content` stays empty: the failure card is the only place it appears, never also as an
 *  "Incomplete" partial reply. */
export function coworkStartFailure(failure: string, repository: string): Partial<Message> {
  return { content: '', failure, error: true, coworkRepository: repository, processingStatus: undefined };
}
