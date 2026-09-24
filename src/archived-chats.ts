// Archived chats as one list (#232): free chats and every project's chats, newest first, with a
// search that matches the title or the project name. Pure, so tests pin the filter.
import type { ChatMeta } from './types';

export type ArchivedRow = { chat: ChatMeta; projectId: string | null; projectName: string | null };
type WorkspaceLike = { freeChats?: ChatMeta[]; projects?: { id: string; name: string; chats?: ChatMeta[] }[] };

export function collectArchived(w: WorkspaceLike): ArchivedRow[] {
  const free = (w.freeChats || []).filter((c) => c.archived).map((chat) => ({ chat, projectId: null, projectName: null }));
  const inProjects = (w.projects || []).flatMap((p) => (p.chats || []).filter((c) => c.archived).map((chat) => ({ chat, projectId: p.id, projectName: p.name })));
  return [...free, ...inProjects].sort((a, b) => (b.chat.updatedAt || 0) - (a.chat.updatedAt || 0));
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Every word of the query must appear in the title or the project name (accents ignored). */
export function filterArchived(rows: ArchivedRow[], query: string): ArchivedRow[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => { const hay = fold(`${r.chat.title || 'Untitled chat'} ${r.projectName || ''}`); return words.every((w) => hay.includes(w)); });
}

/** A stable key for selection: a chat id is only unique within its list. */
export const rowKey = (r: ArchivedRow) => `${r.projectId ?? ''}/${r.chat.id}`;
