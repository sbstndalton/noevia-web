import type { HistoryEntry, Message, ModelHistoryEntry, ToolCallView } from './types';

/** #658: the writes a reply ran successfully (the server marks their `tool_result` as applied). */
export function appliedCalls(m: Pick<Message, 'toolCalls'>): ToolCallView[] {
  return (m.toolCalls || []).filter((c) => c && c.applied === true);
}

/** The history sent with a turn. Each turn as before (a failed reply's own text is left out),
 *  plus one entry per change an earlier reply already saved, INCLUDING a reply that then failed
 *  or was paused (#658). The server words those for the model as done, so it does not propose
 *  the same change again on the next turn or on a Retry. */
export function modelHistory(messages: Message[]): ModelHistoryEntry[] {
  const out: ModelHistoryEntry[] = [];
  for (const m of messages) {
    if (!m.error) out.push({ role: m.role, content: m.content });
    if (m.role !== 'assistant') continue;
    for (const c of appliedCalls(m)) {
      out.push({ role: 'tool', name: c.name, content: c.result || '', applied: true,
        ...(c.target ? { target: c.target } : {}), ...(c.args ? { args: c.args } : {}) });
    }
  }
  return out;
}

/** A reply turned into the record of the changes it saved: its tool list and a note, no text.
 *  What stays in the transcript when a reply that saved changes is failed, retried or replaced. */
export function appliedRecord(m: Message): Message | null {
  const applied = appliedCalls(m).length;
  if (m.role !== 'assistant' || !applied) return null;
  // Only the tool list and the note: none of the reply's text, routing, thinking or stats.
  return { id: m.id, role: 'assistant', content: '', toolCalls: m.toolCalls, paused: { reason: 'stopped', applied } };
}

/** The transcript to resend on when the reply at `index` (produced by the user turn right
 *  before it) is re-run by Retry or Regenerate. Without saved changes: everything before that
 *  user turn, as before. With them (#658): the user turn and the reply's record stay, so the
 *  model is told the change is done instead of being asked the same thing with no trace of it. */
export function rerunBase(messages: Message[], index: number): Message[] {
  const record = index >= 1 ? appliedRecord(messages[index]) : null;
  return record ? [...messages.slice(0, index), record] : messages.slice(0, Math.max(0, index - 1));
}

/** The transcript to resend on when the user message at `index` is edited and re-run. Everything
 *  from that message on is dropped as before, EXCEPT the records of changes the dropped replies
 *  already saved (#658 review): those writes happened, so the model must still be told they are
 *  done, or it proposes them again. */
export function editBase(messages: Message[], index: number): Message[] {
  const kept = messages.slice(0, Math.max(0, index));
  const records = messages.slice(Math.max(0, index)).map(appliedRecord).filter((m): m is Message => m !== null);
  return [...kept, ...records];
}

/** What a reply is saved as. A failed reply is not saved, unless it saved changes: then its
 *  record is, so a reload still shows (and tells the model) what was done. */
export function persistableMessage(m: Message): Message | null {
  if (!m.error) return m;
  return appliedRecord(m);
}

/** The `paused` field read back from a saved history entry, if it is well formed. */
export function storedPause(h: Pick<HistoryEntry, 'paused'>): Message['paused'] {
  const p = h.paused;
  if (!p || (p.reason !== 'supervision' && p.reason !== 'stopped') || !Number.isInteger(p.applied) || p.applied < 0) return undefined;
  return { reason: p.reason, applied: p.applied };
}
