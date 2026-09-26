import type { Message } from './types';

/** What re-running the last reply needs: the user text that produced it, and the transcript to
 *  resend on top of (everything before that user turn — the same "base" shape `handleSend` in
 *  App.tsx already accepts for Retry and Edit-and-re-run). */
export interface RegeneratePlan {
  userText: string;
  base: Message[];
}

/** #356: Regenerate only ever targets the last completed assistant reply, produced by the user
 *  message directly before it. It is deliberately declined for:
 *  - anything but the final message (never touch earlier history),
 *  - an errored reply (that is what Retry is for),
 *  - a Cowork task reply (starting a new task is not "the same turn"),
 *  - a reply whose preceding message is not a plain user turn (nothing to resend).
 *
 *  The returned plan carries only `userText` (the original request) and `base` (the transcript
 *  with the old reply removed). None of the old reply's own fields — routingDecision, toolCalls,
 *  stats, reasoning, senderLabel — survive into the plan, so a caller that resends `userText` on
 *  top of `base` cannot accidentally replay that stored metadata into the model's history. */
export function planRegenerate(messages: Message[], messageId: string): RegeneratePlan | null {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 1 || index !== messages.length - 1) return null;
  const reply = messages[index];
  if (reply.role !== 'assistant' || reply.error || reply.coworkTask) return null;
  const prompt = messages[index - 1];
  if (prompt.role !== 'user') return null;
  return { userText: prompt.content, base: messages.slice(0, index - 1) };
}
