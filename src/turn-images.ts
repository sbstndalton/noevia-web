/** #1512: the project image sources a chat message attaches, sent as `turnImageIds`. The server
 *  (chat-mode.cjs) accepts at most 12 ids, each a string of at most 80 characters, and loads and
 *  describes only the named images. A message with no image attachments sends `[]`, so a text,
 *  CSV, JSON or DOCX turn never runs the vision pass. */
export const TURN_IMAGE_CAP = 12;
const ID_MAX = 80;

/** A usable image source id, or null. Anything the server would refuse is dropped here, so one bad
 *  id can never turn a whole send into a 400. */
export function turnImageId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= ID_MAX ? value : null;
}

/** Add one image source to the list for the next message. Repeats are kept once; past the cap the
 *  oldest id goes, so the newest attachment is always the one that is sent. Pure: returns a new list. */
export function addTurnImage(ids: readonly string[], id: string): string[] {
  const next = turnImageId(id);
  if (!next) return [...ids];
  return [...ids.filter((existing) => existing !== next), next].slice(-TURN_IMAGE_CAP);
}

/** The `turnImageIds` to send for a message: valid, unique, capped. Always an array (possibly empty). */
export function turnImageIdsToSend(ids: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const value of ids ?? []) {
    const id = turnImageId(value);
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(-TURN_IMAGE_CAP);
}
