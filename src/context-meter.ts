import type { ContextMeter, Message } from './types';

/** #1551: the server's `context` stream event carries the context meter's fields at the top level
 *  (chat.cjs sends `{type:'context', ...meter}` at prep and after each tool round). This reads one
 *  into a meter, or returns null when the numbers the meter needs are not there (nothing is shown as zero). */
export function contextMeterFromEvent(ev: unknown): ContextMeter | null {
  const o = (ev && typeof ev === 'object' ? ev : {}) as Record<string, unknown>;
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!count(o.used) || !count(o.reserve) || !count(o.safety) || !count(o.threshold)) return null;
  if (typeof o.limit !== 'number' || !Number.isFinite(o.limit) || o.limit <= 0 || !Array.isArray(o.parts)) return null;
  const parts = o.parts.flatMap((p: unknown) => {
    const part = p as { name?: unknown; tokens?: unknown } | null;
    return part && typeof part.name === 'string' && count(part.tokens) ? [{ name: part.name, tokens: part.tokens }] : [];
  });
  return {
    historyCount: count(o.historyCount) ? o.historyCount : 0,
    model: typeof o.model === 'string' ? o.model : '',
    limit: o.limit,
    limitSource: typeof o.limitSource === 'string' ? o.limitSource : '',
    used: o.used, reserve: o.reserve, safety: o.safety, threshold: o.threshold,
    parts,
    compactedAt: count(o.compactedAt) ? o.compactedAt : null,
    covered: count(o.covered) ? o.covered : 0,
    ...(count(o.updatedAt) ? { updatedAt: o.updatedAt } : {}),
  };
}

/** UTF-8 bytes of a message's text: the estimate's unit (about three bytes to a token). */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The measurement for the current turn: the latest reply that carries a meter, provided no user turn
 *  came after it. Its index is in `messages`. Null when there is none (an older chat, or a turn that has
 *  not started). */
export function latestMeasurement(messages: readonly Message[]): { index: number; meter: ContextMeter; replyBytes: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.contextMeter) continue;
    if (messages.slice(i + 1).some((later) => later.role === 'user')) return null;
    return { index: i, meter: m.contextMeter.meter, replyBytes: m.contextMeter.replyBytes };
  }
  return null;
}

/** Tokens the last measurement did not count. With a measurement: only the reply's prose written since
 *  the server measured it (the prose already in the meter is not counted again). Without one: every
 *  message after the server's history count, as before #1551. */
export function unmeasuredTokens(messages: readonly Message[], historyCount: number | undefined): number {
  const measurement = latestMeasurement(messages);
  if (measurement) {
    const grown = Math.max(0, utf8Bytes(messages[measurement.index].content) - measurement.replyBytes);
    return Math.ceil(grown / 3);
  }
  return messages.filter((m) => !m.error && m.content).slice(historyCount ?? messages.length)
    .reduce((n, m) => n + Math.ceil(utf8Bytes(m.content) / 3) + 12, 0);
}

/** The meter to show. While a reply streams, the one the server measured for it (the fetched copy is not
 *  refreshed mid-reply). Once it ends, whichever measurement is newer: the fetched snapshot, unless a
 *  compaction after the reply left a newer one. */
export function newerMeter(measured: ContextMeter | null, fetched: ContextMeter | null, streaming: boolean): ContextMeter | null {
  if (!measured) return fetched;
  if (!fetched || streaming) return measured;
  return (fetched.updatedAt ?? 0) > (measured.updatedAt ?? 0) ? fetched : measured;
}
