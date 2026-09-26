import type { Message, ReplyTelemetry } from './types';

export interface ReplyTelemetryEvent {
  phase?: 'waiting' | 'streaming' | 'complete';
  model?: string | null;
  timeToFirstToken?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  tokensPerSecond?: number | null;
  drafted?: number | null;
  accepted?: number | null;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;

export function beginReplyTelemetry(model: string | null = null): ReplyTelemetry {
  return {
    phase: 'waiting', model,
    timeToFirstToken: null,
    inputTokens: null, outputTokens: null, totalTokens: null,
    tokensPerSecond: null,
    mtp: [],
  };
}

/** Apply only facts carried by this reply's stream. Missing fields stay unknown;
 * they are never converted into a factual zero. */
export function applyReplyTelemetry(previous: ReplyTelemetry | undefined, event: ReplyTelemetryEvent): ReplyTelemetry {
  const next = { ...(previous || beginReplyTelemetry()), phase: event.phase || previous?.phase || 'waiting' };
  if (typeof event.model === 'string' && event.model) next.model = event.model;
  if (finite(event.timeToFirstToken) && event.timeToFirstToken >= 0) next.timeToFirstToken = event.timeToFirstToken;
  if (count(event.promptTokens)) next.inputTokens = event.promptTokens;
  if (count(event.completionTokens)) next.outputTokens = event.completionTokens;
  if (count(event.totalTokens)) next.totalTokens = event.totalTokens;
  if (finite(event.tokensPerSecond) && event.tokensPerSecond > 0) next.tokensPerSecond = event.tokensPerSecond;
  if (count(event.drafted) && event.drafted > 0 && count(event.accepted) && event.accepted <= event.drafted) {
    next.mtp = [{
      model: next.model || 'Current model', source: 'last response',
      rate: event.accepted / event.drafted, drafted: event.drafted, accepted: event.accepted,
    }];
  }
  return next;
}

/** Rehydrates the status bar's last-reply stats from the chat's own stored history (#357):
 *  after a reload or navigation, replyTelemetryByChat starts empty (it only ever held live-stream
 *  state), so the bar showed "Not reported" as if the engine had failed even though the reply's
 *  numbers were saved right there on the message. Only the very last message can describe the
 *  chat's current reply — mirrors currentRoutingDecision's convention (current-routing.ts).
 *
 *  timeToFirstToken is never stored per message (only elapsedMs, the total), so it stays null here
 *  rather than being guessed from elapsedMs — an honest "Not reported" beats a fabricated number. */
export function lastReplyTelemetry(messages: Message[]): ReplyTelemetry | null {
  const latest = messages[messages.length - 1];
  if (latest?.role !== 'assistant' || !latest.stats) return null;
  const { promptTokens, completionTokens, totalTokens, tokensPerSecond } = latest.stats;
  if (promptTokens == null && completionTokens == null && totalTokens == null && tokensPerSecond == null) return null;
  return {
    phase: 'complete',
    model: latest.senderLabel ?? null,
    timeToFirstToken: null,
    inputTokens: promptTokens ?? null,
    outputTokens: completionTokens ?? null,
    totalTokens: totalTokens ?? null,
    tokensPerSecond: tokensPerSecond ?? null,
    mtp: [],
  };
}

export function finishReplyTelemetry(
  previous: ReplyTelemetry | undefined,
  outcome: 'complete' | 'stopped' | 'error',
): ReplyTelemetry {
  return { ...(previous || beginReplyTelemetry()), phase: outcome };
}
