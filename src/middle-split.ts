// Where a long label is cut for MiddleTruncate. Pure and import-free so the tests load it directly.

/** How many trailing characters the tail keeps: the size and quantization of a model name. */
export const TAIL = 10;

/** The head keeps the start of the label (and takes the ellipsis), the tail its last TAIL
 *  characters. They always join back into `text`, so a space at the cut belongs to one of them and
 *  is never lost (#620); the stylesheet keeps it visible with `white-space: pre`. Null when the
 *  label is short enough to show whole. */
export function splitMiddle(text: string): { head: string; tail: string } | null {
  if (text.length <= TAIL + 6) return null;
  return { head: text.slice(0, -TAIL), tail: text.slice(-TAIL) };
}
