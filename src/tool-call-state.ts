import type { ToolCallView } from './types';

/** The approval card's call for a 'tool_pending' stream event, built the same way in chat and in
 *  the Diary, so both carry the resolved file an edit would change (#648). */
export function pendingToolCall(ev: { name?: string; args?: string; id?: string; target?: string }): ToolCallView {
  return {
    name: ev.name || 'tool',
    args: ev.args || '',
    status: 'pending',
    approvalId: ev.id,
    ...(typeof ev.target === 'string' && ev.target ? { target: ev.target } : {}),
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
