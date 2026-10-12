// The transcript as saved and loaded, and the alternatives kept by Regenerate and Edit & re-run (#1517).
// Pure: no React, no fetch. The model is sent only the active path (the messages as they are shown),
// because each message's own content is the answer or version on screen; stored alternatives never
// reach a request.
//
// Data model (saved as opaque fields of the history entries, so noevia-core keeps them unchanged):
// - Regenerate: the user turn holds `answers` (every answer it has had) and `answer` (the one shown).
//   The assistant message after the turn is the shown answer.
// - Edit & re-run: the edited user turn holds `branches` (every version of the turn, each with the chat
//   that followed it) and `branch` (the version shown). The live messages are the shown version's chat.

import type { HistoryEntry, Message, ReplyVariant, TurnBranch } from './types';
import { persistableMessage, storedPause } from './applied-writes';
import { interruptedFlag, storedInterrupted } from './interrupted-reply';
import { settleToolCalls } from './tool-call-state';
import { isRouteTarget } from './components/RouteControls';

/** One saved history entry as a message. Used when the transcript loads, when another device's copy
 *  is merged in, and when a stored version of a turn is shown again. */
export function messageFromEntry(h: HistoryEntry, id: string): Message {
  return {
    id,
    role: h.role,
    content: h.content,
    senderLabel: h.model,
    routingDecision: h.routingDecision,
    ...(isRouteTarget(h.routeTarget) ? { routeTarget: h.routeTarget } : {}),
    reasoning: h.reasoning,
    reasoningMs: h.reasoningMs,
    toolCalls: settleToolCalls(h.toolCalls),
    stats: h.stats,
    coworkTask: h.coworkTask,
    sources: h.sources,
    ...(h.role === 'user' && h.skill ? { skill: h.skill } : {}),
    ...(h.role === 'assistant' && storedPause(h) ? { paused: storedPause(h) } : {}),
    ...(storedInterrupted(h) ? { interrupted: true } : {}),
    ...(h.role === 'user' && h.answers !== undefined ? { answers: h.answers, answer: h.answer } : {}),
    ...(h.role === 'user' && h.branches !== undefined ? { branches: h.branches, branch: h.branch } : {}),
  };
}

/** A message as the transcript saves it. Callers pass only messages that are saved (see entriesFor). */
function entryOf(m: Message): HistoryEntry {
  return {
    role: m.role,
    content: m.content,
    model: m.senderLabel,
    routingDecision: m.routingDecision,
    ...(m.routeTarget ? { routeTarget: m.routeTarget } : {}),
    reasoning: m.reasoning || undefined,
    reasoningMs: m.reasoningMs,
    toolCalls: m.toolCalls && m.toolCalls.length ? m.toolCalls : undefined,
    stats: m.stats,
    coworkTask: m.coworkTask,
    sources: m.sources && m.sources.length ? m.sources : undefined,
    skill: m.role === 'user' ? m.skill : undefined,
    paused: m.role === 'assistant' ? m.paused : undefined,
    interrupted: interruptedFlag(m),
    ...(m.role === 'user' && m.answers !== undefined ? { answers: m.answers, answer: m.answer } : {}),
    ...(m.role === 'user' && m.branches !== undefined ? { branches: m.branches, branch: m.branch } : {}),
  };
}

/** The transcript as it is saved: every turn's stored alternatives brought up to date with what it
 *  shows now, and a failed reply left out (unless it saved changes, see persistableMessage). */
export function entriesFor(messages: Message[]): HistoryEntry[] {
  return syncTurns(messages)
    .map(persistableMessage)
    .filter((m): m is Message => m !== null)
    .map(entryOf);
}

/** What a re-run replaces, for the alternatives it keeps (#1517): a Regenerate keeps the turn's answer that it
 *  replaces (`reply`), an Edit & re-run keeps the version of the turn and the chat that followed it (`tail`). */
export type VariantSource = { kind: 'answer'; user: Message; reply: Message | undefined } | { kind: 'branch'; user: Message; tail: Message[] };

/** The answer a message shows, as one stored alternative. */
export function answerOf(m: Message): ReplyVariant {
  return {
    content: m.content,
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.reasoningMs !== undefined ? { reasoningMs: m.reasoningMs } : {}),
    ...(m.toolCalls?.length ? { toolCalls: m.toolCalls } : {}),
    ...(m.stats ? { stats: m.stats } : {}),
    ...(m.senderLabel ? { senderLabel: m.senderLabel } : {}),
    ...(m.routingDecision ? { routingDecision: m.routingDecision } : {}),
    ...(m.sources?.length ? { sources: m.sources } : {}),
  };
}

/** The fields a stored answer puts on the message that shows it. Every answer field is set (undefined
 *  when the stored answer has none), so nothing of the answer shown before survives a switch. */
export function answerFields(v: ReplyVariant): Partial<Message> {
  return {
    content: v.content,
    reasoning: v.reasoning,
    reasoningMs: v.reasoningMs,
    toolCalls: v.toolCalls,
    stats: v.stats,
    senderLabel: v.senderLabel,
    routingDecision: v.routingDecision,
    sources: v.sources,
    error: undefined,
    warning: undefined,
    paused: undefined,
    interrupted: undefined,
    routeTarget: undefined,
    coworkTask: undefined,
  };
}

/** The stored answers of a user turn, with the answer shown (`reply`, the message after it) brought up to date. */
export function syncedAnswers(user: Message, reply: Message | undefined): ReplyVariant[] {
  const list = [...(user.answers ?? [])];
  const slot = user.answer ?? 0;
  // #658: a record of saved changes has no text. It never replaces a stored answer that has some.
  if (reply?.role === 'assistant' && !reply.error && (reply.content.trim() || !list[slot]?.content.trim())) list[slot] = answerOf(reply);
  return list;
}

/** Regenerate: the answers a turn keeps before its reply is replaced, and the slot for the new one. */
export function answersBeforeRegenerate(user: Message, reply: Message | undefined): Pick<Message, 'answers' | 'answer'> {
  const answers = syncedAnswers(user, reply);
  return { answers, answer: answers.length };
}

/** The stored versions of a user turn, with the version shown (and the chat after it, `tail`) brought up to date. */
export function syncedBranches(user: Message, tail: Message[]): TurnBranch[] {
  const answers = user.answers !== undefined ? syncedAnswers(user, tail[0]) : undefined;
  const list = [...(user.branches ?? [])];
  list[user.branch ?? 0] = {
    content: user.content,
    ...(user.skill ? { skill: user.skill } : {}),
    ...(answers !== undefined ? { answers, answer: user.answer ?? 0 } : {}),
    tail: entriesFor(tail),
  };
  return list;
}

/** Edit & re-run: the versions a turn keeps before it is replaced by the edited one, and the slot for the new one.
 *  `tail` is everything that followed the turn, which the edit drops from the live chat. */
export function branchesBeforeEdit(user: Message, tail: Message[]): Pick<Message, 'branches' | 'branch'> {
  const branches = syncedBranches(user, tail);
  return { branches, branch: branches.length };
}

/** How many answers a turn has, for its switcher (1 means no switcher). */
export function answerCount(user: Message | undefined): number {
  return user?.role === 'user' && user.answers !== undefined ? Math.max(user.answers.length, (user.answer ?? 0) + 1) : 1;
}

/** How many versions a user turn has, for its switcher (1 means no switcher). */
export function branchCount(user: Message | undefined): number {
  return user?.role === 'user' && user.branches !== undefined ? Math.max(user.branches.length, (user.branch ?? 0) + 1) : 1;
}

/** Shows another stored answer for the turn at `index`. Returns the messages with that answer in place,
 *  or null when there is nothing to change. */
export function selectAnswer(messages: Message[], index: number, next: number): Message[] | null {
  const user = messages[index];
  const reply = messages[index + 1];
  if (!user || user.role !== 'user' || reply?.role !== 'assistant' || user.answers === undefined) return null;
  if (next === (user.answer ?? 0)) return null;
  const list = syncedAnswers(user, reply);
  const target = list[next];
  if (!target) return null;
  return [
    ...messages.slice(0, index),
    { ...user, answers: list, answer: next },
    { ...reply, ...answerFields(target) },
    ...messages.slice(index + 2),
  ];
}

/** Shows another stored version of the user turn at `index`, with the chat that followed it. Returns the
 *  messages from that turn on, or null when there is nothing to change. */
export function selectBranch(messages: Message[], index: number, next: number, newId: () => string): Message[] | null {
  const user = messages[index];
  if (!user || user.role !== 'user' || user.branches === undefined) return null;
  if (next === (user.branch ?? 0)) return null;
  const list = syncedBranches(user, messages.slice(index + 1));
  const target = list[next];
  if (!target) return null;
  const updated: Message = {
    ...user,
    content: target.content,
    skill: target.skill,
    answers: target.answers,
    answer: target.answer,
    branches: list,
    branch: next,
  };
  return [...messages.slice(0, index), updated, ...target.tail.map((h) => messageFromEntry(h, newId()))];
}

/** After a load or a merge: a turn whose new answer never finished (it failed, or the page closed) has no reply
 *  after it. It shows the last answer it had instead, so the saved answers are not hidden, and its switcher
 *  points at that one. A turn whose answer is there is left alone. */
export function withStoredAnswers(messages: Message[], newId: () => string): Message[] {
  const out: Message[] = [];
  messages.forEach((m, i) => {
    if (m.role !== 'user' || m.answers === undefined || messages[i + 1]?.role === 'assistant' || m.answers.length === 0) {
      out.push(m);
      return;
    }
    const shown = Math.min(m.answer ?? m.answers.length, m.answers.length - 1);
    out.push({ ...m, answer: shown }, { id: newId(), role: 'assistant', content: '', ...answerFields(m.answers[shown]) });
  });
  return out;
}

/** Brings every turn's stored alternatives up to date with the messages shown. */
function syncTurns(messages: Message[]): Message[] {
  return messages.map((m, i) => {
    if (m.role !== 'user') return m;
    let next = m;
    if (m.answers !== undefined) next = { ...next, answers: syncedAnswers(m, messages[i + 1]) };
    if (m.branches !== undefined) next = { ...next, branches: syncedBranches(next, messages.slice(i + 1)) };
    return next;
  });
}
