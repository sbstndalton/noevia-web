// #2601: the sidebar search says it finds "chats, projects and pages". The server searches a Space's pages
// (`GET /api/spaces/{id}/pages?q=`, title and text, case-folded) but has no search across every Space, so the
// client asks each of the person's first few Spaces for its best matches and merges them. Bounded on purpose:
// a query costs at most one list call plus PAGE_SEARCH_SPACES page calls, PAGE_SEARCH_PARALLEL at a time.
import { listPages, listSpaces } from './spaces-api';
import type { PageList, SpaceList } from './spaces-api';

export const PAGE_SEARCH_SPACES = 20;
export const PAGE_SEARCH_PER_SPACE = 5;
export const PAGE_SEARCH_MAX = 15;
export const PAGE_SEARCH_PARALLEL = 4;

export interface PageHit { spaceId: string; spaceName: string; pageId: string; title: string }
export interface PageSearch {
  hits: PageHit[];
  /** True when something may be missing: more Spaces than were asked, a Space with more matches than were kept, a Space that did not answer. */
  incomplete: boolean;
}
export interface PageSearchApi {
  listSpaces: (signal?: AbortSignal) => Promise<SpaceList>;
  listPages: (spaceId: string, opts: { q: string; limit: number; signal?: AbortSignal }) => Promise<PageList>;
}

/** Pages whose title or text holds `query`, newest Space order kept, each Space's own order kept. A Space that does not answer
 *  is skipped (and makes the result incomplete); a failed Space list rejects, so the caller shows no pages rather than guess. */
export async function searchSpacePages(query: string, signal?: AbortSignal, api: PageSearchApi = { listSpaces, listPages }): Promise<PageSearch> {
  const { spaces } = await api.listSpaces(signal);
  const asked = spaces.slice(0, PAGE_SEARCH_SPACES);
  let incomplete = spaces.length > asked.length;
  const answers: ({ list: PageList } | null)[] = new Array(asked.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < asked.length) {
      const index = next++;
      try { answers[index] = { list: await api.listPages(asked[index].id, { q: query, limit: PAGE_SEARCH_PER_SPACE, signal }) }; }
      catch { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAGE_SEARCH_PARALLEL, asked.length) }, worker));
  const hits: PageHit[] = [];
  asked.forEach((space, index) => {
    const answer = answers[index];
    if (!answer) { incomplete = true; return; }
    if (answer.list.truncated) incomplete = true;
    for (const page of answer.list.pages) hits.push({ spaceId: space.id, spaceName: space.name, pageId: page.id, title: page.title });
  });
  if (hits.length > PAGE_SEARCH_MAX) incomplete = true;
  return { hits: hits.slice(0, PAGE_SEARCH_MAX), incomplete };
}
