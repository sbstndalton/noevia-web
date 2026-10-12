import type { ModelHistoryEntry, ToolCallView } from './types';
import { appliedCalls } from './applied-writes';
import { localDay, localTimestamp } from './diary-data';

/** `exchangeId` marks the user turn of a recovered exchange (the banner's "Show it" finds it); `failed`
 *  marks both turns of an exchange the server knows saved nothing (#1422): shown, never sent as history. */
export type DiaryTurn = { role: 'user' | 'assistant'; content: string; startedAt?: number; tools?: ToolCallView[]; activity?: string[]; reasoning?: string; exchangeId?: string; failed?: boolean };

/** Pin the date once at Send, including history when returning through home.
 * This same target owns replies, retries and optional-tool approval scope. */
export function diaryExchangeTarget(day: string | null, turns: Record<string, DiaryTurn[]>, now = new Date()) {
  const entryDay = day || localDay(now);
  return { entryDay, month: entryDay.slice(0, 7), entryTime: localTimestamp(now), history: diaryHistory((turns[entryDay] || []).slice(-16)) };
}

/** #664: role/content per turn, plus one applied-write entry after each assistant turn for every
 *  call that succeeded (`applied === true`), so a retry tells the model the change is already
 *  done. Declined, failed and pending calls are not marked. Same shape as modelHistory (#658). */
export function diaryHistory(turns: DiaryTurn[]): ModelHistoryEntry[] {
  const out: ModelHistoryEntry[] = [];
  for (const { role, content, tools, failed } of turns) {
    if (failed) continue; // #1422: nothing of a failed exchange was saved or answered
    out.push({ role, content });
    if (role !== 'assistant') continue;
    for (const c of appliedCalls({ toolCalls: tools })) {
      out.push({ role: 'tool', name: c.name, content: c.result || '', applied: true,
        ...(c.target ? { target: c.target } : {}), ...(c.args ? { args: c.args } : {}) });
    }
  }
  return out;
}
