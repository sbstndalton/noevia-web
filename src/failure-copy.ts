// What a person reads when a request fails (#1472). The raw exception ("TypeError: Failed to fetch")
// stays in the console; the screen gets a plain sentence.
import type { MessageKey } from './i18n';

type Say = (key: MessageKey) => string;

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
  return message;
}
