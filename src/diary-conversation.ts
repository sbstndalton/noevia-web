import { localDay, localTimestamp } from './diary-data';

export type DiaryTurn = { role: 'user' | 'assistant'; content: string };

/** Pin the date once at Send, including history when returning through home.
 * This same target owns replies, retries and optional-tool approval scope. */
export function diaryExchangeTarget(day: string | null, turns: Record<string, DiaryTurn[]>, now = new Date()) {
  const entryDay = day || localDay(now);
  return { entryDay, month: entryDay.slice(0, 7), entryTime: localTimestamp(now), history: (turns[entryDay] || []).slice(-16) };
}
