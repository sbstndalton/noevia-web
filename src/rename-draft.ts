/**
 * Collapse a title's whitespace, including embedded newlines, before it prefills the
 * single-line sidebar rename input (#360). The browser drops a raw newline from a
 * single-line `<input>`'s value without inserting a space, so "…3 fruits\nand…" silently
 * became "fruitsand" — this makes the join explicit instead.
 */
export function normalizeRenameDraft(title: string): string {
  return title.replace(/\s+/g, ' ');
}
