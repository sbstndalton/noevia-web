import type { Translate } from '../../i18n';

/** The reasons the import route gives for a skipped chat (crates/server-projects import.rs). */
const ALREADY = 'already in this account';

/** One sentence per distinct reason, so "the file's copy differs" is not hidden as "already here". */
export function skippedSummary(skipped: unknown, t: Translate): string[] {
  if (!Array.isArray(skipped)) return [];
  const counts = new Map<string, number>();
  for (const item of skipped) {
    const reason = typeof (item as { reason?: unknown } | null)?.reason === 'string' ? (item as { reason: string }).reason : '';
    const kind = reason === ALREADY ? 'data.skipped'
      : reason.startsWith(`${ALREADY};`) ? 'data.skippedDiffers'
      : reason === 'repeated in this file' ? 'data.skippedRepeated'
      : 'data.skippedOther';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => t.plural(key, count));
}
