import type { Message, RoutingDecision } from './types';

/** Only the latest assistant turn in the visible chat can describe the current reply. */
export function currentRoutingDecision(messages: Message[], chatVisible: boolean): RoutingDecision | null {
  if (!chatVisible) return null;
  const latest = messages[messages.length - 1];
  return latest?.role === 'assistant' ? latest.routingDecision ?? null : null;
}

/**
 * Guards every field the routing panel reads before it renders. Saved history can be edited
 * by hand, merged from another device, or imported from an older export whose shape has since
 * drifted — none of that may crash the chat view, so anything that does not look exactly like
 * a RoutingDecision this build understands is treated as "nothing to show" rather than thrown.
 */
export function isDisplayableRoutingDecision(decision: unknown): decision is RoutingDecision {
  if (!decision || typeof decision !== 'object') return false;
  const d = decision as Partial<RoutingDecision>;
  return Array.isArray(d.offered) &&
    (d.status === 'accepted' || d.status === 'fallback') &&
    (d.effectiveRole === 'fast' || d.effectiveRole === 'smart' || d.effectiveRole === 'code');
}
