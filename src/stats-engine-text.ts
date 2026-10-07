import type { ReplyTelemetry } from './types';

/** noevia#1002: the engine rows (Engine total, GPU) of the stats footer when the engine reported
 *  nothing. A reply that failed before the engine produced anything (no first token, no usage:
 *  a refused request, an unreachable backend) says nothing about the engine, so "Not reported"
 *  rather than "Unavailable from engine", which reads as a GPU or engine fault. */
export function engineEmptyKey(reply: ReplyTelemetry | null | undefined): 'stats.notReported' | 'stats.unavailable' {
  const failedEarly = reply?.phase === 'error' && reply.timeToFirstToken == null
    && reply.inputTokens == null && reply.outputTokens == null;
  return failedEarly ? 'stats.notReported' : 'stats.unavailable';
}
