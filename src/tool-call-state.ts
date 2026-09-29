import type { ToolCallView } from './types';

/** The approval card's call for a 'tool_pending' stream event, built the same way in chat and in
 *  the Diary, so both carry the resolved file an edit would change (#648). */
export function pendingToolCall(ev: { name?: string; args?: string; id?: string; target?: string; targetKind?: string; repeatOf?: boolean }): ToolCallView {
  return {
    name: ev.name || 'tool',
    args: ev.args || '',
    status: 'pending',
    approvalId: ev.id,
    ...(typeof ev.target === 'string' && ev.target ? { target: ev.target } : {}),
    // #659: a Google Drive file (existing or new) rather than a project file.
    ...(ev.targetKind === 'drive' || ev.targetKind === 'drive-new' ? { targetKind: ev.targetKind } : {}),
    // #658: the same change as one already saved in this chat. A flag on the card, nothing more.
    ...(ev.repeatOf === true ? { repeatOf: true } : {}),
  };
}

/** The chip for a finished call (#658): the result, and whether it was a write that ran and
 *  succeeded, so later turns can tell the model it is done. Keeps the target the card showed. */
export function finishedToolCall(previous: ToolCallView | undefined, ev: { name?: string; text?: string; applied?: boolean; target?: string }, resultLimit: number): ToolCallView {
  const denied = (ev.text || '').startsWith('ERROR: the user');
  const target = typeof ev.target === 'string' && ev.target ? ev.target : previous?.target;
  return {
    name: ev.name || previous?.name || 'tool',
    args: previous ? previous.args : '',
    result: (ev.text || '').slice(0, resultLimit),
    status: denied ? 'denied' : 'done',
    ...(target ? { target } : {}),
    ...(previous?.targetKind ? { targetKind: previous.targetKind } : {}),
    ...(ev.applied === true ? { applied: true } : {}),
  };
}

/** Once a reply has ended (finished, stopped, failed or reloaded), nothing can still be running or
 *  awaiting approval: the server-side approval died with the request. Mark such calls "stopped"
 *  and drop approval ids so no dead approval card is shown or saved. */
export function settleToolCalls(calls: ToolCallView[] | undefined): ToolCallView[] | undefined {
  if (!calls) return calls;
  return calls.map(({ approvalId: _approvalId, ...call }) =>
    call.status === 'done' || call.status === 'denied' ? call : { ...call, status: 'stopped' as const });
}
