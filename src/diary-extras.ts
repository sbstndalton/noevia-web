import { streamChat } from './api';
export type ExtraEvent = { type: string; text?: string; name?: string; args?: string; index?: number; id?: string; /** 'tool_pending' (#648): the file an edit would change. */ target?: string; /** #658/#659 */ targetKind?: string; repeatOf?: boolean; /** #769 */ provenance?: unknown; applied?: boolean | number; /** #666 review: set by the server on tool_result */ declined?: boolean | string[]; notRun?: boolean };
/** Optional context is collected before capture; a failed/cancelled collection never starts a diary exchange. */
export async function prepareDiaryExtras(enabled: boolean, message: string, sessionId: string, onEvent: (event: ExtraEvent) => void, signal?: AbortSignal, recovery?: { recoveryId: string; entryDay: string }) {
  if (!enabled) return '';
  let reference = '';
  let done = false;
  for await (const event of streamChat({ spaceId: 'diary-extras', extrasEnabled: true, message, sessionId, history: [], ...recovery }, signal)) {
    if (event.type === 'error') throw new Error(event.text || 'Could not prepare optional diary context');
    if (event.type === 'delta') reference = (reference + (event.text || '')).slice(0, 12000);
    if (event.type === 'done') done = true;
    onEvent(event);
  }
  if (!done || signal?.aborted) throw new Error('Optional context was interrupted; no diary entry was sent.');
  return reference;
}
