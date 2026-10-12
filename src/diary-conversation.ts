import type { ModelHistoryEntry, ToolCallView } from './types';
import { appliedCalls } from './applied-writes';
import { localDay, localTimestamp } from './diary-data';

/** `exchangeId` marks the user turn of a recovered exchange (the banner's "Show it" finds it); `failed`
 *  marks both turns of an exchange the server knows saved nothing (#1422): shown, never sent as history.
 *  #1505: `uncertain` (the save outcome was not confirmed, dismissed or not) and `running` (still processing)
 *  mark an exchange that is not a completed answer; neither is sent as history either. */
export type DiaryTurn = { role: 'user' | 'assistant'; content: string; startedAt?: number; tools?: ToolCallView[]; activity?: string[]; reasoning?: string; exchangeId?: string; failed?: boolean; uncertain?: boolean; running?: boolean };

/** Pin the date once at Send, including history when returning through home.
 * This same target owns replies, retries and optional-tool approval scope. */
export function diaryExchangeTarget(day: string | null, turns: Record<string, DiaryTurn[]>, now = new Date()) {
  const entryDay = day || localDay(now);
  return { entryDay, month: entryDay.slice(0, 7), entryTime: localTimestamp(now), history: diaryHistory((turns[entryDay] || []).slice(-16)) };
}

/** #664: role/content per turn, plus one applied-write entry after each assistant turn for every
 *  call that succeeded (`applied === true`), so a retry tells the model the change is already
 *  done. Declined, failed and pending calls are not marked. Same shape as modelHistory (#658).
 *
 *  #1505: only completed exchanges are sent: a user turn and the non-empty answer that followed it,
 *  neither of them failed, uncertain or running. Anything else is left out, so a question whose reply
 *  never arrived is not answered again when the next message comes in. */
export function diaryHistory(turns: DiaryTurn[]): ModelHistoryEntry[] {
  const out: ModelHistoryEntry[] = [];
  for (let i = 0; i < turns.length; i++) {
    const prompt = turns[i], reply = turns[i + 1];
    if (!completedExchange(prompt, reply)) continue;
    out.push({ role: 'user', content: prompt.content }, { role: 'assistant', content: reply.content });
    i += 1;
    for (const c of appliedCalls({ toolCalls: reply.tools })) {
      out.push({ role: 'tool', name: c.name, content: c.result || '', applied: true,
        ...(c.target ? { target: c.target } : {}), ...(c.args ? { args: c.args } : {}) });
    }
  }
  return out;
}

/** #1505: a user turn and the answer right after it, both completed and neither held back. */
function completedExchange(prompt: DiaryTurn | undefined, reply: DiaryTurn | undefined): reply is DiaryTurn {
  return !!prompt && prompt.role === 'user' && prompt.content.trim() !== '' && !heldBack(prompt)
    && !!reply && reply.role === 'assistant' && reply.content.trim() !== '' && !heldBack(reply);
}

/** #1422/#1505: an exchange the server knows saved nothing, could not confirm, or has not finished. */
function heldBack(turn: DiaryTurn): boolean {
  return !!(turn.failed || turn.uncertain || turn.running);
}
