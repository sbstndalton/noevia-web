// #1517 (owner decision 2026-10-13): a message keeps its last 10 variants (answers kept by Regenerate,
// versions kept by Edit & re-run). Older ones drop off; the one shown (the chosen one) is never dropped.
// The server enforces the same limit when a transcript is saved (noevia-core chat-variants.cjs); this
// keeps what is on screen in step with what will be stored.

export const MAX_VARIANTS = 10;

/** At most `max` variants, dropping the oldest (lowest index) first and never the chosen one.
 *  `chosen` may sit past the end of `list`: Regenerate and Edit & re-run reserve the slot for the reply
 *  that is still being made, and that slot counts toward the limit. The list is returned as is when it
 *  already fits. */
export function capVariants<T>(list: readonly T[], chosen: number | undefined, max = MAX_VARIANTS): { list: T[]; chosen: number } {
  const shown = Number.isInteger(chosen) && (chosen as number) >= 0 ? (chosen as number) : 0;
  let drop = Math.max(list.length, shown + 1) - max;
  if (drop <= 0) return { list: list as T[], chosen: shown };
  const keep: T[] = [];
  let before = 0;
  list.forEach((item, i) => {
    if (drop > 0 && i !== shown) { drop -= 1; if (i < shown) before += 1; return; }
    keep.push(item);
  });
  return { list: keep, chosen: shown - before };
}
