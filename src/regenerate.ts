import type { Message } from './types';
import type { SkillPin } from './api-contract';
import { rerunBase } from './applied-writes';

/** What re-running the last reply needs: the user text that produced it, and the transcript to
 *  resend on top of (everything before that user turn — the same "base" shape `handleSend` in
 *  App.tsx already accepts for Retry and Edit-and-re-run). */
export interface RegeneratePlan {
  userText: string;
  base: Message[];
  /** The Skill pin the original message was sent with (#571), when it had one. */
  skill?: SkillPin;
  /** #1512: the project image sources the original message attached, when it had any. */
  turnImageIds?: string[];
}

/** #1517 with #658: when a record of saved changes keeps the old user turn in the transcript, the new turn takes
 *  over that turn's stored answers and versions. The kept copy gives them up, so they live on one turn: left on
 *  both, the record that follows it would be saved over one of its answers, and a reload would show two switchers. */
function withoutTurnVariants(base: Message[], prompt: Message): Message[] {
  const at = base.lastIndexOf(prompt);
  if (at < 0 || (prompt.answers === undefined && prompt.branches === undefined)) return base;
  const { answers: _answers, answer: _answer, branches: _branches, branch: _branch, ...rest } = prompt;
  return [...base.slice(0, at), rest as Message, ...base.slice(at + 1)];
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
  // #658: a reply that saved changes (approved writes that ran) is replaced, but the user turn and
  // the record of those changes stay (its tool list and a note; none of its text, routing,
  // thinking or stats), so the re-run is told they are done instead of making them again.
  return { userText: prompt.content, base: withoutTurnVariants(rerunBase(messages, index), prompt), ...(prompt.skill ? { skill: prompt.skill as SkillPin } : {}), ...(prompt.turnImageIds?.length ? { turnImageIds: prompt.turnImageIds } : {}) };
}

/** #682: what a Regenerate or Retry tells the server about the reply it replaces, for the
 *  text-free outcome record: only the kind of resend and the role/status that reply was routed
 *  with (enumerated values, never any text). Lets misroutes be counted. */
export interface ResendOutcome {
  kind: 'regenerate' | 'retry';
  role?: 'fast' | 'smart' | 'code';
  status?: 'accepted' | 'fallback';
}

export function resendOutcome(kind: ResendOutcome['kind'], reply: Message | undefined): ResendOutcome {
  const decision = reply?.routingDecision;
  const role = decision?.effectiveRole;
  const status = decision?.status;
  return {
    kind,
    ...(role === 'fast' || role === 'smart' || role === 'code' ? { role } : {}),
    ...(status === 'accepted' || status === 'fallback' ? { status } : {}),
  };
}
