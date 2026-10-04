/** The ids a whole-list chat save did not store because another list holds them (#765). The server
 *  adds `skipped` only when the move dedupe dropped something, so an older reply (or anything
 *  malformed) reads as nothing skipped. A non-empty result means this tab's lists are stale. */
export function skippedChatIds(result: unknown): string[] {
  const skipped = (result as { skipped?: unknown } | null | undefined)?.skipped;
  return Array.isArray(skipped) ? skipped.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
}

/** Drop the skipped ids from a list this tab is about to treat as saved, so a stale copy of a moved
 *  chat does not linger in the refs if the follow-up refresh is superseded. */
export function withoutSkipped<T extends { id: string }>(list: T[], skipped: readonly string[]): T[] {
  if (!skipped.length) return list;
  const gone = new Set(skipped);
  return list.filter((c) => !gone.has(c.id));
}
