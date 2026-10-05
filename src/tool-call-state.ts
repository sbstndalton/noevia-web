import type { ToolCallView, ToolProvenance } from './types';

/** #769: the provenance notes of a 'tool_pending' event, kept only in the expected shape. */
export function provenanceNotes(value: unknown): ToolProvenance[] {
  if (!Array.isArray(value)) return [];
  const text = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 200) : null);
  return value.slice(0, 5).filter((p) => p && typeof p === 'object').map((p) => ({
    field: text(p.field), source: text(p.source), ...(p.unchecked === true ? { unchecked: true } : {}),
  })).filter((p) => p.unchecked || p.source);
}

/** The approval card's call for a 'tool_pending' stream event, built the same way in chat and in
 *  the Diary, so both carry the resolved file an edit would change (#648). */
export function pendingToolCall(ev: { name?: string; args?: string; id?: string; target?: string; targetKind?: string; repeatOf?: boolean; provenance?: unknown; server?: unknown }): ToolCallView {
  const provenance = provenanceNotes(ev.provenance);
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
    // #769: where a sensitive argument's text came from. A note on the card; all three actions stay.
    ...(provenance.length ? { provenance } : {}),
    // #887: which MCP server this write goes to, so two servers offering one tool name can be told apart.
    ...(typeof ev.server === 'string' && ev.server ? { server: ev.server.slice(0, 200) } : {}),
  };
}

/** The chip for a finished call (#658): the result, and whether it was a write that ran and
 *  succeeded, so later turns can tell the model it is done. Keeps the target the card showed. */
export function finishedToolCall(previous: ToolCallView | undefined, ev: { name?: string; text?: string; applied?: boolean; target?: string; declined?: boolean; notRun?: boolean }, resultLimit: number): ToolCallView {
  // #666 review: the server says so explicitly (`declined`: not approved; `notRun`: skipped after
  // a decline). Tool text is never read for it: a tool's own "ERROR: the user …" is not a decline.
  // Saved chats keep the status they were stored with.
  const denied = ev.declined === true;
  const target = typeof ev.target === 'string' && ev.target ? ev.target : previous?.target;
  return {
    name: ev.name || previous?.name || 'tool',
    args: previous ? previous.args : '',
    result: (ev.text || '').slice(0, resultLimit),
    status: denied ? 'denied' : ev.notRun === true ? 'stopped' : 'done',
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

/** The same rule for a whole reply (#793): once it has ended, its tool calls are settled and a
 *  "This looks sensitive" routing question (`routePending`) is dropped. The server's question died
 *  with the request, so a card left behind after Stop would post to a dead id. The message is
 *  returned unchanged when there is nothing to settle. */
export function settleReply<M extends { toolCalls?: ToolCallView[]; routePending?: unknown }>(message: M): M {
  if (!message.toolCalls && !message.routePending) return message;
  const { routePending: _routePending, ...rest } = message;
  return (message.toolCalls ? { ...rest, toolCalls: settleToolCalls(message.toolCalls) } : rest) as M;
}
