// Limits of the Spaces store (sbstndalton/noevia#2446, "Phase 1 design and API note"). The server
// enforces them too; the client checks first so a refused write never leaves the person's text
// without a home and the error can be worded in their language.
export const SPACE_NAME_MAX = 80;
export const PAGE_TITLE_MAX = 200;
export const PAGE_BYTES_MAX = 512 * 1024;
export const PAGE_SEARCH_MAX = 200;
export const PAGE_LIST_LIMIT = 100;

const encoder = new TextEncoder();
export const utf8Bytes = (text: string): number => encoder.encode(text).length;

export type SearchQuery = { kind: 'none' } | { kind: 'too-long'; length: number } | { kind: 'ok'; q: string };

/** What a search box holds, as the request it may send: blank sends nothing, and a query over the
 *  server's limit is never sent (it would be refused with a 400 the screen then misreads, #2399). */
export function searchQuery(raw: string): SearchQuery {
  const q = raw.trim();
  if (!q) return { kind: 'none' };
  if ([...q].length > PAGE_SEARCH_MAX) return { kind: 'too-long', length: [...q].length };
  return { kind: 'ok', q };
}

export type DraftProblem = 'title-empty' | 'title-long' | 'too-large';

/** Why a draft cannot be saved, or null. Checked before any request: the draft is kept either way. */
export function draftProblem(draft: { title: string; content: string }): DraftProblem | null {
  const title = draft.title.trim();
  if (!title) return 'title-empty';
  // The raw length: what is sent is what is counted (trimming only on send would make the draft differ from the base for ever).
  if ([...draft.title].length > PAGE_TITLE_MAX) return 'title-long';
  if (utf8Bytes(draft.content) > PAGE_BYTES_MAX) return 'too-large';
  return null;
}
