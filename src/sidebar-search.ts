// #439: pure helpers for the sidebar search box — matching/highlighting and the flat,
// DOM-order list of results ArrowDown/ArrowUp/Enter move through. Kept out of Sidebar.tsx so
// they can be unit-tested without a DOM or React (tests/sidebar-search.test.cjs).

/** Escapes every regex metacharacter in `s` so it can be dropped into `new RegExp(...)`
 *  literally. A query like "a.b(" must highlight only that literal text, and must never
 *  throw building the pattern — that would otherwise leave the whole search box unusable. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface HighlightSegment {
  /** A stable key for React's list rendering. */
  key: number;
  text: string;
  match: boolean;
}

/** Splits `text` into segments alternating unmatched/matched runs of `query`, case-insensitive.
 *  An empty query, or a query with no match, returns the whole text as one unmatched segment.
 *  Never builds HTML and never throws, regardless of the punctuation in `query` (#439: a query
 *  like "a.b(" must highlight literally, not be read as a regex). */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const q = query.trim();
  if (!q) return [{ key: 0, text, match: false }];
  const re = new RegExp(escapeRegExp(q), 'ig');
  const segments: HighlightSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ key: key++, text: text.slice(last, m.index), match: false });
    segments.push({ key: key++, text: m[0], match: true });
    last = m.index + m[0].length;
    // `query` is trimmed and only empty was excluded above, so a zero-length match cannot
    // happen in practice — this guard just keeps a future change from looping forever.
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (last < text.length) segments.push({ key: key++, text: text.slice(last), match: false });
  return segments.length ? segments : [{ key: 0, text, match: false }];
}

export type SearchResultKind = 'chat' | 'project';
export interface SearchResultRef {
  kind: SearchResultKind;
  id: string;
}

/** The flat, DOM-order list of sidebar search results: pinned chats, then pinned projects,
 *  then unpinned projects, then the (bounded) recent chats — the same order Sidebar.tsx
 *  renders them in once a query narrows the lists. ArrowDown/ArrowUp walk this array; Enter
 *  activates the button at the current index (a native button click, not modelled here). */
export function buildSearchResults(
  pinnedChats: readonly { id: string }[],
  pinnedProjects: readonly { id: string }[],
  unpinnedProjects: readonly { id: string }[],
  recentChats: readonly { id: string }[],
): SearchResultRef[] {
  return [
    ...pinnedChats.map((c) => ({ kind: 'chat' as const, id: c.id })),
    ...pinnedProjects.map((p) => ({ kind: 'project' as const, id: p.id })),
    ...unpinnedProjects.map((p) => ({ kind: 'project' as const, id: p.id })),
    ...recentChats.map((c) => ({ kind: 'chat' as const, id: c.id })),
  ];
}

/** A stable string key for a search result, used both to look an element up in the ref map
 *  and to find a result's own index (`searchResultKey(kind,id)` matches what Sidebar.tsx
 *  registers each row's element under). */
export function searchResultKey(kind: SearchResultKind, id: string): string {
  return `${kind}:${id}`;
}
