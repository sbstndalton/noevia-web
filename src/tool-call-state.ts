import type { ToolCallView } from './types';

/** Once a reply has ended (finished, stopped, failed or reloaded), nothing can still be running or
 *  awaiting approval: the server-side approval died with the request. Mark such calls "stopped"
 *  and drop approval ids so no dead approval card is shown or saved. */
export function settleToolCalls(calls: ToolCallView[] | undefined): ToolCallView[] | undefined {
  if (!calls) return calls;
  return calls.map(({ approvalId: _approvalId, ...call }) =>
    call.status === 'done' || call.status === 'denied' ? call : { ...call, status: 'stopped' as const });
}
