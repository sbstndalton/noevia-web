import { createContext, useContext } from 'react';

/** The id of the coworker whose conversation is on screen (#2446), or null anywhere else. Set by App.tsx around the chat
 *  view, so a tool card deep inside can tell it is in a coworker's conversation without the chat view changing. */
export const CoworkerConversation = createContext<string | null>(null);
export const useCoworkerConversation = (): string | null => useContext(CoworkerConversation);

/** The tool a coworker saves a page with (noevia-core server/specialist-page-save.cjs). */
export const PAGE_SAVE_TOOL = 'space_page_save';

export interface PageDraft { title: string; content: string; spaceId: string | null }

/** The draft a `space_page_save` call proposes, or null when its arguments are not the expected shape (the plain
 *  card then shows them raw, so nothing is ever hidden). */
export function parsePageDraft(args: string): PageDraft | null {
  try {
    const v: unknown = JSON.parse(args || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.title !== 'string' || typeof o.content !== 'string') return null;
    if (o.spaceId !== undefined && o.spaceId !== null && typeof o.spaceId !== 'string') return null;
    return { title: o.title, content: o.content, spaceId: typeof o.spaceId === 'string' && o.spaceId ? o.spaceId : null };
  } catch { return null; }
}

/** The page a finished `space_page_save` made: `{pageId, spaceId, title, link}` as the front built it. The link must be
 *  the in-app Spaces address; anything else is not shown as a link. */
export function parseSavedPage(result: string | undefined): { title: string; link: string } | null {
  if (!result) return null;
  try {
    const v: unknown = JSON.parse(result);
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const id = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    if (typeof o.link !== 'string' || typeof o.title !== 'string' || !new RegExp(`^/spaces/${id}/${id}$`).test(o.link)) return null;
    return { title: o.title, link: o.link };
  } catch { return null; }
}
