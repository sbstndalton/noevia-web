import { statusDetail } from './chat-labels';
import type { StatusDetail } from './chat-labels';

// noevia#2115: a status line that describes a wait is true only until the wait ends. The server sends no further
// status once the model is granted or loaded, so the client ends the line itself when the answer starts.

/** Status ids that describe a wait the server never announces the end of. */
const TRANSIENT_STATUS_IDS: ReadonlySet<string> = new Set(['waitingForModel', 'loadingModel']);

export type StatusPatch = { processingStatus?: string; processingStatusId?: string; processingStatusDetail?: StatusDetail };

/** The stream event fields this module reads. */
export type StatusEvent = { type: string; text?: string; id?: unknown; detail?: unknown };

/** Events that show the model is now answering: the server sent its context meter after the grant, or text, thinking or a tool call arrived. */
function isAnswering(ev: StatusEvent): boolean {
  if (ev.type === 'context' || ev.type === 'tool' || ev.type === 'tool_pending') return true;
  return (ev.type === 'delta' || ev.type === 'reasoning' || ev.type === 'preamble') && !!ev.text;
}

/** What one stream event does to the reply's status line. `transientShown` is whether a wait line is on the reply
 *  now; the caller keeps it between events so that streaming text costs no extra state update. `patch` is null
 *  when the line is unchanged. */
export function statusStep(ev: StatusEvent, transientShown: boolean): { patch: StatusPatch | null; transientShown: boolean } {
  if (ev.type === 'status' && ev.text) {
    const id = typeof ev.id === 'string' ? ev.id : undefined;
    return { patch: { processingStatus: ev.text, processingStatusId: id, processingStatusDetail: statusDetail(ev.detail) }, transientShown: !!id && TRANSIENT_STATUS_IDS.has(id) };
  }
  if (transientShown && isAnswering(ev)) return { patch: CLEARED, transientShown: false };
  return { patch: null, transientShown };
}

const CLEARED: StatusPatch = { processingStatus: undefined, processingStatusId: undefined, processingStatusDetail: undefined };

/** A reply that has ended (done, failed or stopped) shows no wait line. */
export function clearTransientStatus<M extends StatusPatch>(message: M): M {
  if (!message.processingStatusId || !TRANSIENT_STATUS_IDS.has(message.processingStatusId)) return message;
  return { ...message, ...CLEARED };
}
