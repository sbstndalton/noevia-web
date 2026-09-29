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
    // #666: writes the user declined (or did not answer in time). The reply that asked for them
    // has no text after the decline, so the model is told they did not run. The on-screen note
    // itself is never sent.
    for (const c of m.toolCalls || []) {
      if (c && c.status === 'denied' && c.applied !== true && typeof c.name === 'string') {
        out.push({ role: 'tool', name: c.name, content: c.result || '', declined: true });
      }
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
  // #666 review: without the calls that were not approved. A re-run is "try again": the model is
  // not told those were refused (a new write gets a fresh card anyway). A reply that ended on a
  // decline keeps saying so in its note.
  const toolCalls = (m.toolCalls || []).filter((c) => c && c.status !== 'denied');
  const paused: Message['paused'] = m.paused?.reason === 'declined'
    ? { reason: 'declined', applied, declined: declinedNames(m.paused.declined) }
    : { reason: 'stopped', applied };
  return { id: m.id, role: 'assistant', content: '', toolCalls, paused };
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
  if (!p || (p.reason !== 'supervision' && p.reason !== 'stopped' && p.reason !== 'declined') || !Number.isInteger(p.applied) || p.applied < 0) return undefined;
  // A decline whose names did not survive still reads as a decline, in general words.
  if (p.reason === 'declined') return { reason: 'declined', applied: p.applied, declined: declinedNames(p.declined) };
  return { reason: p.reason, applied: p.applied };
}

/** #666: the tool names a `paused` event or a saved entry says were declined: tool-name shaped
 *  strings only, each once, at most a few. Anything else is dropped. */
export function declinedNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value.filter((n): n is string => typeof n === 'string' && /^[\w.-]{1,80}$/.test(n));
  return Array.from(new Set(names)).slice(0, 8);
}
